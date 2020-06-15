import { format as URLFormat, URL, URLSearchParams } from 'url';

import * as FormData from 'form-data';
import fetch, { BodyInit, Headers, Request as FetchRequest, RequestInit } from 'node-fetch';

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


export interface RequestFile extends FormData.AppendOptions {
  key?: string,
  value: any,
}

export interface RequestOptions extends RequestInit {
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
  url?: string | URL,
}

export class Request extends FetchRequest {
  readonly route: Route | null;

  constructor(
    info: string | URL | RequestOptions,
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

    if (init.headers) {
      init.headers = new Headers(init.headers);
    } else {
      init.headers = new Headers();
    }

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
        for (let key in init.files) {
          const file = init.files[key];
          body.append(file.key || `file${key}`, file.value, file);
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
            body.append(
              key,
              JSON.stringify(init.body),
              {contentType: ContentTypes.APPLICATION_JSON},
            );
          }
        }
      }
    } else {
      if (init.jsonify) {
        init.headers.set(HTTPHeaders.CONTENT_TYPE, ContentTypes.APPLICATION_JSON);
        body = JSON.stringify(init.body);
      } else {
        body = init.body;
      }
    }
    init.body = body;

    super(url, init);
    this.route = route;
  }

  clone() {
    return new Request(this);
  }

  async send() {
    const response = await fetch(this.url, this);
    return new Response(this, response);
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
