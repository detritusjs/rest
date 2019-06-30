import {
  ALPNProtocols,
  HTTPHeaders,
  HTTPHeadersInterface,
  HTTPStatusCodes,
  SupportedContentTypes,
} from './constants';
import { decodeMultiple } from './encoder';
import { ResponseError } from './errors';
import { Request } from './request';


const EmptyBodyCodes: Array<HTTPStatusCodes> = [
  HTTPStatusCodes.NO_CONTENT,
  HTTPStatusCodes.NOT_MODIFIED
];


export class Response {
  alpn: string;
  connection: any;
  contentType: string;
  data: any;
  headers: HTTPHeadersInterface;
  request: Request;
  statusCode: number;
  stream: any;
  took: number;

  constructor(
    request: Request,
    response: any,
    info: {
      alpn: string,
      connection?: any,
    },
    took: number,
    headers?: HTTPHeadersInterface,
  ) {
    this.request = request;
    this.took = took;

    switch (info.alpn) {
      case ALPNProtocols.NONE:
      case ALPNProtocols.HTTP1:
      case ALPNProtocols.HTTP1_1: {
        this.headers = response.headers;
        this.statusCode = response.statusCode;
      }; break;
      case ALPNProtocols.HTTP2: {
        this.headers = headers || {};
        this.statusCode = parseInt(this.headers[HTTPHeaders.HTTP2_STATUS]);
      }; break;
      default: {
        throw new ResponseError(`Invalid ALPN Protocol: ${info.alpn}`, this);
      };
    }

    this.alpn = info.alpn;
    this.connection = info.connection;
    this.data = undefined;
    this.stream = response;

    Object.defineProperties(this, {
      connection: {enumerable: false, writable: false},
      stream: {enumerable: false, writable: false},
    });

    this.contentType = (this.headers[HTTPHeaders.CONTENT_TYPE] || '').split(';').shift() || '';
  }

  get ok(): boolean {
    return HTTPStatusCodes.OK <= this.statusCode && this.statusCode < HTTPStatusCodes.MULTIPLE_CHOICES;
  }

  close(): void {
    // if you dont get/want data, use this if http2 is used
    if (this.alpn === ALPNProtocols.HTTP2) {
      if (!this.stream.closed) {
        this.stream.close();
      }
      if (!this.connection.closed) {
        this.connection.close();
      }
    }
  }

  buffer(): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      if (this.stream.closed) {
        if (this.data !== undefined) {
          return resolve(this.data);
        } else {
          return reject(new ResponseError(`Cannot get the body of a closed response.`, this));
        }
      }
      this.stream.once('aborted', () => {
        reject(new ResponseError(`Response was aborted by the server.`, this));
      });

      let stream = this.stream;
      if (
        HTTPHeaders.CONTENT_ENCODING in this.headers &&
        this.headers[HTTPHeaders.CONTENT_LENGTH] !== '0' &&
        !EmptyBodyCodes.includes(this.statusCode)
      ) {
        stream = decodeMultiple(stream, this.headers[HTTPHeaders.CONTENT_ENCODING].split(','));
      }

      const body: Array<Buffer> = [];
      stream.on('data', (data: Buffer) => {
        body.push(data);
      }).once('end', () => {
        this.close();

        if (body.length) {
          if (body.length === 1) {
            this.data = body.shift();
          } else {
            this.data = Buffer.concat(body);
          }
        }

        resolve(this.data);
      });
    });
  }

  async body(): Promise<any> {
    const buffer = await this.buffer();
    switch (this.contentType) {
      case SupportedContentTypes.APPLICATION_JSON: {
        return JSON.parse(String(buffer));
      };
      case SupportedContentTypes.TEXT_PLAIN: {
        return String(buffer);
      };
      default: {
        if (this.contentType.startsWith('text/')) {
          return String(buffer);
        }
      };
    }
    return buffer;
  }

  async json(): Promise<any> {
    const buffer = await this.buffer();
    return JSON.parse(String(buffer));
  }

  async text(): Promise<string> {
    const buffer = await this.buffer();
    return String(buffer);
  }

  toString() {
    return this.request.toString();
  }
}
