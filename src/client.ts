import { URL } from 'url';

import {
  BodylessMethods,
  HTTPHeaders,
  HTTPHeadersInterface,
  HTTPMethods,
  Package,
} from './constants';

import {
  BasicRequestOptions,
  Request,
  RequestSettings,
} from './request';
import { Route } from './route';


export interface RequestRoute {
  method?: string,
  params?: {
    [key: string]: string,
  },
  path?: string,
  urlPath?: null,
}

export interface BeforeRequestOptions extends BasicRequestOptions {
  headers?: {[key: string]: string | undefined},
  method?: string,
  path?: string,
  query?: {
    [key: string]: any,
  },
  route?: Route | RequestRoute,
  settings?: RequestSettings,
  url?: string | URL,
}


const defaultClientOptions = Object.freeze({
  settings: {
    timeout: 20000,
  },
  headers: {
    [HTTPHeaders.USER_AGENT]: `detritus-rest (${Package.URL}, ${Package.VERSION})`,
  },
});

export interface ClientSettings {
  timeout?: number,
}

export interface ClientOptions {
  baseUrl?: string | URL,
  headers?: {[key: string]: string | undefined},
  settings?: ClientSettings,
}

export class Client {
  baseUrl: string | URL;
  headers: HTTPHeadersInterface;
  settings: ClientSettings;

  constructor(options?: ClientOptions) {
    options = Object.assign({}, defaultClientOptions, options);

    this.baseUrl = '';
    if (options.baseUrl) {
      if (options.baseUrl instanceof URL) {
        this.baseUrl = options.baseUrl;
      } else {
        this.baseUrl = new URL(options.baseUrl);
      }
    }

    this.headers = Object.assign({}, defaultClientOptions.headers);
    if (options.headers) {
      for (let key in options.headers) {
        if (options.headers[key] !== undefined) {
          this.headers[key.toLowerCase()] = <string> options.headers[key];
        }
      }
    }

    this.settings = Object.assign({}, defaultClientOptions.settings, options.settings);
  }

  async createRequest(
    options?: BeforeRequestOptions | string,
  ): Promise<Request> {
    if (typeof(options) === 'string') {
      options = {url: options};
    } else {
      options = Object.assign({}, options);
    }

    let method = options.method;
    if (!method) {
      // set the method before it creates the route incase route doesn't contain one
      method = HTTPMethods.GET;
    }

    if (options.route || options.path) {
      if (!options.route) {
        options.route = {};
      }
      if (!(options.route instanceof Route)) {
        options.route = new Route(
          options.route.method || method,
          options.route.path || options.path,
          options.route.params,
        );
      }
      method = options.route.method;
    }

    method = method.toUpperCase(); // http2 requires uppercase

    if (!options.url && !options.route) {
      throw new Error('URL or Path has to be specified in a request!');
    }

    let url: URL;
    if (options.route) {
      if (!this.baseUrl && !options.url) {
        throw new Error('Route or Path cannot be used without a url specified!');
      }
      url = new URL('', options.url || this.baseUrl);
      if (url.pathname.endsWith('/') && options.route.urlPath.startsWith('/')) {
        url.pathname += options.route.urlPath.slice(1);
      } else {
        url.pathname += options.route.urlPath;
      }
    } else {
      url = new URL('', options.url);
    }

    if (options.query) {
      for (let key in options.query) {
        appendQuery(url, key, options.query[key]);
      }
    }

    let body = options.body;
    if (body && BodylessMethods.includes(method)) {
      // treat body as query
      if (typeof(body) === 'object') {
        for (let key in body) {
          appendQuery(url, key, body[key]);
        }
      }
      body = null;
    }

    const headers = Object.assign({}, this.headers);
    if (options.headers) {
      for (let key in options.headers) {
        if (options.headers[key] !== undefined) {
          headers[key.toLowerCase()] = <string> options.headers[key];
        }
      }
    }

    return new Request({
      body,
      files: options.files,
      headers,
      jsonify: options.jsonify,
      method,
      multipart: options.multipart,
      route: options.route,
      settings: Object.assign({}, this.settings, options.settings),
      url,
    });
  }

  async request(
    options?: BeforeRequestOptions | string,
  ): Promise<any> {
    if (typeof(options) === 'string') {
      options = {url: options};
    }
    const request = await this.createRequest(options);
    return await request.send();
  }

  async delete(options?: BeforeRequestOptions | string): Promise<any> {
    if (typeof(options) === 'string') {
      options = {method: HTTPMethods.DELETE, url: options};
    } else {
      options = Object.assign({}, options, {method: HTTPMethods.DELETE});
    }
    return this.request(options);
  }

  async get(options?: BeforeRequestOptions | string): Promise<any> {
    if (typeof(options) === 'string') {
      options = {method: HTTPMethods.GET, url: options};
    } else {
      options = Object.assign({}, options, {method: HTTPMethods.GET});
    }
    return this.request(options);
  }

  async head(options?: BeforeRequestOptions | string): Promise<any> {
    if (typeof(options) === 'string') {
      options = {method: HTTPMethods.HEAD, url: options};
    } else {
      options = Object.assign({}, options, {method: HTTPMethods.HEAD});
    }
    return this.request(options);
  }

  async options(options?: BeforeRequestOptions | string): Promise<any> {
    if (typeof(options) === 'string') {
      options = {method: HTTPMethods.OPTIONS, url: options};
    } else {
      options = Object.assign({}, options, {method: HTTPMethods.OPTIONS});
    }
    return this.request(options);
  }

  async patch(options?: BeforeRequestOptions | string): Promise<any> {
    if (typeof(options) === 'string') {
      options = {method: HTTPMethods.PATCH, url: options};
    } else {
      options = Object.assign({}, options, {method: HTTPMethods.PATCH});
    }
    return this.request(options);
  }

  async post(options?: BeforeRequestOptions | string): Promise<any> {
    if (typeof(options) === 'string') {
      options = {method: HTTPMethods.POST, url: options};
    } else {
      options = Object.assign({}, options, {method: HTTPMethods.POST});
    }
    return this.request(options);
  }

  async put(options?: BeforeRequestOptions | string): Promise<any> {
    if (typeof(options) === 'string') {
      options = {method: HTTPMethods.PUT, url: options};
    } else {
      options = Object.assign({}, options, {method: HTTPMethods.PUT});
    }
    return this.request(options);
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
