# chromerd
A Chrome DevTools Protocol Wrapper with Frida Interceptor Style

![chromerd-fetch-shot-crop](https://github.com/ks75vl/chromerd/assets/22657508/e4a82021-2d90-4574-950d-7274e0417eed)

# Get started
## Features
- FetchInterceptor ✅
- DebuggerInterceptor (coming soon)
- Storagenterceptor (coming soon).
## Installation
```bash
npm i @ks75vl/chromerd
```
## Example
```typescript
import CDP from "chrome-remote-interface";
import { FetchInterceptor } from "@ks75vl/chromerd";

(async () => {
    const { Fetch, Page } = await CDP();

    const fetch = new FetchInterceptor(Fetch);

    fetch.get("https://github.com/", {
        onRequest(query, post) {
            console.log(`${this.method} ${this.url}`);
        },
        onResponse(body) { }
    });

    await fetch.enable();
    await Page.reload();
})();
```

# Instrumentation
## FetchInterceptor
> Intercept network layer using [Fetch domain](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/).

- `FetchInterceptor.handle(method, pattern, callbacks)`: Registers an interceptor for specific HTTP requests `method` that matching the provided pattern. The `pattern` supports [path-to-regexp](https://github.com/pillarjs/path-to-regexp) syntax.<br>The structure and content of the callbacks parameters depend on the `content-type` header specified in the request/response.<br>By default, the `FetchInterceptor` supports `json` parser. You can register new parsers using the `FetchInterceptor.registerBodyParser` function to support other content types.<br>The callbacks argument is an object containing one or more of:
    - `onRequest(query, body)`: callback function given two arguments `query`, `body` that can be used to read parsed request parameters, including URL query and body form.<br>Additionally, the `onRequest` callback will be bound to an [`InvocationContext`](#invocationcontext) object which can be used to modify the request
    - `onResponse(body)`: callback function given one argument `body` that can be used to read parsed response parameters, including body form. <br>Additionally, the `onRequest` callback will be bound to an [`InvocationReturnValue`](#invocationreturnvalue) object which can be used to modify the response.
- `FetchInterceptor.post(pattern, callbacks)`: A shortcut for `FetchInterceptor.handle('GET', pattern, callbacks)`
- `FetchInterceptor.post(pattern, callbacks)`: A shortcut for `FetchInterceptor.handle('POST', pattern, callbacks)`
- `FetchInterceptor.any(pattern, callbacks)`: A shortcut for `FetchInterceptor.handle` over all method
- <a id="FetchInterceptor.registerBodyParser"></a>`FetchInterceptor.registerBodyParser([...parsers])`: register body parsers for specific content types. The parser must implement the `BodyParserInterface` interface
- `FetchInterceptor.enable()`: enable fetch interceptor, it also enable Fetch domain internally.

## BodyParserInterface
> Body parser interface, new body parser must implement this interface and register by the [`FetchInterceptor.registerBodyParser`](#FetchInterceptor.registerBodyParser) function.

- `BodyParserInterface.name`: The property to specific a name for the parser in format `type/subtype`.  It represents the content type that the parser can handle
- `BodyParserInterface.parse(data)`: This method takes an `ArrayBuffer` containing the data to be parsed and returns an object of key-value pairs. Each key represents a parsed field, and its corresponding value is the parsed value as a string
- `BodyParserInterface.encode(data)`: This method takes an `object` containing key-value pairs representing the data to be encoded. The keys correspond to field names, and the values are the respective values of those fields as strings. The encode method is responsible for converting the data into an `ArrayBuffer` format.

## InvocationContext
>  An interface that represents the context of an invocation. It contains various properties to monitor and manipulate request.

### Properties:
> Overwrite below properties to manipulate the request.
- `method`: Represents the HTTP method of the invocation.<br>Supported value: `GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `OPTIONS`, `TRACE`, `PATCH`
- `url`: Represents the URL of the invocation. It contains the complete URL, including the protocol, domain, path, and query parameters (fragment excluded)
- `query`: Represents the parsed URL query parameters of the invocation. It is a `Map`, which provides methods for working with query parameters
- `body`: Represents the raw body of the invocation. It is an `ArrayBuffer` that stores the binary data of the request body. Empty body will be ended in an zero-length `ArrayBuffer`.
- `form`: Represents the form data of the invocation, parsed based on the `content-type` header value. It is a `Map` where the keys are field names, and the values can be `string` or `ArrayBuffer`
- `params`: Represents the parameters extracted from the URL match pattern. It is a `Map` where the keys are parameter names, and the values are the corresponding parameter values as strings
- `requestHeaders`: Represents the request headers of the invocation. It is a `Map` where the keys (`case-insensitive`) are header names, and the values are the corresponding header values as strings.

## InvocationReturnValue
>  An interface that represents the return value of an invocation or request. It contains various properties to monitor and manipulate response.

### Properties:
> Overwrite below properties to manipulate the response.
- `statusCode`: Represents the HTTP status code of the response. It indicates the status of the request, https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
- `statusText`: Represents the status text of the response. It provides a briefdescription or message associated with the HTTP status code, https://developermozilla.org/en-US/docs/Web/HTTP/Status
- `body`: Represents the raw response body. It is an `ArrayBuffer` that stores thebinary data of the response
- `form`: Represents the form body of the response, be parsed based on the`content-type` header value. It is a `Map` where the keys are field names, and thevalues are the corresponding field values as strings
- `responseHeaders`: Represents the response headers of the response. It is a`Map` where the keys (`case-insensitive`) are header names, and the values are thecorresponding header values as strings.

