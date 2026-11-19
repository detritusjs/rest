import { Readable } from 'stream';
import { ReadableStream } from 'stream/web';

import { Headers, Response as FetchResponse } from 'undici';

import { HTTPHeaders } from './constants';
import { Request } from './request';


/**
 * `_body` is null while unread, a promise while `arrayBuffer()` reads it, then the cached ArrayBuffer
 * The request's timeout keeps running until a read completes
 */
export class Response {
  readonly fetchResponse: FetchResponse;
  readonly request: Request;
  readonly took: number;

  _body: Promise<ArrayBuffer> | ArrayBuffer | null = null;
  // a stream of the cached body, given out by `body` once `arrayBuffer()` reads it
  _bodyStream: FetchResponse['body'] = null;
  // the fetch response's stream, observed so reading it to the end stops the timeout
  _fetchBodyStream: FetchResponse['body'] = null;
  _bodyUsed: boolean = false;
  // redirects followed by `fetchFollow()`, which the fetch response doesn't know about
  _redirected: boolean = false;
  _size: number | null = null;
  // stops the request's timeout, shared with clones
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
      _fetchBodyStream: {enumerable: false},
      _bodyUsed: {enumerable: false},
      _redirected: {enumerable: false},
      _stopTimeout: {enumerable: false},
    });
  }

  get body() {
    if (this.fetchResponse.body === null) {
      return null;
    }
    if (this._fetchBodyStream && Readable.isDisturbed(this._fetchBodyStream as any)) {
      // already being read, so it stays the body like fetch's
      return this._fetchBodyStream;
    }
    if (this._body !== null) {
      // the underlying stream is consumed, serve a stream of the cached body (once, like fetch)
      if (!this._bodyStream) {
        this._bodyStream = cachedBodyStream(this._body) as FetchResponse['body'];
      }
      return this._bodyStream;
    }
    if (!this._fetchBodyStream) {
      // looked up on the first read since `clone()` replaces the fetch response's stream
      this._fetchBodyStream = observeBodyStream(() => this.fetchResponse.body!, this._stopTimeout) as FetchResponse['body'];
    }
    return this._fetchBodyStream;
  }

  get bodyUsed(): boolean {
    if (this._body !== null) {
      // a clone shares the cached body, so only count reads made through this response
      return this._bodyUsed || (this._bodyStream !== null && Readable.isDisturbed(this._bodyStream as any));
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
    return this._redirected || this.fetchResponse.redirected;
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

  /**
   * The body is read once and cached, the returned ArrayBuffer is shared with clones so copy it before mutating
   */
  async arrayBuffer(): Promise<ArrayBuffer> {
    this._bodyUsed = true;
    if (this._body) {
      return this._body;
    }
    this._body = this.fetchResponse.arrayBuffer();
    const body = await this._body;
    // only a completed read stops the timeout, a clone's read may still need it
    this._stopTimeout();
    return this._body = body;
  }

  /**
   * A view into the cached body (see `arrayBuffer()`), don't mutate it, copy it first
   */
  async buffer(): Promise<Buffer> {
    const arrayBuffer = await this.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async json(): Promise<unknown> {
    const text = await this.text();
    if (text.trim()) {
      return JSON.parse(text);
    }
    return null;
  }

  async text(): Promise<string> {
    // always utf-8 like fetch's text(), strips a leading BOM so json() can parse it
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  clone(): Response {
    // a read fetch response can't be cloned, reuse the cached body instead
    const fetchResponse = (this._body === null) ? this.fetchResponse.clone() : this.fetchResponse;
    const response = new Response(this.request, fetchResponse, this.took, this._stopTimeout);
    if (this._body instanceof ArrayBuffer) {
      response._body = this._body;
    } else if (this._body) {
      const body = response._body = this._body.then((body) => response._body = body);
      // avoids an unhandled rejection if the clone is never read
      body.catch(() => {});
    }
    response._redirected = this._redirected;
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


/**
 * Stops the timeout once the stream is read to the end, an error or cancel leaves it running for a clone
 * The stream is locked on the first read, so `arrayBuffer()` and `clone()` still work after getting `body`
 */
function observeBodyStream(
  getStream: () => ReadableStream<Uint8Array>,
  stop: () => void,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!reader) {
          reader = getStream().getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          stop();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (reader) {
        await reader.cancel(reason);
      } else {
        await getStream().cancel(reason);
      }
    },
  }, {highWaterMark: 0});
}


/**
 * A stream of a copy of the cached body, since the cached body is shared
 */
function cachedBodyStream(
  body: Promise<ArrayBuffer> | ArrayBuffer,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const bytes = new Uint8Array((await body).slice(0));
      if (bytes.byteLength) {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  }, {highWaterMark: 0});
}
