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
})();

if (tryHttp2) {
	try {
		Communications.HTTP2 = require('http2');
		ALPNProtocols.push('h2');
	} catch(e) {}
}


const Encoders = {
	Zlib: require('zlib')
};

const AcceptedEncodings = ['gzip', 'deflate'];

try {
	Encoders.Brotli = require('iltorb');
	AcceptedEncodings.push('br');
} catch(e) {}

const Response = require('./response');
const Utils = require('./utils');
const UrlUtils = require('url');

class Request
{
	constructor(client, options)
	{
		this.client = client;

		this.settings = Object.assign({}, this.client.settings);
		if (options.settings) {
			Object.keys(this.settings).forEach((key) => {
				if (options.settings[key] === undefined) {return;}
				this.settings[key] = options.settings[key];
			});
		}

		this.url = options.url || {};
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
					this.body.add(`file${key}`, value.file, value.name);
				});
			}
			if (options.body) {
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
			this.options.headers['content-type'] = 'application/json'; //get charset somehow?
			this.body = JSON.stringify(options.body);
		}

		this.retries = 0;
	}

	get formatted()
	{
		return `${this.options.method}-${UrlUtils.format(this.url)}`;
	}
	
	send()
	{
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

					socket.once('secureConnect', () => {
						if (!socket.authorized) {} // shrug lol
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
		}).then((response) => {
			return new Promise((resolve, reject) => {
				response.stream.once('aborted', () => {
					reject(new Error(`Response was aborted by the server. [${this.formatted}]`));
				});

				let stream = response.stream;
				if (![204, 304].includes(response.statusCode) && response.headers['content-encoding']) {
					//so we decompress in the order they're telling us to
					for (let format of response.headers['content-encoding'].split(',')) {
						format = format.trim();
						if (!AcceptedEncodings.includes(format)) {return reject(new Error(`Received unsupported encoding: ${format}.`));}

						switch (format) {
							case 'gzip': stream = stream.pipe(Encoders.Zlib.createGunzip()); break;
							case 'deflate': stream = stream.pipe(Encoders.Zlib.createDeflate()); break;
							case 'br': stream = stream.pipe(Encoders.Brotli.decompressStream()); break;
						}
					}
				}

				const data = [];
				stream.on('data', data.push.bind(data)).once('end', () => {
					if (response.info.alpn === 'h2') {
						if (!response.stream.closed) {
							response.stream.close();
						}
						if (!response.info.connection.closed) {
							response.info.connection.close();
						}
					}

					if (data) {
						const contentType = (response.headers['content-type'] || '').split(';').shift();
						switch (contentType) {
							case 'application/json': {
								try {
									response.body = JSON.parse(Buffer.concat(data).toString());
								} catch(e) {return reject(e);}
							}; break;
							default: response.body = Buffer.concat(data);
						}
					}

					if (200 <= response.statusCode && response.statusCode < 300) {
						resolve(response);
					} else if (response.statusCode === 502 && this.settings.maxRetries) {
						if (this.settings.maxRetries !== -1 && this.retries++ >= this.settings.maxRetries) {
							return reject(new Error(`HTTP Exception: ${response.statusCode}, reached ${this.settings.maxRetries} retries.`));
						}
						setTimeout(() => {
							this.send().then(resolve).catch(reject);
						}, this.retryDelay);
					} else {
						reject(new Error(`HTTP Exception: ${response.statusCode}`));
					}
				});
			}).catch((e) => {
				if (!e.response) {e.response = response;}
				return Promise.reject(e);
			});
		});
	}
}

module.exports = Request;