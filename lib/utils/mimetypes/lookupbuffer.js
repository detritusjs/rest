const bufferChecks = require('./bufferchecks');

module.exports = function(input) {
	const buffer = (input instanceof Uint8Array) ? input : Uint8Array.from(input);
	if (!buffer || !buffer.length) {return null;}

	for (let mimetype of bufferChecks) {
		const match = mimetype.checks.some((check) => {
			return Object.keys(check).every((key) => {
				const value = check[key];
				switch (typeof(check[key])) {
					case 'number': {
						return buffer[key] === check[key];
					}; break;
					case 'object': {
						if (Array.isArray(check[key])) {
							return check[key].some((v) => v === value);
						}
					}; break;
				}
			});
		});
		if (match) {
			return mimetype;
		}
	}

	// https://github.com/threatstack/libmagic/blob/master/magic/Magdir/matroska
	if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
		const sliced = buffer.subarray(4, 4 + 4096);
		const idPos = sliced.findIndex((x, i) => sliced[i] === 0x42 && sliced[i + 1] === 0x82);
	
		if (~idPos) {
		  const docTypePos = idPos + 3;
		  const findDocType = (type) => Array.from(type).every((c, i) => sliced[docTypePos + i] === c.charCodeAt(0));

			if (findDocType('matroska')) {
				return {
					mime: 'video/x-matroska',
					ext: 'mkv',
					checks: []
				};
			} else if (findDocType('webm')) {
				return {
					mime: 'video/webm',
					ext: 'webm',
					checks: []
				};
			}
		}	
	}
	return null;
};