import { Agent } from 'http';
import { URL } from 'url';

import { Headers, HeadersInit } from 'node-fetch';

import {
  HTTPHeaders,
  HTTPMethods,
  Package,
} from './constants';
import { createHeaders, Request, RequestOptions } from './request';
import { Response } from './response';


const defaultClientOptions = Object.freeze({
  headers: {
    [HTTPHeaders.USER_AGENT]: `detritus-rest (${Package.URL}, ${Package.VERSION})`,
  },
});

export interface ClientOptions {
  agent?: Agent | ((parsedUrl: URL) => Agent),
  baseUrl?: string | URL,
  headers?: HeadersInit | Record<string, string | undefined>,
}

export class Client {
  agent?: Agent | ((parsedUrl: URL) => Agent);
  baseUrl: string | URL;
  headers: Headers;

  constructor(options?: ClientOptions) {
    options = Object.assign({}, defaultClientOptions, options);

    this.agent = options.agent;

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
    info: string | URL | RequestOptions,
    init?: RequestOptions,
  ): Request {
    // inject base options from the client here
    init = Object.assign({
      agent: this.agent,
    }, init);

    let url: string | URL;
    if (typeof(info) === 'string' || info instanceof URL) {
      url = info;
    } else {
      init = Object.assign({}, info, init);
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

    if (init.headers) {
      init.headers = createHeaders(init.headers);
      for (let [key, value] of this.headers) {
        if (!init.headers.has(key)) {
          init.headers.set(key, value);
        }
      }
    } else {
      init.headers = new Headers(this.headers);
    }

    return new Request(url, init);
  }

  async request(
    info: string | URL | RequestOptions,
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
