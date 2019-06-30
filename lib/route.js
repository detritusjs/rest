"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Route {
    constructor(method, path = '', params = {}) {
        this.method = method;
        this.path = path;
        this.params = params;
        this.urlPath = replacePathParameters(path, params);
    }
}
exports.Route = Route;
function replacePathParameters(path, parameters = {}) {
    for (let key in parameters) {
        path = path.replace(`:${key}:`, encodeURIComponent(parameters[key]));
    }
    return path;
}
exports.replacePathParameters = replacePathParameters;
