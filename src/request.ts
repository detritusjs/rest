import { Agent as HTTPAgent } from 'http';
import { Readable } from 'stream';
import { format as URLFormat, URL } from 'url';

import {
  fetch,
  BodyInit,
  Dispatcher,
  Headers,
  HeadersInit,
  Request as FetchRequest,
  RequestInit,
  RequestRedirect,
} from 'undici';

import { Timers } from 'detritus-utils';

import {
  HTTPHeaders,
  HTTPMethods,
  ContentTypes,
} from './constants';
import {
  isArrayBuffer,
  isArrayBufferView,
  isBlob,
  isFormData,
  isStream,
  isURLSearchParameters,
} from './is';
import { MultipartBody } from './multipart';
import { Response } from './response';
import { Route } from './route';


export interface RequestFile {
  contentType?: string,
  filename?: string,
  key?: string,
  value: any,
}

export type RequestDispatcher = Dispatcher | ((parsedUrl: URL) => Dispatcher);

export interface RequestOptions {
  // deprecated alias of `dispatcher`, only undici dispatchers are used (an `http.Agent` is ignored by fetch)
  agent?: Dispatcher | HTTPAgent | ((parsedUrl: URL) => Dispatcher | HTTPAgent),
  body?: BodyInit | null | any,
  dispatcher?: RequestDispatcher,
  files?: Array<RequestFile>,
  jsonify?: boolean,
  multipart?: boolean,
  path?: string,
  query?: Record<string, any>,
  route?: Route | {
    method?: string,
    params?: Record<string, any>,
    path?: string,
  } | null,
  size?: number,
  timeout?: number,
  url?: string | URL,

  credentials?: RequestCredentials,
  headers?: HeadersInit | Record<string, string | undefined>,
  integrity?: string,
  keepalive?: boolean,
  method?: string,
  mode?: RequestMode,
  redirect?: RequestRedirect,
  referrer?: string,
  referrerPolicy?: ReferrerPolicy | string,
  signal?: AbortSignal | null,
  window?: null,
}

export class Request {
  declare clone: () => Request;

  controller?: AbortController;
  readonly options: RequestInit;
  readonly route: Route | null;
  readonly timeout?: number;
  readonly url: URL;

