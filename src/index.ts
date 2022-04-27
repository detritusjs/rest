import * as Constants from './constants';

export { Constants };

export * from './client';
export * from './request';
export * from './response';
export * from './route';


const nodeVersion = process.versions.node.split('.')
const nodeMajor = Number(nodeVersion[0]);
const nodeMinor = Number(nodeVersion[1]);
if (nodeMajor < 16 || (nodeMajor === 16 && nodeMinor < 5)) {
  throw new Error('Node version must be above 16.5.0 to use this library!');
}
