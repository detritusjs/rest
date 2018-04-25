'use strict';

class Route
{
	constructor(method, path, params)
	{
		this.method = method.toUpperCase();
		this.path = path;

		this.urlPath = this.path;
		for (let key in (params || {})) {
			this.urlPath = this.urlPath.replace(`:${key}:`, encodeURIComponent(params[key]));
		}

		this.params = params;
	}
}

module.exports = Route;