  constructor(
    info: string | URL | RequestOptions | Request,
    init?: RequestOptions,
  ) {
    init = Object.assign({}, init);

    if (info instanceof Request) {
      // `info` is already built (route path appended, body encoded), so copy its processed state like `clone()` does
      // the url, route and body can't be overridden since rebuilding them needs the original options
      for (let key of ['body', 'files', 'jsonify', 'multipart', 'path', 'route', 'url'] as const) {
        if (init[key] !== undefined) {
          throw new Error(`Cannot override \`${key}\` when creating a Request from an existing Request.`);
        }
      }

      const url = new URL(info.url.href);
      if (init.query) {
        for (let key in init.query) {
          appendQuery(url, key, init.query[key]);
        }
      }

      const headers = new Headers(info.headers);
      if (init.headers) {
        for (let [key, value] of createHeaders(init.headers)) {
          headers.set(key, value);
        }
      }

      const options: RequestInit = Object.assign({}, info.options, {headers});
      for (let key of ['credentials', 'integrity', 'keepalive', 'mode', 'redirect', 'referrer', 'referrerPolicy'] as const) {
        if (init[key] !== undefined) {
          (options as any)[key] = init[key];
        }
      }
      if (init.signal !== undefined) {
        options.signal = (init.signal || undefined) as AbortSignal | undefined;
      }
      if (init.method) {
        options.method = init.method.toUpperCase();
      }
      if (init.dispatcher !== undefined || init.agent !== undefined) {
        options.dispatcher = resolveDispatcher((init.dispatcher !== undefined) ? init.dispatcher : init.agent, url);
      }

      this.route = info.route;
      this.url = url;
      this.timeout = (init.timeout !== undefined) ? init.timeout : info.timeout;
      this.options = options;
      return;
    }

    let url: URL;
    if (typeof(info) === 'string' || info instanceof URL) {
      url = new URL('', info);
    } else {
      init = mergeRequestOptions(info, init);
      if (init.url) {
        url = new URL('', init.url);
      } else {
        throw new Error('A URL is required.');
      }
    }

    // default after merging so an explicit `jsonify` from either argument wins
    if (init.jsonify === undefined) {
      init.jsonify = true;
    }

    init.method = init.method || HTTPMethods.GET;

    let route: Route | null = null;
    if (init.route || init.path) {
      if (init.route instanceof Route) {
        route = init.route;
      } else {
        if (init.route) {
          route = new Route(
            init.route.method || init.method,
            init.route.path || init.path,
            init.route.params,
          );
        } else {
          route = new Route(init.method, init.path);
        }
      }
      init.method = route.method;
    }
    init.method = init.method.toUpperCase();

    if (route) {
      if (url.pathname.endsWith('/') && route.urlPath.startsWith('/')) {
        url.pathname += route.urlPath.slice(1);
      } else {
        url.pathname += route.urlPath;
      }
    }

    if (init.query) {
      for (let key in init.query) {
        appendQuery(url, key, init.query[key]);
      }
    }

    const headers = createHeaders(init.headers);

    let body: any;
    let duplex: RequestInit['duplex'];
    if (isFormData(init.body) && !(init.files && init.files.length)) {
      // any form-data (undici's or node's global one) is sent through our own multipart body, see below
      // a caller-set content-type would be missing the boundary, so remove it
      body = new MultipartBody();
      for (let [key, value] of init.body) {
        body.append(key, value);
      }
      headers.delete(HTTPHeaders.CONTENT_TYPE);
    } else if (((init.body !== undefined && init.body !== null) && init.multipart) || (init.files && init.files.length)) {
      // our own multipart body instead of a `FormData`, so the files are sent from the caller's buffers and blobs without
      // being copied (see `MultipartBody`), a caller's form-data entries are copied into it
      body = new MultipartBody();
      if (isFormData(init.body)) {
        for (let [key, value] of init.body) {
          body.append(key, value);
        }
      }
      if (init.files && init.files.length) {
        for (let i = 0; i < init.files.length; i++) {
          const file = init.files[i];
          const key = file.key || `files[${i}]`;
          const filename = file.filename || `blob-${i}`;
          // a stream is read in on the first send
          body.appendFile(key, file.value, filename, file.contentType);
        }
      }
      if (init.body !== undefined && init.body !== null && !isFormData(init.body)) {
        if (isURLSearchParameters(init.body)) {
          for (let [key, value] of init.body) {
            body.append(key, value);
          }
        } else if (isBlob(init.body) || isArrayBuffer(init.body) || isArrayBufferView(init.body)) {
          const index = (init.files) ? init.files.length : 0;
          if (isBlob(init.body)) {
            body.append(`files[${index}]`, init.body);
          } else {
            body.appendFile(`files[${index}]`, init.body, `blob-${index}`);
          }
        } else if (isStream(init.body)) {
          // the body has to be extracted synchronously here, a stream can't be read into a part
          throw new Error('Stream bodies cannot be sent as multipart, pass the stream as a file `value` in `files` instead.');
        } else {
          if ((init.multipart || !init.jsonify) && typeof(init.body) === 'object') {
            for (let key in init.body) {
              if (init.body[key] === undefined) {
                continue;
              }

              body.append(key, init.body[key]);
            }
          } else {
            // with files, a non-multipart jsonified object (or a non-object body) gets sent as json in `payload_json`
            const key = 'payload_json';
            body.append(key, JSON.stringify(init.body));
          }
        }
      }

      // `send()` encodes the body again every time (a resend or a clone's send) with a precomputed content-length
      // a caller-set content-type would be missing the boundary, `send()` sets it
      headers.delete(HTTPHeaders.CONTENT_TYPE);
    } else if (init.body !== undefined && init.body !== null) {
      if (isStream(init.body)) {
        // fetch reads streams as-is but requires `duplex` for them, note a stream can only be sent once
        body = init.body;
        duplex = 'half';
      } else if (
        init.jsonify &&
        !isBlob(init.body) &&
        !isArrayBuffer(init.body) &&
        !isArrayBufferView(init.body) &&
        !isURLSearchParameters(init.body)
      ) {
        // only plain objects, arrays and primitives are json, fetch sets the content-type for the others
        headers.set(HTTPHeaders.CONTENT_TYPE, ContentTypes.APPLICATION_JSON);
        body = JSON.stringify(init.body);
      } else {
        body = init.body;
      }
    }

    this.route = route;
    this.url = url;
    this.timeout = init.timeout;

    this.options = {
      body,
      credentials: init.credentials,
      dispatcher: resolveDispatcher((init.dispatcher !== undefined) ? init.dispatcher : init.agent, url),
      duplex,
      headers,
      integrity: init.integrity,
      keepalive: init.keepalive,
      method: init.method,
      mode: init.mode,
      redirect: init.redirect,
      referrer: init.referrer,
      referrerPolicy: init.referrerPolicy as ReferrerPolicy | undefined,
      signal: (init.signal || undefined) as AbortSignal | undefined,
    };
  }

  get headers(): Headers {
    return this.options.headers as Headers;
  }

  get method(): string {
    return this.options.method!;
  }

  get parsedUrl(): URL {
    const url = (this.url as any);
    if (url instanceof URL) {
      return url;
    }
    return new URL(url);
  }

