export interface RouteParameters {
  [key: string]: any,
}

export class Route {
  method: string;
  params: RouteParameters;
  path: string;
  urlPath: string;

  constructor(
    method: string,
    path: string = '',
    params: RouteParameters = {},
  ) {
    this.method = method.toUpperCase();
    this.path = path;
    this.params = params;

    this.urlPath = replacePathParameters(path, params);
  }
}


export const PathReplacementRegexp = /:(\w+):?/g;
const DotSegmentRegexp = /^\.+$/;
export function replacePathParameters(
  path: string,
  parameters: RouteParameters = {},
): string {
  return path.replace(PathReplacementRegexp, (match: string, key: string) => {
    if (Object.prototype.hasOwnProperty.call(parameters, key) && parameters[key] !== undefined) {
      const value = encodeURIComponent(String(parameters[key]));
      if (DotSegmentRegexp.test(value)) {
        // a `.` or `..` segment would climb out of the path, and the parser treats `%2E` as a dot too
        return value.replace(/\./g, '%252E');
      }
      return value;
    }
    // leave unknown placeholders alone, paths can contain literal colons (like `/v1/projects:batchGet`)
    return match;
  });
}
