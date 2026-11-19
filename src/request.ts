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
  // deprecated alias of `dispatcher`, an `http.Agent` is ignored by fetch
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

  // the latest send's timeout controller, only set with a `timeout`
  controller?: AbortController;
  readonly options: RequestInit;
  readonly route: Route | null;
  readonly timeout?: number;
  readonly url: URL;

  /**
   * `defaultHeaders` fill in the headers the request doesn't already have
   */
  constructor(
    info: string | URL | RequestOptions | Request,
    init?: RequestOptions,
    defaultHeaders?: Headers,
  ) {
    init = Object.assign({}, init);

    if (info instanceof Request) {
      // `info` is already built, rebuilding its url, route or body would need the original options
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
      if (defaultHeaders) {
        for (let [key, value] of defaultHeaders) {
          if (!headers.has(key)) {
            headers.set(key, value);
          }
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
      } else if (route.urlPath && !url.pathname.endsWith('/') && !route.urlPath.startsWith('/')) {
        // `/api` and `users` would be glued into `/apiusers`
        url.pathname += '/' + route.urlPath;
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
    if (defaultHeaders) {
      for (let [key, value] of defaultHeaders) {
        if (!headers.has(key)) {
          headers.set(key, value);
        }
      }
    }

    let body: any;
    let duplex: RequestInit['duplex'];
    if (isFormData(init.body) && !(init.files && init.files.length)) {
      // a caller-set content-type would be missing the boundary
      body = new MultipartBody();
      for (let [key, value] of init.body) {
        body.append(key, value);
      }
      headers.delete(HTTPHeaders.CONTENT_TYPE);
    } else if (((init.body !== undefined && init.body !== null) && init.multipart) || (init.files && init.files.length)) {
      // our own multipart body instead of a `FormData`, so files are sent from the caller's buffers without being copied
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
          const filename = file.filename || (isBlob(file.value) && file.value.name) || `blob-${i}`;
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
          // the parts are built synchronously here
          throw new Error('Stream bodies cannot be sent as multipart, pass the stream as a file `value` in `files` instead.');
        } else {
          if ((init.multipart || !init.jsonify) && typeof(init.body) === 'object') {
            for (let key in init.body) {
              if (init.body[key] === undefined) {
                continue;
              }

              body.append(key, toMultipartField(init.body[key]));
            }
          } else {
            // a string that isn't jsonified is already json
            const key = 'payload_json';
            if (!init.jsonify && typeof(init.body) === 'string') {
              body.append(key, init.body);
            } else {
              body.append(key, JSON.stringify(init.body));
            }
          }
        }
      }

      // `send()` sets the content-type with the boundary
      headers.delete(HTTPHeaders.CONTENT_TYPE);
    } else if (init.body !== undefined && init.body !== null) {
      if (isStream(init.body)) {
        // fetch requires `duplex` for a stream body
        body = init.body;
        duplex = 'half';
      } else if (
        init.jsonify &&
        !isBlob(init.body) &&
        !isArrayBuffer(init.body) &&
        !isArrayBufferView(init.body) &&
        !isURLSearchParameters(init.body)
      ) {
        // a caller-set content-type (like `application/merge-patch+json`) is kept
        if (!headers.has(HTTPHeaders.CONTENT_TYPE)) {
          headers.set(HTTPHeaders.CONTENT_TYPE, ContentTypes.APPLICATION_JSON);
        }
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

  /**
   * Can be called again to resend, except with a stream body which can only be sent once
   */
  async send() {
    const now = Date.now();

    // claimed while sending so a concurrent send can't split the stream between both requests
    const streamBody = (this.options.duplex) ? this.options.body as any : null;
    if (streamBody) {
      if (sendingStreamBodies.has(streamBody)) {
        throw new Error('This request\'s stream body is being sent by another send, a stream body can only be sent once. Pass a Buffer to be able to send it concurrently.');
      }
      if (Readable.isDisturbed(streamBody)) {
        throw new Error('This request\'s stream body was already sent, a stream body can only be sent once. Pass a Buffer to be able to retry.');
      }
      sendingStreamBodies.add(streamBody);
    }

    const options: RequestInit = Object.assign({}, this.options);
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
        // so fetch rejects with an Error instead of a string
        controller.abort(new DOMException(`Request took longer than ${this.timeout}ms`, 'TimeoutError'));
      });
    }

    // the timeout keeps running until the body is read so a stalled body can't hang
    const stop = () => {
      if (timeout) {
        timeout.stop();
      }
    };

    let response: Awaited<ReturnType<typeof fetch>>;
    let redirected = false;
    try {
      let multipartBody: MultipartBody | null = null;
      if ((options.body as any) instanceof MultipartBody) {
        const body = multipartBody = options.body as unknown as MultipartBody;
        // shared with clones and concurrent sends, its streams are read in once
        await untilAborted(body.resolveStreams(), options.signal);

        // sent as a bare stream, fetch would tee a sourced body and hold every file chunk until the request is done
        const { length, stream } = body.encode();
        const headers = new Headers(options.headers);
        headers.set(HTTPHeaders.CONTENT_TYPE, body.contentType);
        // a stream would be sent chunked otherwise
        headers.set(HTTPHeaders.CONTENT_LENGTH, String(length));
        Object.assign(options, {body: stream, duplex: 'half', headers});
      }

      if (options.duplex && (!options.redirect || options.redirect === 'follow')) {
        // fetch fails a redirect with a stream body unless it's a 303
        ({ redirected, response } = await fetchFollow(this.url, options, multipartBody));
      } else {
        response = await fetch(this.url, options);
      }
    } catch (error) {
      stop();
      throw error;
    } finally {
      if (streamBody) {
        // if fetch read any of it, it's disturbed and can't be resent anyways
        sendingStreamBodies.delete(streamBody);
      }
    }

    if (response.body === null) {
      stop();
    } else if (timeout) {
      // an unread body shouldn't keep the process alive, a body being read keeps the socket alive anyways
      timeout.unref();
    }
    const result = new Response(this, response, Date.now() - now, stop);
    result._redirected = redirected;
    return result;
  }

  toString(): string {
    return `${this.method}-${URLFormat(this.url)}`;
  }
}


