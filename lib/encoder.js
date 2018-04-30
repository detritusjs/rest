const Encoders = {
	Zlib: require('zlib')
};

const AcceptedEncodings = ['gzip', 'deflate'];

try {
	Encoders.Brotli = require('iltorb');
	AcceptedEncodings.push('br');
} catch(e) {}

module.exports = {
	AcceptedEncodings,
	Encoders,
	decode: function (stream, formats) {
		if (typeof(formats) === 'string') {formats = [formats];}
		//so we decompress in the order they're telling us to
		for (let format of formats) {
			format = format.trim();
			if (!AcceptedEncodings.includes(format)) {throw new Error(`Received unsupported encoding: ${format}.`);}

			switch (format) {
				case 'gzip': stream = stream.pipe(Encoders.Zlib.createGunzip()); break;
				case 'deflate': stream = stream.pipe(Encoders.Zlib.createInflate()); break;
				case 'br': stream = stream.pipe(Encoders.Brotli.decompressStream()); break;
			}
		}
		return stream;
	}
};