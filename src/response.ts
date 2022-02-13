import { Headers, Response as FetchResponse } from 'node-fetch';
import { Blob } from 'fetch-blob/from.js';

import { HTTPHeaders } from './constants';
import { Request } from './request';


export class Response {
  readonly fetchResponse: FetchResponse;
  readonly request: Request;
  readonly took: number;

  _body: Promise<Buffer> | Buffer | null = null;

  constructor(request: Request, response: FetchResponse, took: number = 0) {
    this.fetchResponse = response;
    this.request = request;
    this.took = took;

    Object.defineProperties(this, {
      _body: {enumerable: false},
    });
  }

  get body(): NodeJS.ReadableStream | null {
    return this.fetchResponse.body;
  }

  get bodyUsed(): boolean {
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
    return this.fetchResponse.size;
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
    const {buffer, byteOffset, byteLength} = await this.buffer();
		return buffer.slice(byteOffset, byteOffset + byteLength);
  }

  async blob(): Promise<Blob> {
    const contentType = this.headers.get(HTTPHeaders.CONTENT_TYPE) || (this.body && (<any> this.body).type) || '';
    const buffer = await this.buffer();

    return new Blob([buffer], {type: contentType});
  }

  async buffer(): Promise<Buffer> {
    if (this._body) {
      return this._body;
    }
    this._body = this.fetchResponse.buffer();
    return this._body = await this._body;
  }

  async json(): Promise<unknown> {
    const text = await this.text();
    if (text) {
      return JSON.parse(text);
    }
    return null;
  }

  async text(): Promise<string> {
    return (await this.buffer()).toString();
  }

  clone() {
    return new Response(this.request, this.fetchResponse);
  }

  toString(): string {
    return this.request.toString();
  }
}


Object.defineProperties(Response.prototype, {
  arrayBuffer: {enumerable: true},
  blob: {enumerable: true},
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
