'use strict';

const {createServer, ServerResponse} = require('http');
const {createHash} = require('crypto');
const {promisify} = require('util');

const fetch = require('node-fetch');
const injectBody = require('.');
const noop = require('lodash/noop');
const test = require('tape');

test('injectBody()', async t => {
	const server = createServer((req, res) => {
		if (req.url.endsWith('html/')) {
			const html = Buffer.from('<html><head></head><body></body></html>');

			injectBody(res, Buffer.from('a🐠蓺'));

			res.writeHead(200, {
				'Content-Type': 'text/html',
				'Content-Length': `${Buffer.byteLength(html)}`,
				Etag: 'W/"5b61d9cd-2f857"'
			});

			res.end(html);
			return;
		}

		if (req.url.endsWith('double-body/')) {
			const html = '<html><head></head><body class="foo"></body><body></body></html>';

			res.setHeader('CONTENT-TYPE', 'text/html');
			res.setHeader('CONTENT-LENGTH', `${Buffer.byteLength(html)}`);
			res.setHeader('ETAG', 'abc');
			injectBody(res, Buffer.from([7]));
			res.setHeader('unrelated', 'header');
			res.setHeader('SET-COOKIE', ['type=ninja', 'language=javascript']);

			res.end(html);
			return;
		}

		if (req.url.endsWith('no-content-length/')) {
			res.setHeader('Content-typE', 'text/html');
			injectBody(res, Buffer.from('\t\n☺️'));
			res.write('<');
			res.write('BODY>', () => res.write('</BODY>', () => res.end(noop)));
			return;
		}

		if (req.url.endsWith('non-utf8-encoding/')) {
			res.setHeader('content-type', 'text/html');
			injectBody(res, Buffer.from('_'));

			res.on('error', ({message}) => {
				res.write(message, noop);
				res.end();
			}).write('🌊🏄‍🌊', 'ascii');
			return;
		}

		if (req.url.endsWith('plain-text/')) {
			res.setHeader('content-length', 2);
			res.setHeader('Etag', 'original-etag');
			injectBody(res, Buffer.from('c'));
			res.setHeader('content-type', 'text/plain');
			res.write('a');
			res.end('b');
			return;
		}

		if (req.url.endsWith('plain-text-with-body/')) {
			res.setHeader('content-type', 'text/plain');
			res.setHeader('content-length', 6);
			injectBody(res, Buffer.from('</body>'));
			res.end('<body>');
			return;
		}

		res.on('error', ({message}) => res.end(message));
		injectBody(res, Buffer.from('?'));
		res.setHeader('content-type', 'text/html');
		res.setHeader('content-length', '-1');
	});

	await promisify(server.listen.bind(server))(3018);
	await Promise.all([
		(async () => {
			t.equal(
				await (await fetch('http://localhost:3018/html/')).text(),
				'<html><head></head><body>a🐠蓺</body></html>',
				'should inject contents to the <body> tags.'
			);
		})(),
		(async () => {
			const response = await fetch('http://localhost:3018/double-body/');

			t.equal(
				await response.text(),
				'<html><head></head><body class="foo">\x07</body><body></body></html>',
				'should inject contents to only the first <body> tags.'
			);

			t.equal(
				response.headers.get('etag'),
				`abc${createHash('md5').update('\x07').digest('base64')}`,
				'should modify Etag if HTML response has `Etag` header.'
			);
		})(),
		(async () => {
			const response = await fetch('http://localhost:3018/no-content-length/');

			t.equal(
				await response.text(),
				'<BODY>\t\n☺️</BODY>',
				'should support response without Content-Length header.'
			);

			t.notOk(
				response.headers.has('etag'),
				'should not add Etag if the response has no `Etag` header.'
			);
		})(),
		(async () => {
			t.equal(
				await (await fetch('http://localhost:3018/non-utf8-encoding/')).text(),
				'HTML must be UTF-8 encoded https://github.com/w3c/html/pull/1273, but encoded in ascii.',
				'should invalidate non UTF-8 HTML.'
			);
		})(),
		(async () => {
			const response = await fetch('http://localhost:3018/plain-text/');

			t.equal(
				await response.text(),
				'ab',
				'should ignore non-HTML responses.'
			);

			t.equal(
				response.headers.get('etag'),
				'original-etag',
				'should not modify Etag of non-HTML responses.'
			);
		})(),
		(async () => {
			t.equal(
				await (await fetch('http://localhost:3018/plain-text-with-body/')).text(),
				'<body>',
				'should ignore non-HTML responses even if it has <body> tag.'
			);
		})(),
		(async () => {
			t.equal(
				await (await fetch('http://localhost:3018/negative-content-length/')).text(),
				'According to RFC7230, Content-Length header must be a non-negative integer' +
				' https://tools.ietf.org/html/rfc7230#section-3.3.2, but it was \'-1\'.',
				'should make response emit an error when it has an invalid Content-Length.'
			);
		})()
	]);
	await promisify(server.close.bind(server))();

	t.end();
});

