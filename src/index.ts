import * as Constants from './constants';

export { Constants };

export * from './client';
export * from './request';
export * from './response';
export * from './route';


const nodeVersion = process.versions.node.split('.')
const nodeMajor = Number(nodeVersion[0]);
const nodeMinor = Number(nodeVersion[1]);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 19)) {
  throw new Error('Node version must be 22.19.0 or above to use this library!');
}
