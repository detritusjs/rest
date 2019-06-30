import * as HTTP from 'http';
import * as HTTPS from 'https';
import * as TLS from 'tls';

import { ALPNProtocols } from './constants';


const AvailableALPNProtocols: Array<ALPNProtocols> = [
  ALPNProtocols.HTTP1_1,
  ALPNProtocols.HTTP1,
];

const Communications: {
  HTTP: any,
  HTTPS: any,
  TLS: any,
  HTTP2: any,
} = {
  HTTP,
  HTTPS,
  TLS,
  HTTP2: null,
};


const tryHTTP2 = (() => {
  const version = process.version.split('.').map((x, i) => parseInt((!i) ? x.slice(1) : x));
  if (version[0] >= 9) {
    if (version[0] === 9) {
      // https://nodejs.org/en/blog/release/v9.8.0/ http2 fix on this version
      return version[1] >= 8;
    }
    return true;
  }
  return false;
})();

if (tryHTTP2) {
  try {
    Communications.HTTP2 = require('http2');
    AvailableALPNProtocols.unshift(ALPNProtocols.HTTP2);
  } catch(e) {}
}

export { AvailableALPNProtocols, Communications };
