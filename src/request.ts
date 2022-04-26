import { Blob } from 'buffer';
import { format as URLFormat, URL } from 'url';

import {
  fetch,
  BodyInit,
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


export type AbortSignal = {
	readonly aborted: boolean;

	addEventListener: (type: 'abort', listener: (this: AbortSignal) => void) => void;
	removeEventListener: (type: 'abort', listener: (this: AbortSignal) => void) => void;
};

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

  credentials?: RequestCredentials,
  follow?: number,
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

export class Request extends FetchRequest {
  readonly controller?: AbortController;
  readonly route: Route | null;
  readonly timeout?: number;

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
          const blob = new Blob([file.value], (file.contentType) ? {type: file.contentType} : undefined);
          body.append(file.key || `file[${i}]`, blob, file.filename);
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
            body.append(key, JSON.stringify(init.body));
          }
        }
      }
    } else if (init.body !== undefined) {
      if (init.jsonify) {
        headers.set(HTTPHeaders.CONTENT_TYPE, ContentTypes.APPLICATION_JSON);
        body = JSON.stringify(init.body);
      } else {
        body = init.body;
      }
    }
    init.body = body;
    init.headers = headers;

    let controller: AbortController | undefined;
    if (init.timeout) {
      controller = new AbortController();
      init.signal = controller.signal;
    }

    super(url as unknown as string, init as RequestInit);
    this.controller = controller;
    this.route = route;
    this.timeout = init.timeout;
  }

  get parsedUrl(): URL {
    const url = (this.url as any);
    if (url instanceof URL) {
      return url;
    }
    return new URL(url);
  }

  // @ts-ignore
  clone(): Request {
    return new Request(this);
  }

  async send() {
    const now = Date.now();

    let timeout: Timers.Timeout | undefined;
    if (this.timeout && this.controller) {
      timeout = new Timers.Timeout();
      timeout.start(this.timeout, () => {
        if (this.controller) {
          this.controller.abort(`Request took longer than ${this.timeout}ms`);
        }
      });
    }

    const response = await fetch(this.url, this as RequestInit);
    if (timeout) {
      timeout.stop();
    }
    return new Response(this, response, Date.now() - now);
  }

  toString(): string {
    return `${this.method}-${URLFormat(this.url)}`;
  }
}


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
