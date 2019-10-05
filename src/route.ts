export interface RouteParameters {
  [key: string]: string,
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
export function replacePathParameters(
  path: string,
  parameters: RouteParameters = {},
): string {
  return path.replace(PathReplacementRegexp, (match: string, key: string) => {
    if (key in parameters) {
      return encodeURIComponent(parameters[key]);
    }
    return match;
  });
}
