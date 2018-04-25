'use strict';

class Response
{
	constructor(request, response, info, took, headers)
	{
		this.request = request;

		switch (info.alpn) {
			case 'http/1.1': {
				this.headers = response.headers;
				this.statusCode = response.statusCode;
			}; break;
			case 'h2': {
				this.headers = headers;
				this.statusCode = headers[':status'];
			}; break;
		}

		this.info = info;
		this.took = took;

		Object.defineProperty(this, 'stream', {
			value: response,
			enumerable: false
		});

		this.body = null;
	}
}

module.exports = Response;