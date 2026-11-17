import { ReadableStream } from 'stream/web';

import { Headers, Response as FetchResponse } from 'undici';

import { HTTPHeaders } from './constants';
import { Request } from './request';


export class Response {
  readonly fetchResponse: FetchResponse;
  readonly request: Request;
  readonly took: number;

  _body: Promise<ArrayBuffer> | ArrayBuffer | null = null;
  _bodyStream: FetchResponse['body'] = null;
  // the fetch response's stream, observed so reading it to the end (or cancelling it) stops the timeout
  _fetchBodyStream: FetchResponse['body'] = null;
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
      _fetchBodyStream: {enumerable: false},
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
    if (!this._fetchBodyStream) {
      this._fetchBodyStream = observeBodyStream(this.fetchResponse.body, this._stopTimeout) as FetchResponse['body'];
    }
    return this._fetchBodyStream;
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

  /**
   * The body is read once and cached so it can be read again (and by clones), the returned ArrayBuffer is that cache
   * It's shared with `buffer()`, `text()`, `json()` and clones of this response, so don't mutate it, copy it first
   */
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
    // once the body is read (or being read) the fetch response can't be cloned, reuse the cached body instead
    const fetchResponse = (this._body === null) ? this.fetchResponse.clone() : this.fetchResponse;
    const response = new Response(this.request, fetchResponse, this.took, this._stopTimeout);
    // the cached body is shared, not copied (see `arrayBuffer()`)
    if (this._body instanceof ArrayBuffer) {
      response._body = this._body;
    } else if (this._body) {
      const body = response._body = this._body.then((body) => response._body = body);
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


/**
 * Wraps a body stream so the timeout stops once it's read to the end, errors or is cancelled
 * The stream is only locked on the first read, so `arrayBuffer()` can still be used after getting `body`
 */
function observeBodyStream(
  stream: ReadableStream<Uint8Array>,
  stop: () => void,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!reader) {
          reader = stream.getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          stop();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        stop();
        controller.error(error);
      }
    },
    async cancel(reason) {
      stop();
      if (reader) {
        await reader.cancel(reason);
      } else {
        await stream.cancel(reason);
      }
    },
  }, {highWaterMark: 0});
}
