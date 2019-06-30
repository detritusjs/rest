import {
  format as URLFormat,
  URL,
} from 'url';

import {
  AvailableALPNProtocols,
  Communications,
} from './communications';
import {
  ALPNProtocols,
  BodylessMethods,
  HTTPHeaders,
  HTTPHeadersInterface,
  HTTPProtocols,
  HTTPSPort,
  SupportedContentTypes,
} from './constants';
import { MultipartFormData } from './contenttypes';
import { AcceptedEncodings } from './encoder';
import { RequestError } from './errors';
import { Response } from './response';
import { Route } from './route';


interface RequestFile {
  contentType?: string,
  data: any,
  filename?: string,
  name?: string,
}

export interface BasicRequestOptions {
  body?: any,
  files?: Array<RequestFile>,
  headers?: HTTPHeadersInterface,
  jsonify?: boolean,
  multipart?: boolean,
}

export interface RequestSettings {
  multipartJsonKey?: string,
  timeout?: number,
}

interface RequestOptions extends BasicRequestOptions {
  method: string,
  route?: Route,
  settings: RequestSettings,
  url: URL,
}

export class Request {
  body: any;
  options: {
    headers: HTTPHeadersInterface,
    hostname: string,
    method: string,
    path: string,
    port: string,
    protocol: string,
  };
  route: Route | null;
  settings: RequestSettings;
  url: URL;

  constructor(options: RequestOptions) {
    this.settings = Object.assign({}, options.settings);

    this.url = options.url || {}
    if (!this.url.protocol) {
      this.url.protocol = 'https:';
    }

    this.options = {
      method: options.method,
      headers: options.headers || {},
      protocol: this.url.protocol,
      hostname: this.url.hostname,
      port: this.url.port,
      path: this.url.pathname + this.url.search,
    };

    if (AcceptedEncodings.length) {
      this.options.headers[HTTPHeaders.ACCEPT_ENCODING] = AcceptedEncodings.join(',');
    }

    if (!Object.values(HTTPProtocols).includes(this.url.protocol)) {
      throw new Error(`Protocol '${this.url.protocol}' not supported, only ${Object.values(HTTPProtocols).join(', ')}`);
    }

    this.body = null;
    if ((options.body && options.multipart) || (options.files && options.files.length)) {
      if (options.body instanceof MultipartFormData) {
        this.body = options.body;
      } else {
        this.body = new MultipartFormData();
      }
      this.options.headers[HTTPHeaders.CONTENT_TYPE] = this.body.contentType;

      if (options.files && options.files.length) {
        for (let key in options.files) {
          const file = options.files[key];
          this.body.add(file.name || `file${key}`, file.data, file);
        }
      }
      if (options.body && !(options.body instanceof MultipartFormData)) {
        if (options.multipart) {
          for (let key in options.body) {
            this.body.add(key, options.body[key]);
          }
        } else {
          const key = this.settings.multipartJsonKey || 'payload_json';
          this.body.add(key, options.body);
        }
      }
      this.body = this.body.done();
    } else if (options.body !== undefined) {
      if (options.jsonify || options.jsonify === undefined) {
        // maybe set charset?
        this.options.headers[HTTPHeaders.CONTENT_TYPE] = SupportedContentTypes.APPLICATION_JSON;
        this.body = JSON.stringify(options.body);
      } else {
        this.body = options.body;
      }
    }

    if (!(HTTPHeaders.CONTENT_LENGTH in this.options.headers) && !BodylessMethods.includes(this.method)) {
      let length = 0;
      if (this.body) {
        if (Array.isArray(this.body)) {
          for (let chunk of this.body) {
            length += Buffer.byteLength(chunk);
          }
        } else {
          length += Buffer.byteLength(this.body);
        }
      }
      this.options.headers[HTTPHeaders.CONTENT_LENGTH] = String(length);
    }

    this.route = options.route || null;
  }

  get method(): string {
    return this.options.method;
  }

  get formatted(): string {
    return this.toString();
  }

