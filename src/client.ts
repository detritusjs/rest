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


interface ClientSettings {
  timeout?: number,
}

interface RequestRoute {
  method?: string,
  params?: {
    [key: string]: string,
  },
  path?: string,
  urlPath?: null,
}

export interface BeforeRequestOptions extends BasicRequestOptions {
  method?: string,
  path?: string,
  query?: {
    [key: string]: string | undefined,
  },
  route?: Route | RequestRoute,
  settings?: RequestSettings,
  url?: string | URL,
}


const defaultClientOptions = {
  settings: {
    timeout: 20000,
  },
  headers: {
    [HTTPHeaders.USER_AGENT]: `detritus-rest (${Package.URL}, ${Package.VERSION})`,
  },
};

export class Client {
  baseUrl: string | URL;
  headers: HTTPHeadersInterface;
  settings: ClientSettings;

  constructor(options?: {
    baseUrl?: string | URL,
    headers?: HTTPHeadersInterface,
    settings?: ClientSettings,
  }) {
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
        this.headers[key.toLowerCase()] = options.headers[key];
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
        if (options.query[key] !== undefined) {
          url.searchParams.set(key, <string> options.query[key]);
        }
      }
    }

    let body = options.body;
    if (body && BodylessMethods.includes(method)) {
      // treat body as query
      if (typeof(body) === 'object') {
        for (let key in body) {
          if (body[key] !== undefined) {
            url.searchParams.set(key, <string> body[key]);
          }
        }
      }
      body = null;
    }

    const headers = Object.assign({}, this.headers);
    if (options.headers) {
      for (let key in options.headers) {
        headers[key.toLowerCase()] = options.headers[key];
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
}
