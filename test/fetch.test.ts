import { FetchInterceptor, InvocationCallbacks, InvocationContext, InvocationMethod, InvocationReturnValue, JsonBodyParser } from '../src/fetch';
import type ProtocolProxyApi from 'devtools-protocol/types/protocol-proxy-api';
import type Protocol from 'devtools-protocol/types/protocol';
import { DoEventListeners, DoEventPromises } from 'chrome-remote-interface';

describe('JsonBodyParser', () => {
    const parser = new JsonBodyParser();
    const body = { name: 'Alice', age: 18 };
    const encodedBody = new TextEncoder().encode(JSON.stringify(body));
    const parsedBody = parser.parse(encodedBody);

    it('should return application/json as parser name', () => {
        expect(parser.name).toStrictEqual('application/json');
    });

    it('should not parse on bad data', () => {
        expect(parser.parse(new TextEncoder().encode("{bad"))).toStrictEqual({});
    });

    it('should parse body.name and return Alice', () => {
        expect(parsedBody.name).toStrictEqual(body.name);
    });

    it('should parse body.age and return 18', () => {
        expect(parsedBody.age).toStrictEqual(body.age);
    });

    it('should parse body and return object with 2 properties', () => {
        expect(Object.entries(parsedBody).length).toStrictEqual(2);
    });

    it('should encode body and return encoded body', () => {
        expect(parser.encode(parsedBody)).toStrictEqual(encodedBody);
    });
});

jest.mock('chrome-remote-interface', () => {
    return {
        CDP: jest.fn().mockImplementation(() => {
            return {};
        })
    }
});

