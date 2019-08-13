import * as Zlib from 'zlib';


enum Encodings {
  BR = 'br',
  DEFLATE = 'deflate',
  GZIP = 'gzip',
}

const AcceptedEncodings: Array<string> = [Encodings.GZIP, Encodings.DEFLATE];

const Encoders: {
  Brotli: any,
  Zlib: any,
} = {
  Brotli: null,
  Zlib,
};

if (Zlib.createBrotliCompress) {
  AcceptedEncodings.push(Encodings.BR);
} else {
  try {
    Encoders.Brotli = require('iltorb');
    AcceptedEncodings.push(Encodings.BR);
  } catch(e) {}
}


export {
  AcceptedEncodings,
  Encoders,
};

export function decode(stream: any, format: string) {
  format = format.trim();
  if (!AcceptedEncodings.includes(format)) {
    throw new Error(`Received unsupported encoding: ${format}.`);
  }

  switch (format) {
    case Encodings.BR: {
      if (Zlib.createBrotliCompress) {
        stream = stream.pipe(Encoders.Zlib.createBrotliDecompress());
      } else {
        stream = stream.pipe(Encoders.Brotli.decompressStream());
      }
    }; break;
    case Encodings.DEFLATE: stream = stream.pipe(Encoders.Zlib.createInflate()); break;
    case Encodings.GZIP: stream = stream.pipe(Encoders.Zlib.createGunzip()); break;
  }

  return stream;
};

export function decodeMultiple(stream: any, formats: string | Array<string>) {
  if (typeof(formats) === 'string') {
    stream = decode(stream, formats);
  } else {
    for (let format of formats) {
      stream = decode(stream, format);
    }
  }
  return stream;
};
