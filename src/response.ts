import { Headers, Response as FetchResponse } from 'undici';

import { HTTPHeaders } from './constants';
import { Request } from './request';


export class Response {
  readonly fetchResponse: FetchResponse;
  readonly request: Request;
  readonly took: number;

  _body: Promise<ArrayBuffer> | ArrayBuffer | null = null;
  _bodyStream: FetchResponse['body'] = null;
  _bodyUsed: boolean = false;
  _size: number | null = null;
  // stops the request's timeout, it covers reading the body too, shared with clones
  _stopTimeout: () => void;

  constructor(
    request: Request,
    response: FetchResponse,
    took: number = 0,
    stopTimeout: () => void = () => {},
  ) {
    this.fetchResponse = response;
    this.request = request;
    this.took = took;
    this._stopTimeout = stopTimeout;

    Object.defineProperties(this, {
      _body: {enumerable: false},
      _bodyStream: {enumerable: false},
      _bodyUsed: {enumerable: false},
      _stopTimeout: {enumerable: false},
    });
  }

  get body() {
    if (this.fetchResponse.body === null) {
      return null;
    }
    if (this._body instanceof ArrayBuffer) {
      // the underlying stream was already consumed, serve a stream from the cached body (once, like fetch)
      if (!this._bodyStream) {
        this._bodyStream = new FetchResponse(this._body).body;
      }
      return this._bodyStream;
    }
    return this.fetchResponse.body;
  }

  get bodyUsed(): boolean {
    if (this._body !== null) {
      // a clone shares the cached body, so only count reads made through this response
      return this._bodyUsed;
    }
    return this.fetchResponse.bodyUsed;
  }

  get headers(): Headers {
    return this.fetchResponse.headers;
  }

  get ok(): boolean {
    return this.fetchResponse.ok;
  }

  get redirected(): boolean {
    return this.fetchResponse.redirected;
  }

  get size(): number {
    if (this._size !== null) {
      return this._size;
    }
    return this._size = parseInt(this.headers.get('content-length') || '0');
  }

  get status(): number {
    return this.fetchResponse.status;
  }

  get statusCode(): number {
    return this.status;
  }

  get statusText(): string {
    return this.fetchResponse.statusText;
  }

  get url(): string {
    return this.fetchResponse.url;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this._bodyUsed = true;
    if (this._body) {
      return this._body;
    }
    this._body = this.fetchResponse.arrayBuffer();
    try {
      return this._body = await this._body;
    } finally {
      // the body is read (or failed to), the timeout is done either way
      this._stopTimeout();
    }
  }

  async buffer(): Promise<Buffer> {
    const arrayBuffer = await this.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async json(): Promise<unknown> {
    const text = await this.text();
    if (text) {
      return JSON.parse(text);
    }
    return null;
  }

  async text(): Promise<string> {
    // always utf-8 like fetch's text(), strips a leading BOM so json() can parse it
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  clone(): Response {
    // once the body is read (or being read) the fetch response can't be cloned, reuse the cached body instead
    const fetchResponse = (this._body === null) ? this.fetchResponse.clone() : this.fetchResponse;
    const response = new Response(this.request, fetchResponse, this.took, this._stopTimeout);
    if (this._body instanceof ArrayBuffer) {
      response._body = this._body.slice(0);
    } else if (this._body) {
      const body = response._body = this._body.then((body) => response._body = body.slice(0));
      // the original's read failing would otherwise be an unhandled rejection if the clone is never read
      body.catch(() => {});
    }
    response._size = this._size;
    return response;
  }

  toString(): string {
    return this.request.toString();
  }
}


Object.defineProperties(Response.prototype, {
  arrayBuffer: {enumerable: true},
  body: {enumerable: true},
  bodyUsed: {enumerable: true},
  clone: {enumerable: true},
  headers: {enumerable: true},
  json: {enumerable: true},
  ok: {enumerable: true},
  redirected: {enumerable: true},
  status: {enumerable: true},
  statusText: {enumerable: true},
  text: {enumerable: true},
  url: {enumerable: true},
});