describe('FetchInterceptor', () => {

    it('should enable fetch interceptor', async () => {

        let Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation(async (callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                await callback({
                    requestId: 'requestId-01',
                    request: {
                        url: 'http://127.0.0.1/test',
                        method: 'GET',
                        headers: {},
                        initialPriority: 'Medium',
                        referrerPolicy: 'no-referrer'
                    },
                    frameId: 'frameId',
                    resourceType: 'Other',
                });
                return;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn(),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn(),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        let fetch = new FetchInterceptor(Fetch);
        await fetch.enable();

        expect(Fetch.enable).toBeCalledTimes(1);
        expect(Fetch.requestPaused).toBeCalledTimes(1);
    });

    /** GET request http://127.0.0.1/test */
    it('should intercept request method to POST on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {
                this.method = 'POST';
            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({
            requestId,
            interceptResponse: true,
            method: 'POST',
            url: 'http://127.0.0.1/test',
            postData: '',
            headers: [
                { name: 'content-type', value: 'application/json' }
            ]
        });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200
        });
    });

    it('should intercept request url to http://127.0.0.1/foo on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {
                this.url = 'http://127.0.0.1/foo';
            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({
            requestId,
            interceptResponse: true,
            method: 'GET',
            postData: '',
            headers: [
                { name: 'content-type', value: 'application/json' }
            ],
            url: 'http://127.0.0.1/foo'
        });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200
        });
    });

    it('should intercept request query to foo=bar on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {
                this.query.set('foo', 'bar');
            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({
            requestId,
            interceptResponse: true,
            method: 'GET',
            postData: '',
            url: 'http://127.0.0.1/test?foo=bar',
            headers: [
                { name: 'content-type', value: 'application/json' }
            ],
        });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200
        });
    });

    it('should intercept request body to {"foo":"bar"} on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {
                this.body = Buffer.from(JSON.stringify({ foo: 'bar' }));
            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({
            requestId,
            interceptResponse: true,
            method: 'GET',
            postData: Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64'),
            url: 'http://127.0.0.1/test',
            headers: [
                { name: 'content-type', value: 'application/json' }
            ],
        });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200
        });
    });

    it('should intercept request form to {"foo":"bar"} on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {
                this.form.set('foo', 'bar');
            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({
            requestId,
            interceptResponse: true,
            method: 'GET',
            postData: Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64'),
            url: 'http://127.0.0.1/test',
            headers: [
                { name: 'content-type', value: 'application/json' }
            ],
        });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200
        });
    });

    it('should intercept request params to id=12345 on GET http://127.0.0.1/test/:id', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {
                this.params.set('id', '12345');
            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
            })
        }

        fetch.get('http://127.0.0.1/test/:id', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test/9',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({
            requestId,
            interceptResponse: true,
            method: 'GET',
            postData: '',
            url: 'http://127.0.0.1/test/12345',
            headers: [
                { name: 'content-type', value: 'application/json' }
            ],
        });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test/9',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200
        });
    });

    it('should intercept request headers to foo:bar on GET http://127.0.0.1/test/:id', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {
                this.requestHeaders.set('foo', 'bar');
            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({
            requestId,
            interceptResponse: true,
            method: 'GET',
            postData: '',
            url: 'http://127.0.0.1/test',
            headers: [
                { name: 'content-type', value: 'application/json' },
                { name: 'foo', value: 'bar' },
            ],
        });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200
        });
    });

    it('should intercept request headers uppercase to FoO:bar on GET http://127.0.0.1/test/:id', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {
                this.requestHeaders.set('FoO', 'bar');
            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({
            requestId,
            interceptResponse: true,
            method: 'GET',
            postData: '',
            url: 'http://127.0.0.1/test',
            headers: [
                { name: 'content-type', value: 'application/json' },
                { name: 'foo', value: 'bar' },
            ],
        });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200
        });
    });

    it('should intercept request all field on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {
                this.method = 'POST';
                this.url = 'http://127.0.0.1/foo';
                this.query.set('foo', 'bar');
                this.body = Buffer.from('<h1>Injected!</h1>');
                this.form.set('foo', 'bar');
                this.params.set('id', '12345');
                this.requestHeaders.set('foo', 'bar');
            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
            })
        }

        fetch.get('http://127.0.0.1/test/:id', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test/9',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({
            requestId,
            interceptResponse: true,
            url: 'http://127.0.0.1/test/12345?foo=bar',
            method: 'POST',
            postData: Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64'),
            headers: [
                { name: 'content-type', value: 'application/json' },
                { name: 'foo', value: 'bar' }
            ]
        });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test/9',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200
        });
    });

    /** GET response http://127.0.0.1/test */
    it('should intercept response nothing on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn(),
            onResponse: jest.fn()
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: {},
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: {},
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({ requestId, responseCode: 200 });
    });

    it('should intercept response statusCode to 400 on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.statusCode = 400;
                this.statusText = 'Not Found';
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 400,
            responsePhrase: 'Not Found',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' }
            ],
            body: Buffer.from('<h1>Hello world!</h1>').toString('base64')
        });
    });

    it('should intercept response responseHeaders to name:alice on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.responseHeaders.set('name', 'alice');
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200,
            responsePhrase: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' },
                { name: 'name', value: 'alice' }
            ],
            body: Buffer.from('<h1>Hello world!</h1>').toString('base64')
        });
    });

    it('should intercept response responseHeaders to NaMe:alice on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.responseHeaders.set('NaMe', 'alice');
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200,
            responsePhrase: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' },
                { name: 'name', value: 'alice' }
            ],
            body: Buffer.from('<h1>Hello world!</h1>').toString('base64')
        });
    });

    it('should intercept response responseBody to <h1>Injected!</h1> on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.body = Buffer.from('<h1>Injected!</h1>');
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200,
            responsePhrase: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' },
            ],
            body: Buffer.from('<h1>Injected!</h1>').toString('base64')
        });
    });

    it('should intercept response responseForm to {"foo":"bar"} on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.responseHeaders.set('content-type', 'application/json');
                this.form.set('foo', 'bar');
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200,
            responsePhrase: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' }
            ],
            body: Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64')
        });
    });

    it('should intercept response all field on GET http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.statusCode = 400;
                this.statusText = 'Not Found';
                this.responseHeaders.set('name', 'alice');
                this.body = Buffer.from('<h1>Injected!</h1>');
                this.form.set('foo', 'bar');
            })
        }

        fetch.get('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 400,
            responsePhrase: 'Not Found',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' },
                { name: 'name', value: 'alice' }
            ],
            body: Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64')
        });
    });

    /** POST response http://127.0.0.1/test */
    it('should intercept response nothing on POST http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn(),
            onResponse: jest.fn()
        }

        fetch.post('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: {},
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: {},
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({ requestId, responseCode: 200 });
    });

    it('should intercept response statusCode to 400 on POST http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.statusCode = 400;
                this.statusText = 'Not Found';
            })
        }

        fetch.post('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 400,
            responsePhrase: 'Not Found',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' }
            ],
            body: Buffer.from('<h1>Hello world!</h1>').toString('base64')
        });
    });

    it('should intercept response responseHeaders to name:alice on POST http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.responseHeaders.set('name', 'alice');
            })
        }

        fetch.post('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200,
            responsePhrase: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' },
                { name: 'name', value: 'alice' }
            ],
            body: Buffer.from('<h1>Hello world!</h1>').toString('base64')
        });
    });

    it('should intercept response responseBody to <h1>Injected!</h1> on POST http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.body = Buffer.from('<h1>Injected!</h1>');
            })
        }

        fetch.post('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200,
            responsePhrase: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' },
            ],
            body: Buffer.from('<h1>Injected!</h1>').toString('base64')
        });
    });

    it('should intercept response responseForm to {"foo":"bar"} on POST http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.form.set('foo', 'bar');
            })
        }

        fetch.post('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 200,
            responsePhrase: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' }
            ],
            body: Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64')
        });
    });

    it('should intercept response all field on POST http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.statusCode = 400;
                this.statusText = 'Not Found';
                this.responseHeaders.set('name', 'alice');
                this.body = Buffer.from('<h1>Injected!</h1>');
                this.form.set('foo', 'bar');
            })
        }

        fetch.post('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 400,
            responsePhrase: 'Not Found',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' },
                { name: 'name', value: 'alice' }
            ],
            body: Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64')
        });
    });

    /** Any on http://127.0.0.1/test */
    it('should intercept all field on http://127.0.0.1/test', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.statusCode = 400;
                this.statusText = 'Not Found';
                this.responseHeaders.set('name', 'alice');
                this.body = Buffer.from('<h1>Injected!</h1>');
                this.form.set('foo', 'bar');
            })
        }

        fetch.any('http://127.0.0.1/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(1);
        expect(callbacks.onRequest).toBeCalledWith({}, {});

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId, interceptResponse: true });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(1);
        expect(callbacks.onResponse).toBeCalledWith({});

        expect(Fetch.fulfillRequest).toBeCalledTimes(1);
        expect(Fetch.fulfillRequest).toBeCalledWith<Protocol.Fetch.FulfillRequestRequest[]>({
            requestId,
            responseCode: 400,
            responsePhrase: 'Not Found',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'content-type', value: 'application/json' },
                { name: 'name', value: 'alice' }
            ],
            body: Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64')
        });
    });

    /** Invalid method */
    it('should not intercept on bad method BAD', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.statusCode = 400;
                this.statusText = 'Not Found';
                this.responseHeaders.set('name', 'alice');
                this.body = Buffer.from('<h1>Injected!</h1>');
                this.form.set('foo', 'bar');
            })
        }

        try { fetch.handle('BAD' as InvocationMethod, 'http://127.0.0.1/test', callbacks) } catch { }

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(0);

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(0);

        expect(Fetch.fulfillRequest).toBeCalledTimes(0);
    });

    /** Origin not intercepted */
    it('should not intercept on unknown origin', async () => {
        const requestId = 'requestId-01';
        let requestPaused: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void> = async param => { };
        const Fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'> = {
            disable: jest.fn(),
            enable: jest.fn().mockImplementation(() => {
                return Promise.resolve();
            }),
            authRequired: jest.fn(),
            requestPaused: jest.fn().mockImplementation((callback: (params: Protocol.Fetch.RequestPausedEvent) => Promise<void>) => {
                requestPaused = callback;
            }),
            failRequest: jest.fn(),
            fulfillRequest: jest.fn(),
            continueRequest: jest.fn().mockImplementation(params => {

            }),
            continueWithAuth: jest.fn(),
            continueResponse: jest.fn(),
            getResponseBody: jest.fn().mockImplementation(async () => {
                return { base64Encoded: true, body: Buffer.from('<h1>Hello world!</h1>').toString('base64') };
            }),
            takeResponseBodyAsStream: jest.fn(),
            on: jest.fn(),
        };

        const fetch = new FetchInterceptor(Fetch);
        const callbacks = {
            onRequest: jest.fn().mockImplementation(function (this: InvocationContext) {

            }),
            onResponse: jest.fn().mockImplementation(function (this: InvocationReturnValue) {
                this.statusCode = 400;
                this.statusText = 'Not Found';
                this.responseHeaders.set('name', 'alice');
                this.body = Buffer.from('<h1>Injected!</h1>');
                this.form.set('foo', 'bar');
            })
        }

        fetch.get('http://100.0.0.2/test', callbacks);

        await fetch.enable();

        expect(Fetch.requestPaused).toBeCalledTimes(1);

        /**
         * Request pause in request state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onRequest).toBeCalledTimes(0);

        expect(Fetch.continueRequest).toBeCalledTimes(1);
        expect(Fetch.continueRequest).toBeCalledWith({ requestId });

        /**
         * Request pause in response state
         */
        await requestPaused({
            requestId: requestId,
            request: {
                url: 'http://127.0.0.1/test',
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                initialPriority: 'Medium',
                referrerPolicy: 'no-referrer'
            },
            responseStatusCode: 200,
            responseStatusText: 'OK',
            responseHeaders: [
                { name: 'foo', value: 'bar' },
                { name: 'Content-Type', value: 'application/json' }
            ],
            frameId: 'frameId',
            resourceType: 'Other',
        });

        expect(callbacks.onResponse).toBeCalledTimes(0);

        expect(Fetch.fulfillRequest).toBeCalledTimes(0);
    });
});