(Request as any).prototype.clone = function(this: Request): Request {
  return new Request(this);
}


// like fetch's limit
const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
// removed when a redirect switches to a GET, like fetch
const REQUEST_BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length'];
// removed when a redirect goes to another origin, like undici's fetch
const CROSS_ORIGIN_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

/**
 * Follows redirects like fetch for a stream body, which fetch can't resend
 * A multipart body is encoded again when the redirect keeps the body, a plain stream body throws
 */
async function fetchFollow(
  url: URL,
  options: RequestInit,
  multipartBody: MultipartBody | null,
): Promise<{redirected: boolean, response: Awaited<ReturnType<typeof fetch>>}> {
  options = Object.assign({}, options, {headers: new Headers(options.headers), redirect: 'manual'});
  for (let redirects = 0; true; redirects++) {
    const response = await fetch(url, options);
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.includes(response.status) || location === null) {
      // the last fetch's own `redirected` is always false
      return {redirected: 0 < redirects, response};
    }
    if (response.body) {
      await response.body.cancel().catch(() => {});
    }
    if (MAX_REDIRECTS <= redirects) {
      throw new Error(`Too many redirects, stopped after ${MAX_REDIRECTS} redirects at ${url.href}`);
    }

    const nextUrl = new URL(location, url);
    if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
      throw new Error(`Cannot follow a ${response.status} redirect to ${nextUrl.href}, only http(s) urls can be redirected to.`);
    }

    const headers = options.headers as Headers;
    if (nextUrl.origin !== url.origin) {
      for (let key of CROSS_ORIGIN_HEADERS) {
        headers.delete(key);
      }
    }

    const method = options.method || HTTPMethods.GET;
    if (
      (response.status === 303 && method !== HTTPMethods.GET && method !== HTTPMethods.HEAD) ||
      ((response.status === 301 || response.status === 302) && method === HTTPMethods.POST)
    ) {
      for (let key of REQUEST_BODY_HEADERS) {
        headers.delete(key);
      }
      options = Object.assign({}, options, {body: null, duplex: undefined, method: HTTPMethods.GET});
    } else if (options.body !== null && options.body !== undefined) {
      if (!multipartBody) {
        throw new Error(`Cannot follow a ${response.status} redirect to ${nextUrl.href}, the request's stream body can only be sent once. Pass a Buffer to be able to follow it.`);
      }
      options = Object.assign({}, options, {body: multipartBody.encode().stream});
    }
    url = nextUrl;
  }
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

// stream bodies with a send in flight, see `send()`
const sendingStreamBodies = new WeakSet<object>();


/**
 * Rejects with the signal's reason once it aborts, the shared `promise` itself keeps going
 */
function untilAborted<T>(
  promise: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, {once: true});
    }
    promise.then((value) => {
      cleanup();
      resolve(value);
    }, (error) => {
      cleanup();
      reject(error);
    });
  });
}


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
    if (value instanceof Date) {
      value = value.toISOString();
    } else if (isPlainObject(value)) {
      throw new Error(`Query parameter \`${key}\` cannot be an object, only strings, numbers, booleans, dates and arrays of them.`);
    } else if (typeof(value) !== 'string') {
      value = String(value);
    }
    url.searchParams.append(key, value);
  }
}


function isPlainObject(value: any): boolean {
  if (value === null || typeof(value) !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}


/**
 * A date is sent as its iso string and an object (or an array with objects) as json, the rest like `FormData`
 */
function toMultipartField(value: any): any {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isPlainObject(value) || (Array.isArray(value) && value.some((x) => x !== null && typeof(x) === 'object'))) {
    return JSON.stringify(value);
  }
  return value;
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
