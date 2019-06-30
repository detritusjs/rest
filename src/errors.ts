import { Request } from './request';
import { Response } from './response';

class BaseError extends Error {
  error: any;

  constructor(error: any, prepend: string = '') {
    const message = (typeof(error) === 'string') ? error : error.message;
    super(prepend + message);
    this.error = error;
  }
}

export class RequestError extends BaseError {
  request: Request;

  constructor(error: any, request: Request) {
    super(error, `[${request}] - `);
    this.request = request;
  }
}

export class ResponseError extends BaseError {
  response: Response;

  constructor(error: any, response: Response) {
    super(error, `[${response}] - `);
    this.response = response;
  }
}
