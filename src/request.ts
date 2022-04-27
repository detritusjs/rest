import { ReadableStream } from 'stream/web'
import { format as URLFormat, URL } from 'url';

import {
  fetch,
  BodyInit,
  File,
  FormData,
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
  isBlob,
  isFormData,
  isURLSearchParameters,
} from './is';
import { Response } from './response';
import { Route } from './route';


export interface RequestFile {
  contentType?: string,
  filename?: string,
  key?: string,
  value: any,
}

export interface RequestOptions {
  body?: BodyInit | null | any,
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

  //follow?: number,

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

  readonly controller?: AbortController;
  readonly options: RequestInit;
  readonly route: Route | null;
  readonly timeout?: number;
  readonly url: URL;

  constructor(
    info: string | URL | RequestOptions | Request,
    init?: RequestOptions,
  ) {
    init = Object.assign({jsonify: true}, init);

    let url: URL;
    if (typeof(info) === 'string' || info instanceof URL) {
      url = new URL('', info);
    } else {
      init = Object.assign({}, info, init);
      if (init.url) {
        url = new URL('', init.url);
      } else {
        throw new Error('A URL is required.');
      }
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
    if (isFormData(init.body)) {
      body = init.body;
    }
    if (((init.body !== undefined && init.body !== null) && init.multipart) || (init.files && init.files.length)) {
      // convert the body to form-data if `init.body` is non-null and multipart is true OR if theres any files passed in
      if (!body) {
        body = new FormData();
      }
      if (init.files && init.files.length) {
        for (let i = 0; i < init.files.length; i++) {
          const file = init.files[i];
          // use File object instead of Blob since undici loses the contentType <https://github.com/nodejs/undici/blob/main/lib/fetch/formdata.js#L246>
          const blob = new File([file.value], file.filename || `blob-${i}`, (file.contentType) ? {type: file.contentType} : undefined);
          body.append(file.key || `file[${i}]`, blob);
        }
      }
      if (init.body !== undefined && init.body !== null && init.body !== body) {
        if (isURLSearchParameters(init.body)) {
          // go through the keys and add it to the form-data
          for (let [key, value] of init.body) {
            body.append(key, value);
          }
        } else if (isBlob(init.body)) {
          // add it as a file?
        } else {
          if ((init.multipart || !init.jsonify) && typeof(init.body) === 'object') {
            for (let key in init.body) {
              body.append(key, init.body[key]);
            }
          } else {
            // If an object is passed in as the body with files, but multipart isn't true or jsonify is false, encode it to json
            const key = 'payload_json';
            //const blob = new Blob([JSON.stringify(init.body)], {type: ContentTypes.APPLICATION_JSON});
            body.append(key, JSON.stringify(init.body));
          }
        }
      }

      // we will cache the body so we can reuse this request object, must extract the body
      const { extractBody } = require('undici/lib/fetch/body');
      const extracted = extractBody(body);
      body = extracted[0]
      headers.set('content-type', extracted[1]);
      /*
      replace boundary
      // [ body, contentType ] = extractBody()
      // have to somehow read {stream, source, length}
      // boundary = '--' + contentType.split('boundary=').pop()!;
      // boundaryReplacement = boundary.replace('formdata-undici', 'Detritus')
      // boundary1 = boundary + '\r\nContent-Disposition: form-data';
      // boundary2 = '\r\n' + boundary + '--';
      */
    } else if (init.body !== undefined) {
      if (init.jsonify) {
        headers.set(HTTPHeaders.CONTENT_TYPE, ContentTypes.APPLICATION_JSON);
        body = JSON.stringify(init.body);
      } else {
        body = init.body;
      }
    }

    let controller: AbortController | undefined;
    if (init.timeout) {
      controller = new AbortController();
      init.signal = controller.signal;
    }
  
    this.controller = controller;
    this.route = route;
    this.url = url;
    this.timeout = init.timeout;

    this.options = {
      body,
      credentials: init.credentials,
      headers,
      integrity: init.integrity,
      keepalive: init.keepalive,
      method: init.method,
      mode: init.mode,
      redirect: init.redirect,
      referrer: init.referrer,
      referrerPolicy: init.referrerPolicy as ReferrerPolicy | undefined,
      signal: init.signal as AbortSignal | undefined,
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

    if (this.options.body) {
      const body = this.options.body as any;
      if (typeof(body) === 'object' && body.stream instanceof ReadableStream) {
        const reader = body.stream.getReader();
        const buffers = [];
        let done = false;
        while (!done) {
          const result = await reader.read();
          done = result.done;
          if (result.value) {
            buffers.push(result.value);
          }
        }
        Object.assign(this.options, {body: Buffer.concat(buffers)});
      }
    }

    let timeout: Timers.Timeout | undefined;
    if (this.timeout && this.controller) {
      timeout = new Timers.Timeout();
      timeout.start(this.timeout, () => {
        if (this.controller) {
          this.controller.abort(`Request took longer than ${this.timeout}ms`);
        }
      });
    }

    const response = await fetch(this.url, this.options as RequestInit);
    if (timeout) {
      timeout.stop();
    }
    return new Response(this, response, Date.now() - now);
  }

  toString(): string {
    return `${this.method}-${URLFormat(this.url)}`;
  }
}


(Request as any).prototype.clone = function() {return new Request(this.url, {...this, ...this.options});}


export function appendQuery(
  url: URL,
  key: string,
  value: any,
): void {
  if (value === undefined) {
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
    // go through and pick out the undefined
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
