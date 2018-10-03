'use strict';

const {createHash} = require('crypto');
const {inspect} = require('util');

const inspectWithKind = require('inspect-with-kind');
const {parse} = require('content-type');
const {Parser} = require('htmlparser2');

const TMP_HEADER_NAME = 'nodejs-inject-body-temporary-header-name';

function md5Base64(buf) {
	return createHash('md5').update(buf).digest('base64');
}

function main(res, injectChunk, etag) {
	if (res === null || typeof res !== 'object' || typeof res.setHeader !== 'function') {
		throw new TypeError(`Expected a ServerResponse object, but got ${inspectWithKind(res)}.`);
	}

	// to ensure `response.setHeader()` works
	// ref. https://nodejs.org/api/http.html#http_response_writehead_statuscode_statusmessage_headers
	// If this method is called and `response.setHeader()` has not been called,
	// it will directly write the supplied header values onto the network channel without caching internally,
	// and the `response.getHeader()` on the header will not yield the expected result.
	// If progressive population of headers is desired with potential future retrieval and modification,
	// use `response.setHeader()` instead.
	res.setHeader(TMP_HEADER_NAME, '1');
	res.removeHeader(TMP_HEADER_NAME);

	const write = res.write.bind(res);
	const end = res.end.bind(res);
	const setHeader = res.setHeader.bind(res);
	const buffers = [];
	let willEnd = false;
	let len = 0;
	let isHtml = false;
	let parser = new Parser({
		onopentag(tagName) {
			if (!parser) {
				return;
			}

			if (tagName !== 'body') {
				return;
			}

			if (!isHtml) {
				parser.end();
				return;
			}

			const insertionIndex = parser.endIndex + 1;
			const html = Buffer.concat(buffers, len).toString();

			buffers.splice(
				0,
				buffers.length,
				Buffer.from(`${html.slice(0, insertionIndex)}${injectChunk.toString()}${html.slice(insertionIndex)}`)
			);

			len += injectChunk.length;

			parser.end();
		},
		onend() {
			parser = null;
		}
	});

	function adjustContentLength(originalContentLengthHeaderValue) {
		const originalContentLength = Number(originalContentLengthHeaderValue);

		if (!Number.isInteger(originalContentLength) || originalContentLength < 0) {
			const error = new Error(`According to RFC7230, Content-Length header must be a non-negative integer https://tools.ietf.org/html/rfc7230#section-3.3.2, but it was ${
				inspect(originalContentLengthHeaderValue)
			}.`);

			res.emit('error', error);
			return;
		}

		if (isHtml) {
			setHeader('content-length', `${originalContentLength + injectChunk.length}`);
		}
	}

	if (res.hasHeader('content-type')) {
		isHtml = res.getHeader('content-type') === 'text/html';

		if (res.hasHeader('content-length')) {
			adjustContentLength(res.getHeader('content-length'));
		}
	}

	if (isHtml && res.hasHeader('etag')) {
		setHeader('etag', `${res.getHeader('etag')}${etag || md5Base64(injectChunk)}`);
	}

	res.setHeader = (headerName, headerValue) => {
		if (Array.isArray(headerValue)) {
			setHeader(headerName, headerValue);
			return;
		}

		const lowerCaseHeaderName = headerName.toLowerCase();

		if (lowerCaseHeaderName === 'content-length') {
			adjustContentLength(headerValue);
			return;
		}

		if (isHtml && lowerCaseHeaderName === 'etag') {
			headerValue = `${headerValue}${etag || md5Base64(injectChunk)}`;
		} else if (lowerCaseHeaderName === 'content-type') {
			if (parse(headerValue).type === 'text/html') {
				isHtml = true;
			} else {
				parser.end();
			}
		}

		setHeader(headerName, headerValue);
	};

	// No need to patch `res.writeHead()` here because it calls `res.setHeader()` internally
	// https://github.com/nodejs/node/blob/v10.8.0/lib/_http_server.js#L231

	res.write = (data, ...restArgs) => {
		const [encoding] = restArgs;

		if (isHtml && encoding && typeof encoding !== 'function' && !/utf-?8/ui.test(encoding)) {
			const error = new Error(`HTML must be UTF-8 encoded https://github.com/w3c/html/pull/1273, but encoded in ${
				encoding
			}.`);
			error.code = 'ERR_INVALID_HTML_ENCODING';

			res.emit('error', error);
			return;
		}

		if (!Buffer.isBuffer(data)) {
			data = Buffer.from(data);
		}

		if (parser) {
			len += data.length;
			buffers.push(data);

			if (willEnd) {
				parser.parseComplete(data);
			} else {
				parser.write(data);

				if (typeof restArgs[restArgs.length - 1] === 'function') {
					restArgs[restArgs.length - 1]();
				}

				return;
			}
		} else if (!willEnd && buffers.length !== 0) {
			write(Buffer.concat([...buffers.splice(0, buffers.length), data], len + data.length), ...restArgs);
			return;
		} else if (willEnd) {
			buffers.push(data);
		}

		if (willEnd) {
			if (buffers.length === 1) {
				end(Buffer.from(buffers[0]), ...restArgs);
				return;
			}

			end(Buffer.concat(buffers, len), ...restArgs);
			return;
		}

		write(data, ...restArgs);
	};

	res.end = (data, ...restArgs) => {
		willEnd = true;

		if (typeof data === 'function') {
			res.write(Buffer.alloc(0), data);
			return;
		}

		res.write(data || Buffer.alloc(0), ...restArgs);
	};
}

module.exports = function injectBody(...args) {
	const argLen = args.length;

	if (argLen !== 2) {
		throw new RangeError(`Expected 2 arguments (<http.ServerResponse>, <Buffer>), but got ${
			argLen === 0 ? 'no' : argLen
		} arguments.`);
	}

	if (!Buffer.isBuffer(args[1])) {
		throw new TypeError(`Expected a code to inject to HTML <body>s (<Buffer>), but got ${
			inspectWithKind(args[1])
		}.`);
	}

	main(...args);
};

function injectBodyFromClass(...args) {
	const argLen = args.length - 2;

	if (argLen !== 1) {
		throw new RangeError(`Expected 1 argument (<http.ServerResponse>), but got ${
			argLen === 0 ? 'no' : argLen
		} arguments.`);
	}

	main(args[2], args[0], args[1]);
}

module.exports.InjectBody = class InjectBody {
	constructor(...args) {
		const argLen = args.length;

		if (argLen !== 1) {
			throw new RangeError(`Expected 1 argument (<Buffer>), but got ${argLen || 'no'} arguments.`);
		}

		if (!Buffer.isBuffer(args[0])) {
			throw new TypeError(`Expected a code to inject to HTML <body>s (<Buffer>), but got ${
				inspectWithKind(args[0])
			}.`);
		}

		return injectBodyFromClass.bind(null, args[0], md5Base64(args[0]));
	}
};
