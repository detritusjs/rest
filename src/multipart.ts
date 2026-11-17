import { randomBytes } from 'crypto';
import { ReadableStream } from 'stream/web';

import { isArrayBuffer, isArrayBufferView, isBlob, isStream } from './is';


// how much of a file is read or sent at a time, a blob's reads go through libuv's threadpool (4 threads by default, shared
// with fs and dns) so bigger chunks mean fewer jobs on it, 256 KiB is ~480 reads a second at 1 Gbps
export const MULTIPART_CHUNK_SIZE = 256 * 1024;

const CRLF = Buffer.from('\r\n');


export type MultipartFileValue = Blob | Uint8Array | Array<Uint8Array>;

export interface MultipartPart {
  contentType?: string,
  filename?: string,
  name: string,
  // a pending stream is read into chunks by `resolveStreams()`
  stream?: any,
  value: string | MultipartFileValue,
}


/**
 * A multipart/form-data body that's encoded on every send, its files are never copied
 * Buffers are sent as views into them and blobs (like `fs.openAsBlob()`) are read a chunk at a time as the socket drains,
 * undici's `FormData` copies a buffer into a `File`, a blob's stream gives an in-memory blob as one copied chunk and its
 * extracted stream copies every chunk again
 * Encodes the same bytes as undici's `FormData` (escaping, linefeeds, trailing CRLF), only the boundary differs
 */
export class MultipartBody {
  readonly boundary = `----formdata-detritus-${randomBytes(12).toString('hex')}`;
  readonly parts: Array<MultipartPart> = [];

  _resolvingStreams: Promise<void> | null = null;

  get contentType(): string {
    return `multipart/form-data; boundary=${this.boundary}`;
  }

  get hasPendingStreams(): boolean {
    return this.parts.some((part) => part.stream);
  }

  /**
   * Like `FormData.append()`, a blob without a filename is named after its `File` name or `blob`
   */
  append(name: string, value: any, filename?: string): void {
    if (isBlob(value)) {
      const name_ = (value as File).name;
      this.parts.push({
        contentType: value.type,
        filename: (filename !== undefined) ? filename : ((typeof(name_) === 'string') ? name_ : 'blob'),
        name,
        value,
      });
    } else {
      this.parts.push({name, value: toWellFormed(String(value))});
    }
  }

  /**
   * A file part, `value` can be a Buffer/TypedArray/ArrayBuffer (sent as is), a Blob or a stream (read in on the first send)
   * Any other value is sent as its string's bytes, like a `File` made from it
   */
  appendFile(name: string, value: any, filename: string, contentType?: string): void {
    if (contentType && /[\r\n]/.test(contentType)) {
      // it's written into the part's headers as is, a linefeed would inject headers
      throw new Error('A file\'s content type cannot contain a carriage return or linefeed.');
    }

    if (isStream(value)) {
      this.parts.push({contentType, filename, name, stream: value, value: []});
      return;
    }

    let fileValue: MultipartFileValue;
    if (isBlob(value)) {
      fileValue = value;
      // like `append()`, a blob's own type is used if none is given
      contentType = contentType || value.type || undefined;
    } else if (isArrayBuffer(value)) {
      fileValue = new Uint8Array(value);
    } else if (isArrayBufferView(value)) {
      fileValue = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
      fileValue = Buffer.from(toWellFormed(String(value)));
    }
    this.parts.push({contentType, filename, name, value: fileValue});
  }

  /**
   * Reads the pending streams into chunks, once (the body is shared with clones and concurrent sends)
   * The chunks are held so the body can be sent again, pass a blob to stream a file from disk instead
   */
  resolveStreams(): Promise<void> {
    if (!this._resolvingStreams) {
      this._resolvingStreams = (async () => {
        for (let part of this.parts) {
          if (part.stream) {
            const stream = part.stream;
            part.value = await readStreamChunks(stream);
            delete part.stream;
          }
        }
      })();
    }
    return this._resolvingStreams;
  }

