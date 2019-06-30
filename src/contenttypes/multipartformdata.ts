import { SupportedContentTypes } from '../constants';


const LINE_BREAK = '\r\n';

function generateBoundary(): string {
  let boundary = '-'.repeat(26);
  for (let i = 0; i < 24; i++) {
    boundary += Math.floor(Math.random() * 10).toString(16);
  }
  return boundary;
}

export class MultipartFormData {
  boundary: string;
  buffers: Array<Buffer>;
  contentType: string;
  locked: boolean;

  constructor(boundary?: string) {
    this.boundary = boundary || generateBoundary();
    this.contentType = `${SupportedContentTypes.MULTIPART_FORM_DATA}; boundary=${this.boundary}`;

    this.buffers = [];

    this.locked = false;
  }

  add(
    field: string,
    value: any,
    options?: {
      contentType?: string,
      filename: string,
    } | string,
  ) {
    if (this.locked) {
      throw new Error('Cannot add fields to a finished multipart form.');
    }

    if (typeof(options) === 'string') {
      options = {filename: options};
    } else {
      options = Object.assign({}, options);
    }

    if (typeof(value) === 'number') {
      value = String(value);
    }

    const data: Array<string> = [
      `--${this.boundary}`,
      [
        `Content-Disposition: form-data`,
        `name="${encodeURIComponent(field)}"`,
        options.filename && `filename="${encodeURIComponent(options.filename)}"`,
      ].filter((v) => v).join('; '),
    ];

    let contentType: string | undefined;
    if (value instanceof Buffer) {
      contentType = options.contentType;
      if (!contentType) {
        // lookup in mimetypes?
      }

      if (!contentType) {
        contentType = SupportedContentTypes.APPLICATION_OCTET_STREAM;
      }
    } else if (typeof(value) === 'object') {
      contentType = SupportedContentTypes.APPLICATION_JSON;
      value = Buffer.from(JSON.stringify(value));
    } else {
      contentType = options.contentType;
      value = Buffer.from(value);
    }

    if (contentType) {
      data.push(`Content-Type: ${contentType}`);
    }

    this.buffers.push(Buffer.from(LINE_BREAK + data.join(LINE_BREAK) + LINE_BREAK.repeat(2)));
    this.buffers.push(value);
  }

  done() {
    if (!this.locked) {
      this.locked = true;
      this.buffers.push(Buffer.from(`${LINE_BREAK}--${this.boundary}--`));
    }
    return this.buffers;
  }
}
