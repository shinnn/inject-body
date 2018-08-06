# inject-body

[![npm version](https://img.shields.io/npm/v/inject-body.svg)](https://www.npmjs.com/package/inject-body)
[![Build Status](https://travis-ci.com/shinnn/inject-body.svg?branch=master)](https://travis-ci.com/shinnn/inject-body)
[![Coverage Status](https://img.shields.io/coveralls/shinnn/inject-body.svg)](https://coveralls.io/github/shinnn/inject-body?branch=master)

Inject contents into the HTML `<body>` tag of an HTTP response

```javascript
const {createServer} = require('html');
const fetch = require('node-fetch');
const injectBody = require('inject-body');

createServer((req, res) => {
  injectBody(res, Buffer.from('Hello '));

  res.setHeader('content-type', 'text/html');
  res.end('<html><body>World</body></html>');
}).listen(3000, async () => {
  return (await fetch('http://localhost:3000')).text(); //=> '<html><body>Hello, World</body></html>'
});
```

## Installation

[Use](https://docs.npmjs.com/cli/install) [npm](https://docs.npmjs.com/getting-started/what-is-npm).

```
npm install inject-body
```

## API

```javascript
const injectBody = require('inject-body');
```

### injectBody(*response*, *contents*)

*response*: [`http.ServerResponse`](https://nodejs.org/api/http.html#http_class_http_serverresponse)  
*contents*: `Buffer`

If the media type of the response is `text/html`, it inserts a given contents into the response body as the first child of `<body>` tag, with increasing the value of `Content-Length` header if necessary.

```javascript
const {createServer} = require('html');
const fetch = require('node-fetch');
const injectBody = require('inject-body');

const html = Buffer.from('<html><body><h2>Hi</h2></body></html>');
const inserted = Buffer.from('<h1>🏄‍</h1>');

createServer((req, res) => {
  injectBody(res, inserted);

  res.setHeader('content-type', 'text/html');
  res.setHeader('content-length', 37/* Buffer.byteLength(html) */);
  res.end(html);
}).listen(3000, async () => {
  const response = await fetch('http://localhost:3000');

  Number(response.headers.get('content-length'));
  //=> 53, Buffer.byteLength(html) + Buffer.byteLength(inserted)

  return response.text(); //=> '<html><body><h1>🏄‍</h1><h2>Hi</h2></body></html>'
});
```

If the media type is not `text/html` or the response body has no `<body>` tag, it does nothing.

### class injectBody.InjectBody(*contents*)

*contents*: `Buffer`  
Return: `Function`

Create a new `injectBody` function with the fixed `contents` argument. Use this class if a server will inject the same contents into every HTML response many times.

```javascript
const {InjectBody} = require('inject-body');

const injectStyle = new InjectBody(Buffer.from('<style>body {color: red}</style>'));
```

## License

[ISC License](./LICENSE) © 2018 Shinnosuke Watanabe
