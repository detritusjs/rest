'use strict';

const Mimetypes = require('./mimetypes');

const LINE_BREAK = '\r\n';

const generateBoundary = function() {
	let boundary = '-'.repeat(26);
	for (var i = 0; i < 24; i++) {
		boundary += Math.floor(Math.random() * 10).toString(16);
	}
	return boundary;
};

class MultipartFormData
{
	constructor(boundary)
	{
		this.boundary = boundary || generateBoundary();
		this.contentType = ['multipart/form-data', `boundary=${this.boundary}`].join('; ');

		this.buffers = [];

		this.locked = false;
	}

	add(field, value, options)
	{
		if (this.locked) {throw new Error('Cannot add fields to a finished multipart form');}

		options = options || {};
		if (typeof(options) === 'string') {
			options = {filename: options};
		}
		if (typeof(value) === 'number') {
			value = value.toString();
		}
		const data = [];
		data.push(`--${this.boundary}`);
		data.push([
			'Content-Disposition: form-data',
			`name="${field}"`,
			options.filename && `filename="${options.filename}"`
		].filter((v) => v).join('; '));

		let contentType;
		if (value instanceof Buffer) {
			contentType = options.contentType;
			if (!contentType) {
				const lookup = Mimetypes.lookup.buffer(value);
				if (lookup) {
					contentType = lookup.mime;
				}
			}
			//discover the content type if not already provided in the options
			contentType = contentType || 'application/octet-stream';
		} else if (typeof(value) === 'object') {
			//get encoding used
			contentType = 'application/json';
			value = new Buffer(JSON.stringify(value));
		} else {
			contentType = options.contentType;
			value = new Buffer(value);
		}

		if (contentType) {data.push(`Content-Type: ${contentType}`);}

		this.buffers.push(new Buffer(LINE_BREAK + data.join(LINE_BREAK) + LINE_BREAK.repeat(2)));
		this.buffers.push(value);
	}

	done()
	{
		if (!this.locked) {
			this.locked = true;
			this.buffers.push(new Buffer(`${LINE_BREAK}--${this.boundary}--`));
		}
		return this.buffers;
	}
}

module.exports = MultipartFormData;