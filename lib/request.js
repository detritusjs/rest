'use strict';

const Communications = {
	HTTP: require('http'),
	HTTPS: require('https'),
	TLS: require('tls')
};

const ALPNProtocols = ['http/1.1'];

const tryHttp2 = (() => {
	const version = process.version.split('.').map((x, i) => parseInt((!i) ? x.slice(1) : x));
	return (version[0] >= 9 && version[1] >= 8);
})(); //https://nodejs.org/en/blog/release/v9.8.0/ http2 fix on this version

if (tryHttp2) {
	try {
		Communications.HTTP2 = require('http2');
		ALPNProtocols.push('h2');
	} catch(e) {}
}

const AcceptedEncodings = require('./encoder').AcceptedEncodings;

const Response = require('./response');
const Utils = require('./utils');
const UrlUtils = require('url');

class Request {
	constructor(client, options) {
		options = options || {};

		this.client = client;

		this.settings = Object.assign({}, this.client.settings);
		if (options.settings) {
			Object.keys(this.settings).forEach((key) => {
				if (options.settings[key] === undefined) {return;}
				this.settings[key] = options.settings[key];
			});
		}

		this.url = options.url || {};
		if (!this.url.protocol) {
			this.url.protocol = 'https:';
		}
		this.options = {
			method: options.method.toUpperCase(),
			headers: options.headers || {},
			protocol: this.url.protocol,
			hostname: this.url.hostname,
			port: this.url.port,
			path: [this.url.pathname, this.url.search].join('')
		};

		this.options.headers['accept-encoding'] = AcceptedEncodings.join(',');

		if (!['http:', 'https:'].includes(this.url.protocol)) {
			throw new Error(`Protocol not supported: ${this.url.protocol}`);
		}

		this.body = null;
		if ((options.body && options.multipart) || (options.files && options.files.length)) {
			if (options.body instanceof Utils.MultipartFormData) {
				this.body = options.body;
			} else {
				this.body = new Utils.MultipartFormData();
			}
			this.options.headers['content-type'] = this.body.contentType;

			if (options.files && options.files.length) {
				options.files.forEach((value, key) => {
					if (!value.file) {return;}
					this.body.add(value.name || `file${key}`, value.data || value.file, value);
				});
			}
			if (options.body && !(options.body instanceof Utils.MultipartFormData)) {
				if (options.multipart) {
					for (let key in options.body) {
						this.body.add(key, options.body[key]);
					}
				} else {
					this.body.add('payload_json', options.body);
				}
			}
			this.body = this.body.done();
		} else if (options.body) {
			if (options.jsonify || options.jsonify === undefined) {
				this.options.headers['content-type'] = 'application/json'; //get charset somehow?
				this.body = JSON.stringify(options.body);
			} else {
				this.body = options.body;
			}
		}

		this.route = options.route || null;
	}

	get formatted() {
		return this.toString();
	}
	
	send() {
		return new Promise((resolve, reject) => {
			switch (this.options.protocol) {
				case 'http:': {
					resolve({
						request: Communications.HTTP.request(this.options),
						info: {alpn: 'http/1.1'}
					});
				}; break;
				case 'https:': {
					const socket = Communications.TLS.connect({
						host: this.options.hostname,
						port: this.options.port || 443,
						servername: this.options.hostname,
						ALPNProtocols
					});

					socket.once('error', (error) => {
						error.request = this;
						reject(error);
					});
					socket.once('secureConnect', () => {
						if (!socket.authorized) {
							const error = socket.authorizationError;
							error.request = this;
							return reject(error);
						}
						switch (socket.alpnProtocol) {
							case 'http/1.1': {
								resolve({
									request: Communications.HTTPS.request(Object.assign({createConnection: () => socket}, this.options)),
									info: {alpn: socket.alpnProtocol}
								});
							}; break;
							case 'h2': {
								const connection = Communications.HTTP2.connect({
									host: this.options.hostname,
									port: this.options.port || 443
								}, {createConnection: () => socket});

								const options = Object.assign({}, this.options.headers, {
									':method': this.options.method,
									':authority': this.options.hostname,
									':path': this.options.path
								});

								resolve({
									request: connection.request(options),
									info: {alpn: socket.alpnProtocol, connection}
								});
							}; break;
							default: {
								reject(new Error(`Invalid ALPN Protocol returned: ${socket.alpnProtocol}`));
							};
						}
					});
				}; break;
				default: {
					return reject(new Error(`Invalid Request Protocol: ${this.options.protocol}`));
				};
			}
		}).then(({request, info}) => {
			return new Promise((resolve, reject) => {
				switch (info.alpn) {
					case 'http/1.1': {
						let error;
						request.once('error', (e) => {
							error = e;
							request.abort();
						}).once('abort', () => {
							error = error || new Error(`Request aborted by the client. [${this.formatted}]`);
							error.request = this;
							reject(error);
						});

						const now = Date.now();
						request.once('response', (response) => {
							resolve(new Response(this, response, info, Date.now() - now));
						}).setTimeout(this.settings.timeout, () => {
							error = new Error(`Request lasted for more than ${this.settings.timeout}ms. [${this.formatted}]`);
							request.abort();
						});
					}; break;
					case 'h2': {
						let error;
						request.once('error', (e) => {
							error = e;
						}).once('close', () => {
							if (!error) {return;}
							info.connection.close();
							error.request = this;
							reject(error);
						});

						const now = Date.now();
						request.once('response', (headers, flags) => {
							resolve(new Response(this, request, info, Date.now() - now, headers));
						}).setTimeout(this.settings.timeout, () => {
							error = new Error(`Request lasted for more than ${this.settings.timeout}ms. [${this.formatted}]`);
							request.close();
						});
					}; break;
				}

				if (Array.isArray(this.body)) {
					this.body.forEach((chunk) => {
						request.write(chunk);
					});
					request.end();
				} else {
					request.end(this.body);
				}
			});
		});
	}

	toString() {
		return `${this.options.method}-${UrlUtils.format(this.url)}`;
	}
}

module.exports = Request;