test('Argument validation', t => {
	t.throws(
		() => injectBody(new Set(), Buffer.from('.')),
		/^TypeError.*Expected a ServerResponse object, but got Set \{\}\./u,
		'should fail when the first argument is not a ServerResponse.'
	);

	t.throws(
		() => injectBody(new ServerResponse({method: 'get'}), new Uint32Array()),
		/^TypeError.*Expected a code to inject to HTML <body>s \(<Buffer>\), but got Uint32Array \[\]\./u,
		'should fail when the second argument is neither a string nor Buffer.'
	);

	t.throws(
		() => injectBody(),
		/^RangeError.*Expected 2 arguments \(<http\.ServerResponse>, <Buffer>\), but got no arguments\./u,
		'should throw an error when it takes no arguments.'
	);

	t.throws(
		() => injectBody({}, '.', {}),
		/^RangeError.*Expected 2 arguments \(<http\.ServerResponse>, <Buffer>\), but got 3 arguments\./u,
		'should throw an error when it takes too many arguments.'
	);

	t.end();
});

test('InjectBody class', t => {
	const response = new ServerResponse({method: 'get'});
	response.setHeader('content-type', 'text/html');
	response.setHeader('etag', 'qwerty');

	const injectBodyFromClass = new injectBody.InjectBody(Buffer.from('A'));
	injectBodyFromClass(response);

	response.end('<body></Body>');
	response.emit('finish');

	t.equal(
		response.getHeader('etag'),
		`qwerty${createHash('md5').update('A').digest('base64')}`,
		'should create a new function with the fixed `contents` argument.',
	);

	t.throws(
		() => injectBodyFromClass(),
		/RangeError.*Expected 1 argument \(<http\.ServerResponse>\), but got no arguments\./u,
		'should throw an error when it takes no arguments.'
	);

	t.throws(
		() => injectBodyFromClass(Buffer.from('123'), 1),
		/RangeError.*Expected 1 argument \(<http\.ServerResponse>\), but got 2 arguments\./u,
		'should throw an error when it takes too many arguments.'
	);

	t.end();
});

test('Argument validation of InjectBody class', t => {
	t.throws(
		() => new injectBody.InjectBody(Symbol('x')),
		/^TypeError.*Expected a code to inject to HTML <body>s \(<Buffer>\), but got Symbol\(x\)\./u,
		'should fail when the argument is not a Buffer.'
	);

	t.throws(
		() => new injectBody.InjectBody(),
		/^RangeError.*Expected 1 argument \(<Buffer>\), but got no arguments\./u,
		'should fail when it takes no arguments.'
	);

	t.throws(
		() => new injectBody.InjectBody(Buffer.from('/'), {}),
		/^RangeError.*Expected 1 argument \(<Buffer>\), but got 2 arguments\./u,
		'should fail when it takes too many arguments.'
	);

	t.end();
});