  /**
   * A new stream of the body and its length, can be called for every send
   */
  encode(): {length: number, stream: ReadableStream<Uint8Array>} {
    if (this.hasPendingStreams) {
      throw new Error('Multipart body has unread streams, call `resolveStreams()` first.');
    }

    const prefix = `--${this.boundary}\r\nContent-Disposition: form-data`;
    const encoded: Array<Uint8Array | Blob | Array<Uint8Array>> = [];
    let length = 0;
    for (let part of this.parts) {
      const name = formdataEscape(normalizeLinefeeds(part.name));
      if (typeof(part.value) === 'string') {
        const chunk = Buffer.from(`${prefix}; name="${name}"\r\n\r\n${normalizeLinefeeds(part.value)}\r\n`);
        encoded.push(chunk);
        length += chunk.byteLength;
      } else {
        const header = Buffer.from(
          `${prefix}; name="${name}"` +
          ((part.filename) ? `; filename="${formdataEscape(part.filename)}"` : '') + '\r\n' +
          `Content-Type: ${part.contentType || 'application/octet-stream'}\r\n\r\n`,
        );
        encoded.push(header, part.value, CRLF);
        length += header.byteLength + fileValueLength(part.value) + CRLF.byteLength;
      }
    }
    // undici (and curl) end with a CRLF for legacy servers
    const end = Buffer.from(`--${this.boundary}--\r\n`);
    encoded.push(end);
    length += end.byteLength;

    const iterator = iterateEncoded(encoded);
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
      async cancel(reason) {
        await iterator.return(reason);
      },
    }, {highWaterMark: 0});
    return {length, stream};
  }
}


async function * iterateEncoded(encoded: Array<Uint8Array | Blob | Array<Uint8Array>>): AsyncGenerator<Uint8Array> {
  for (let value of encoded) {
    if (isBlob(value)) {
      // a slice at a time, an in-memory blob's `stream()` would give the whole blob as one copied chunk
      const blob = value as Blob;
      for (let start = 0; start < blob.size; start += MULTIPART_CHUNK_SIZE) {
        const end = Math.min(start + MULTIPART_CHUNK_SIZE, blob.size);
        yield new Uint8Array(await blob.slice(start, end).arrayBuffer());
      }
    } else if (Array.isArray(value)) {
      for (let chunk of value) {
        yield * iterateBytes(chunk);
      }
    } else {
      yield * iterateBytes(value as Uint8Array);
    }
  }
}


function * iterateBytes(bytes: Uint8Array): Generator<Uint8Array> {
  // views into the caller's buffer, nothing is copied
  for (let start = 0; start < bytes.byteLength; start += MULTIPART_CHUNK_SIZE) {
    yield bytes.subarray(start, start + MULTIPART_CHUNK_SIZE);
  }
}


function fileValueLength(value: MultipartFileValue): number {
  if (isBlob(value)) {
    return (value as Blob).size;
  }
  if (Array.isArray(value)) {
    return value.reduce((x, chunk) => x + chunk.byteLength, 0);
  }
  return (value as Uint8Array).byteLength;
}


/**
 * Reads a node or web stream into its chunks, a string chunk becomes its utf-8 bytes
 */
export async function readStreamChunks(stream: any): Promise<Array<Uint8Array>> {
  const chunks: Array<Uint8Array> = [];
  const add = (chunk: any) => {
    if (typeof(chunk) === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (chunk && chunk.byteLength) {
      chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
  };
  if (typeof(stream.getReader) === 'function') {
    const reader = (stream as ReadableStream).getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      add(result.value);
    }
  } else {
    for await (let chunk of stream) {
      add(chunk);
    }
  }
  return chunks;
}


/*! formdata-polyfill. MIT License. Jimmy Wärting <https://jimmy.warting.se/opensource> */
function formdataEscape(value: string): string {
  return value.replace(/\n/g, '%0A').replace(/\r/g, '%0D').replace(/"/g, '%22');
}


function normalizeLinefeeds(value: string): string {
  return value.replace(/\r?\n|\r/g, '\r\n');
}


function toWellFormed(value: string): string {
  // `FormData` converts values to USVStrings, a lone surrogate becomes U+FFFD
  return (typeof((value as any).toWellFormed) === 'function') ? (value as any).toWellFormed() : value;
}
