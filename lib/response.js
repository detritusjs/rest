'use strict';

const Encoder = require('./encoder');

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

		this.data = null;
	}

	get ok()
	{
		return 200 <= this.statusCode && this.statusCode < 300;
	}

	close()
	{
		//if you dont get data, use this if http2 is used
		if (this.info.alpn === 'h2') {
			if (!this.stream.closed) {
				this.stream.close();
			}
			if (!this.info.connection.closed) {
				this.info.connection.close();
			}
		}
	}

	body()
	{
		return new Promise((resolve, reject) => {
			if (this.stream.closed) {
				return reject(new Error(`Cannot get the body of a closed response. [${this.request.formatted}]`));
			}
			this.stream.once('aborted', () => {
				reject(new Error(`Response was aborted by the server. [${this.request.formatted}]`));
			});

			let stream = this.stream;
			if (![204, 304].includes(this.statusCode) && this.headers['content-encoding']) {
				stream = Encoder.decode(stream, this.headers['content-encoding'].split(','));
			}

			const body = [];
			stream.on('data', body.push.bind(body)).once('end', () => {
				this.close();

				if (body.length) {
					const contentType = (this.headers['content-type'] || '').split(';').shift();
					switch (contentType) {
						case 'application/json': {
							try {
								this.data = JSON.parse(Buffer.concat(body).toString());
							} catch(e) {return reject(e);}
						}; break;
						case 'plain/text': {
							this.data = Buffer.concat(body).toString();
						}; break;
						default: this.data = Buffer.concat(body);
					}
				}

				resolve(this.data);
			});
		}).catch((e) => {
			if (!e.response) {e.response = this;}
			return Promise.reject(e);
		});
	}
}

module.exports = Response;