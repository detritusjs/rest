import { Agent } from 'http';
import { URL } from 'url';

import { Dispatcher, Headers, HeadersInit } from 'undici';

import {
  HTTPHeaders,
  HTTPMethods,
  Package,
} from './constants';
import { createHeaders, mergeRequestOptions, Request, RequestDispatcher, RequestOptions } from './request';
import { Response } from './response';


const defaultClientOptions = Object.freeze({
  headers: {
    [HTTPHeaders.USER_AGENT]: `detritus-rest (${Package.URL}, ${Package.VERSION})`,
  },
});

export interface ClientOptions {
  // deprecated alias of `dispatcher`, only undici dispatchers are used (an `http.Agent` is ignored by fetch)
  agent?: Dispatcher | Agent | ((parsedUrl: URL) => Dispatcher | Agent),
  baseUrl?: string | URL,
  dispatcher?: RequestDispatcher,
  headers?: HeadersInit | Record<string, string | undefined>,
}

export class Client {
  agent?: Dispatcher | Agent | ((parsedUrl: URL) => Dispatcher | Agent);
  baseUrl: string | URL;
  dispatcher?: RequestDispatcher;
  headers: Headers;

  constructor(options?: ClientOptions) {
    options = Object.assign({}, defaultClientOptions, options);

    this.agent = options.agent;
    this.dispatcher = options.dispatcher;

    this.baseUrl = '';
    if (options.baseUrl) {
      if (options.baseUrl instanceof URL) {
        this.baseUrl = options.baseUrl;
      } else {
        this.baseUrl = new URL(options.baseUrl);
      }
    }

    this.headers = createHeaders(options.headers);
    for (let key in defaultClientOptions.headers) {
      if (!this.headers.has(key)) {
        const value = (defaultClientOptions.headers as any)[key];
        this.headers.set(key, value);
      }
    }
  }

  createRequest(
    info: string | URL | RequestOptions | Request,
    init?: RequestOptions,
  ): Request {
    if (info instanceof Request) {
      // already built, spreading it would re-append the route path and drop the encoded body
      return new Request(info, init);
    }

    let url: string | URL;
    if (typeof(info) === 'string' || info instanceof URL) {
      url = info;
      init = Object.assign({}, init);
    } else {
      init = mergeRequestOptions(info, init);
      if (init.url || (this.baseUrl && (init.path || (init.route && init.route.path)))) {
        url = init.url || this.baseUrl;
      } else {
        if (this.baseUrl) {
          throw new Error('A Path is required if using the base URL from the client');
        } else {
          throw new Error('A URL is required if there is no base URL');
        }
      }
    }

    // inject base options from the client here, after merging so the request's own dispatcher/agent wins
    if (init.dispatcher === undefined && init.agent === undefined) {
      init.dispatcher = (this.dispatcher !== undefined) ? this.dispatcher : this.agent as RequestDispatcher | undefined;
    }

    if (init.headers) {
      const headers = createHeaders(init.headers);
      for (let [key, value] of this.headers) {
        if (!headers.has(key)) {
          headers.set(key, value);
        }
      }
      init.headers = headers;
    } else {
      init.headers = new Headers(this.headers);
    }

    return new Request(url, init);
  }

  async request(
    info: string | URL | RequestOptions | Request,
    init?: RequestOptions,
  ): Promise<Response> {
    const request = this.createRequest(info, init);
    return request.send();
  }

  async delete(
    info: string | URL | RequestOptions,
    init?: RequestOptions,
  ): Promise<Response> {
    init = Object.assign({}, init, {method: HTTPMethods.DELETE});
    return this.request(info, init);
  }

  async get(
    info: string | URL | RequestOptions,
    init?: RequestOptions,
  ): Promise<Response> {
    init = Object.assign({}, init, {method: HTTPMethods.GET});
    return this.request(info, init);
  }

  async head(
    info: string | URL | RequestOptions,
    init?: RequestOptions,
  ): Promise<Response> {
    init = Object.assign({}, init, {method: HTTPMethods.HEAD});
    return this.request(info, init);
  }

  async options(
    info: string | URL | RequestOptions,
    init?: RequestOptions,
  ): Promise<Response> {
    init = Object.assign({}, init, {method: HTTPMethods.OPTIONS});
    return this.request(info, init);
  }

  async patch(
    info: string | URL | RequestOptions,
    init?: RequestOptions,
  ): Promise<Response> {
    init = Object.assign({}, init, {method: HTTPMethods.PATCH});
    return this.request(info, init);
  }

  async post(
    info: string | URL | RequestOptions,
    init?: RequestOptions,
  ): Promise<Response> {
    init = Object.assign({}, init, {method: HTTPMethods.POST});
    return this.request(info, init);
  }

  async put(
    info: string | URL | RequestOptions,
    init?: RequestOptions,
  ): Promise<Response> {
    init = Object.assign({}, init, {method: HTTPMethods.PUT});
    return this.request(info, init);
  }
}