  async send() {
    const now = Date.now();

    if (this.options.duplex && Readable.isDisturbed(this.options.body as any)) {
      throw new Error('This request\'s stream body was already sent, a stream body can only be sent once. Pass a Buffer to be able to retry.');
    }

    const options: RequestInit = Object.assign({}, this.options);
    if ((options.body as any) instanceof MultipartBody) {
      const body = options.body as unknown as MultipartBody;
      // the body is shared with clones and concurrent sends, its streams are read in once
      await body.resolveStreams();

      // fetch tees a body with a source (form-data, blobs, buffers) to be able to resend it on a redirect, and the branch it
      // keeps is never read, so it would hold every chunk of the files until the request is done
      // a stream has no source and isn't teed, so it's encoded again on every send and only its stream is given, the files
      // are read as the socket drains (a 307/308 redirect fails instead of resending it)
      const { length, stream } = body.encode();
      const headers = new Headers(options.headers);
      headers.set(HTTPHeaders.CONTENT_TYPE, body.contentType);
      // a stream would be sent chunked otherwise
      headers.set(HTTPHeaders.CONTENT_LENGTH, String(length));
      Object.assign(options, {body: stream, duplex: 'half', headers});
    }
    let timeout: Timers.Timeout | undefined;
    if (this.timeout) {
      // fresh controller per send so a previous timeout doesn't abort a re-send
      const controller = this.controller = new AbortController();
      if (this.options.signal) {
        options.signal = AbortSignal.any([this.options.signal, controller.signal]);
      } else {
        options.signal = controller.signal;
      }
      timeout = new Timers.Timeout();
      timeout.start(this.timeout, () => {
        // abort with an error so fetch rejects with an Error object instead of a string
        controller.abort(new DOMException(`Request took longer than ${this.timeout}ms`, 'TimeoutError'));
      });
    }

    // fetch resolves once the headers arrive, the timeout keeps running until the body is read so a stalled body can't hang
    // `stop` is shared with the response (and its clones), stopping an already stopped timeout does nothing
    const stop = () => {
      if (timeout) {
        timeout.stop();
      }
    };

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(this.url, options);
    } catch (error) {
      stop();
      throw error;
    }

    if (response.body === null) {
      stop();
    } else if (timeout) {
      // a response whose body is never read shouldn't keep the process alive, if it fires the abort just cancels the unread body
      // a body that is being read keeps the socket (and so the process) alive, so a stalled read still times out
      timeout.unref();
    }
    return new Response(this, response, Date.now() - now, stop);
  }

  toString(): string {
    return `${this.method}-${URLFormat(this.url)}`;
  }
}


(Request as any).prototype.clone = function(this: Request): Request {
  return new Request(this);
}


function resolveDispatcher(
  value: RequestOptions['agent'] | RequestOptions['dispatcher'],
  url: URL,
): Dispatcher | undefined {
  if (typeof(value) === 'function') {
    value = value(url);
  }
  if (value && typeof((value as any).dispatch) === 'function') {
    return value as Dispatcher;
  }
  if (value && !warnedInvalidDispatcher) {
    // don't throw so existing callers passing an `http.Agent` keep working
    warnedInvalidDispatcher = true;
    process.emitWarning(
      'The `agent` option must be an undici Dispatcher (Agent, ProxyAgent or Pool), an `http.Agent` is ignored by fetch.',
      {code: 'DETRITUS_REST_INVALID_AGENT'},
    );
  }
  return undefined;
}


let warnedInvalidDispatcher = false;


/**
 * Like `Object.assign({}, info, init)`, but an `undefined` value in `init` doesn't override `info`
 */
export function mergeRequestOptions(
  info: RequestOptions,
  init?: RequestOptions,
): RequestOptions {
  const options: RequestOptions = Object.assign({}, info);
  if (init) {
    for (let key in init) {
      const value = (init as any)[key];
      if (value !== undefined) {
        (options as any)[key] = value;
      }
    }
  }
  return options;
}


export function appendQuery(
  url: URL,
  key: string,
  value: any,
): void {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (let v of value) {
      appendQuery(url, key, v);
    }
  } else {
    if (typeof(value) !== 'string') {
      value = String(value);
    }
    url.searchParams.append(key, value);
  }
}


export function createHeaders(
  old?: HeadersInit | Record<string, string | undefined>,
): Headers {
  if (old instanceof Headers || (old && typeof((old as any)[Symbol.iterator]) === 'function')) {
    return new Headers(old as HeadersInit);
  } else if (old) {
    const headers = new Headers();
    for (let key in old) {
      const value = (old as any)[key];
      if (value !== undefined) {
        headers.append(key, value);
      }
    }
    return headers;
  }
  return new Headers();
}
