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


export function replacePathParameters(
  path: string,
  parameters: RouteParameters = {},
): string {
  for (let key in parameters) {
    path = path.replace(`:${key}:`, encodeURIComponent(parameters[key]));
  }
  return path;
}