  _createRequest(): Promise<{
    request: any,
    info: {
      alpn: string,
      connection?: any,
    },
  }> {
    return new Promise((resolve, reject) => {
      switch (this.options.protocol) {
        case HTTPProtocols.HTTP: {
          resolve({
            request: Communications.HTTP.request({
              headers: this.options.headers,
              hostname: this.options.hostname,
              method: this.options.method,
              path: this.options.path,
              port: this.options.port,
              protocol: this.options.protocol,
            }),
            info: {alpn: ALPNProtocols.NONE},
          });
        }; break;
        case HTTPProtocols.HTTPS: {
          this.options.port = String(this.options.port || HTTPSPort);
          const socket = Communications.TLS.connect({
            host: this.options.hostname,
            port: parseInt(this.options.port),
            servername: this.options.hostname,
            ALPNProtocols: AvailableALPNProtocols,
          });

          socket.once('error', (error: any) => {
            socket.destroy();
            reject(new RequestError(error, this));
          });
          socket.once('secureConnect', () => {
            if (!socket.authorized) {
              socket.destroy();
              return reject(new RequestError(socket.authorizationError, this));
            }

            switch (socket.alpnProtocol) {
              case false:
              case ALPNProtocols.HTTP1:
              case ALPNProtocols.HTTP1_1: {
                resolve({
                  request: Communications.HTTPS.request({
                    createConnection: () => socket,
                    ...this.options,
                  }),
                  info: {
                    alpn: socket.alpnProtocol || ALPNProtocols.NONE,
                  },
                });
              }; break;
              case ALPNProtocols.HTTP2: {
                const connection = Communications.HTTP2.connect({
                  host: this.options.hostname,
                  port: parseInt(this.options.port),
                }, {
                  createConnection: () => socket,
                });

                const options = Object.assign({}, this.options.headers, {
                  ':method': this.options.method,
                  ':authority': this.options.hostname,
                  ':path': this.options.path,
                });

                resolve({
                  request: connection.request(options),
                  info: {
                    alpn: socket.alpnProtocol,
                    connection,
                  },
                });
              }; break;
              default: {
                socket.destroy();
                reject(new RequestError(`Invalid ALPN Protocol returned: ${socket.alpnProtocol}`, this));
              };
            }
          });
        }; break;
        default: {
          reject(new RequestError(`Invalid Request Protocol: ${this.options.protocol}`, this));
        };
      }
    });
  }

  async send(): Promise<any> {
    const { request, info } = await this._createRequest();

    return new Promise((resolve, reject) => {
      switch (info.alpn) {
        case ALPNProtocols.NONE:
        case ALPNProtocols.HTTP1:
        case ALPNProtocols.HTTP1_1: {
          let error: RequestError | Error;
          request.once('error', (e: any) => {
            error = e;
            request.abort();
          }).once('abort', () => {
            if (error) {
              error = new RequestError(error, this);
            } else {
              error = new RequestError(`Request aborted by the client.`, this);
            }
            reject(error);
          });

          const now = Date.now();
          request.once('response', (response: any) => {
            resolve(new Response(this, response, info, Date.now() - now));
          }).setTimeout(this.settings.timeout, () => {
            error = new Error(`[Request lasted for more than ${this.settings.timeout}ms.`);
            request.abort();
          });
        }; break;
        case ALPNProtocols.HTTP2: {
          let error: RequestError | Error;
          request.once('error', (e: any) => {
            error = e;
          }).once('close', () => {
            if (!error) {return;}
            info.connection.close();
            error = new RequestError(error, this);
            reject(error);
          });

          const now = Date.now();
          request.once('response', (headers: HTTPHeadersInterface) => {
            resolve(new Response(this, request, info, Date.now() - now, headers));
          }).setTimeout(this.settings.timeout, () => {
            error = new Error(`Request lasted for more than ${this.settings.timeout}ms.`);
            request.close();
          });
        }; break;
      }

      if (Array.isArray(this.body)) {
        for (let chunk of this.body) {
          request.write(chunk);
        }
        request.end();
      } else {
        request.end(this.body);
      }
    });
  }

  toString() {
    return `${this.options.method}-${URLFormat(this.url)}`;
  }
}
