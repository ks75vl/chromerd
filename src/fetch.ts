import { MatchFunction, MatchResult, compile, match } from 'path-to-regexp';
import { ProtocolProxyApi } from 'devtools-protocol/types/protocol-proxy-api.js';
import { Protocol } from 'devtools-protocol/types/protocol.js';
import { DoEventListeners, DoEventPromises } from 'chrome-remote-interface';
import * as crypto from 'crypto';

/** Represents the available HTTP methods for invocations */
const AllInvocationMethods = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'TRACE', 'PATCH'] as const;
export type InvocationMethod = typeof AllInvocationMethods[number];

/** Alias type */
export type InvocationOrigin = string;
export type InvocationPath = string;

/** Represents the parsed arguments of an invocation as key-value pairs */
export type InvocationArguments = { [key: string]: string };

export type InvocationCallbacks = {
    /** The callback function called when a request is in request state */
    onRequest?: (this: InvocationContext, query: InvocationArguments, body: InvocationArguments) => void;
    /** The callback function called when a request is in response state */
    onResponse?: (this: InvocationReturnValue, body: InvocationArguments) => void;
}

export type BodyParserInterface = {

    /** Parser content type name in format type/subtype */
    name: string;

    /** Parse method */
    parse(data: ArrayBuffer): { [key: string]: string };

    /** Encode method */
    encode(data: { [key: string]: string }): ArrayBuffer;
}

export type InvocationContext = {
    /** The HTTP method of the invocation. */
    method: InvocationMethod;
    /** The URL of the invocation */
    url: string;
    /** The URL query parameters of the invocation */
    query: Map<string, string>;
    /** The raw body of the invocation */
    body: ArrayBuffer;
    /** The form data of the invocation, parsed based on content-type header value */
    form: Map<string, string | ArrayBuffer>;
    /** The parameters extracted from the URL match pattern */
    params: Map<string, string>;
    /** The request headers of the invocation */
    requestHeaders: Map<string, string>;
}

export type InvocationReturnValue = {
    /** The HTTP status code of the response */
    statusCode: number;
    /** The status text of the response */
    statusText: string;
    /** The raw response body */
    body: ArrayBuffer;
    /** The form data of the response, parsed based on content-type header value */
    form: Map<string, string>,
    /** The response headers of the response */
    responseHeaders: Map<string, string>;
};


function IsInvocationMethod(value: string): value is InvocationMethod {
    return AllInvocationMethods.includes(value as InvocationMethod)
}

class InternalInvocationContext implements InvocationContext {
    public target: URL;

    constructor(
        public method: InvocationMethod,
        public url: string,
        public params: Map<string, string>,
        public form: Map<string, string>,
        public query: Map<string, string>,
        public body: ArrayBuffer,
        public requestHeaders: Map<string, string>
    ) {
        this.target = new URL(url);
    }

    private mapcmp(src: Map<string, string>, dst: Map<string, string>): boolean {
        return src.size === dst.size && Array.from(src.keys()).every(x => src.get(x) === dst.get(x));
    }

    async compare(target: InternalInvocationContext): Promise<{ modified: boolean, modifiedParams: boolean, modifiedForm: boolean, modifiedQuery: boolean }> {
        const modifiedUrl = target.url !== this.url;
        const modifiedMethod = target.method !== this.method;
        const modifiedHeaders = !this.mapcmp(this.requestHeaders, target.requestHeaders);
        const modifiedParams = !this.mapcmp(this.params, target.params);
        const modifiedQuery = !this.mapcmp(this.query, target.query);
        const modifiedForm = !this.mapcmp(this.form, target.form);
        const hash1 = new Uint32Array(await crypto.subtle.digest('SHA-256', this.body));
        const hash2 = new Uint32Array(await crypto.subtle.digest('SHA-256', target.body));
        const modifiedBody = !hash1.every((v, i) => v === hash2[i]);
        const modified = modifiedUrl || modifiedMethod || modifiedHeaders || modifiedParams || modifiedForm || modifiedBody || modifiedQuery;
        return { modified, modifiedParams, modifiedForm, modifiedQuery };
    }

    copy(): InternalInvocationContext {
        const method = this.method;
        const url = this.url;
        const params = new Map(Array.from(this.params));
        const headers = new Map(Array.from(this.requestHeaders));
        const query = new Map(this.query);
        const body = this.body.slice(0);
        const form = new Map(Array.from(this.form));
        return new InternalInvocationContext(method, url, params, form, query, body, headers);
    }
}

class InternalInvocationReturnValue implements InvocationReturnValue {

    constructor(
        public statusCode: number,
        public statusText: string,
        public responseHeaders: Map<string, string>,
        public body: ArrayBuffer,
        public form: Map<string, string>,
    ) { }

    private mapcmp(src: Map<string, string>, dst: Map<string, string>): boolean {
        return src.size === dst.size && Array.from(src.keys()).every(x => src.get(x) === dst.get(x));
    }

    async compare(target: InternalInvocationReturnValue): Promise<{ modified: boolean, modifiedForm: boolean }> {
        const modifiedStatusCode = target.statusCode !== this.statusCode;
        const modifiedStatusText = target.statusText !== this.statusText;
        const modifiedHeaders = !this.mapcmp(this.responseHeaders, target.responseHeaders);
        const modifiedForm = !this.mapcmp(this.form, target.form);
        const hash1 = new Uint32Array(await crypto.subtle.digest('SHA-256', this.body));
        const hash2 = new Uint32Array(await crypto.subtle.digest('SHA-256', target.body));
        const modifiedBody = !hash1.every((v, i) => v === hash2[i]);
        const modified = modifiedStatusCode || modifiedStatusText || modifiedHeaders || modifiedForm || modifiedBody;
        return { modified, modifiedForm };
    }

    copy(): InternalInvocationReturnValue {
        const statusCode = this.statusCode;
        const statusText = this.statusText;
        const responseHeaders = new Map(Array.from(this.responseHeaders));
        const body = this.body.slice(0);
        const form = new Map(Array.from(this.form));
        return new InternalInvocationReturnValue(statusCode, statusText, responseHeaders, body, form);
    }
};

const HttpStatusText = new Map([
    [100, 'Continue'],
    [101, 'Switching Protocols'],
    [102, 'Processing'],
    [103, 'Early Hints'],
    [200, 'OK'],
    [201, 'Created'],
    [202, 'Accepted'],
    [203, 'Non-Authoritative Information'],
    [204, 'No Content'],
    [205, 'Reset Content'],
    [206, 'Partial Content'],
    [207, 'Multi-Status'],
    [208, 'Already Reported'],
    [226, 'IM Used'],
    [300, 'Multiple Choices'],
    [301, 'Moved Permanently'],
    [302, 'Found'],
    [303, 'See Other'],
    [304, 'Not Modified'],
    [305, 'Use Proxy'],
    [306, 'Switch Proxy'],
    [307, 'Temporary Redirect'],
    [308, 'Permanent Redirect'],
    [400, 'Bad Request'],
    [401, 'Unauthorized'],
    [402, 'Payment Required'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [405, 'Method Not Allowed'],
    [406, 'Not Acceptable'],
    [407, 'Proxy Authentication Required'],
    [408, 'Request Timeout'],
    [409, 'Conflict'],
    [410, 'Gone'],
    [411, 'Length Required'],
    [412, 'Precondition Failed'],
    [413, 'Payload Too Large'],
    [414, 'URI Too Long'],
    [415, 'Unsupported Media Type'],
    [416, 'Range Not Satisfiable'],
    [417, 'Expectation Failed'],
    [418, "I'm a teapot"],
    [421, 'Misdirected Request'],
    [422, 'Unprocessable Entity'],
    [423, 'Locked'],
    [424, 'Failed Dependency'],
    [425, 'Too Early'],
    [426, 'Upgrade Required'],
    [428, 'Precondition Required'],
    [429, 'Too Many Requests'],
    [431, 'Request Header Fields Too Large'],
    [451, 'Unavailable For Legal Reasons'],
    [500, 'Internal Server Error'],
    [501, 'Not Implemented'],
    [502, 'Bad Gateway'],
    [503, 'Service Unavailable'],
    [504, 'Gateway Timeout'],
    [505, 'HTTP Version Not Supported'],
    [506, 'Variant Also Negotiates'],
    [507, 'Insufficient Storage'],
    [508, 'Loop Detected'],
    [510, 'Not Extended'],
    [511, 'Network Authentication Required']
])

type InternalInvocationListenerInterface = {
    get(method: InvocationMethod, origin: InvocationOrigin): Map<MatchFunction<{ [key: string]: string }>, { pattern: string, callbacks: InvocationCallbacks }> | void;
    set(method: InvocationMethod, origin: InvocationOrigin, pattern: string, matchFn: MatchFunction<{ [key: string]: string }>, callbacks: InvocationCallbacks): void;
}

class InternalInvocationListener implements InternalInvocationListenerInterface {
    private listeners: Map<InvocationMethod, Map<InvocationOrigin, Map<MatchFunction<{ [key: string]: string }>, { pattern: string, callbacks: InvocationCallbacks }>>>;

    constructor() {
        this.listeners = new Map();
    }

    get(method: InvocationMethod, origin: InvocationOrigin): Map<MatchFunction<{ [key: string]: string }>, { pattern: string, callbacks: InvocationCallbacks }> | void {

        /** Retrieve the listeners by method */
        const o = this.listeners.get(method); if (!o) return;

        /** Retrieve the listeners by origin */
        const p = o.get(origin); if (!p) return;

        return p;
    }

    set(method: InvocationMethod, origin: InvocationOrigin, pattern: string, matchFn: MatchFunction<{ [key: string]: string }>, callbacks: InvocationCallbacks): void {

        /** Retrieve the listeners by method */
        const o = (!this.listeners.has(method) && this.listeners.set(method, new Map()), this.listeners.get(method) || (() => { throw `can not register listeners for ${method} method` })());

        /** Retrieve the listeners by origin */
        const p = (!o.has(origin) && o.set(origin, new Map()), o.get(origin) || (() => { throw `can not register listeners for ${origin} origin` })());

        /** Save the listeners */
        (p.set(matchFn, { pattern, callbacks }), p.get(matchFn) || (() => { throw `can not register listeners for ${pattern} pattern` })());
    }
}

export class JsonBodyParser implements BodyParserInterface {
    name: string = 'application/json';

    parse(data: ArrayBuffer): { [key: string]: string; } {
        const s = new TextDecoder('utf-8').decode(data);
        try { return JSON.parse(s); } catch (e) { return {}; }
    }

    encode(data: { [key: string]: string; }): ArrayBuffer {
        const encoder = new TextEncoder();
        return encoder.encode(JSON.stringify(data));
    }
}

export class UrlEncodedBodyParser implements BodyParserInterface {
    name: string = 'application/x-www-form-urlencoded';

    parse(data: ArrayBuffer): { [key: string]: string; } {
        const s = new TextDecoder('utf-8').decode(data);
        try { return Object.fromEntries(new URLSearchParams(s)); } catch (e) { return {}; }
    }

    encode(data: { [key: string]: string; }): ArrayBuffer {
        const encoder = new TextEncoder();
        return encoder.encode(new URLSearchParams(data).toString());
    }
}

export class FetchInterceptor {
    private contextCache: Map<string, InvocationContext>;
    private listenersCache: Map<Map<MatchFunction<{ [key: string]: string }>, { pattern: string, callbacks: InvocationCallbacks }>, [MatchFunction<{ [key: string]: string }>, { pattern: string, callbacks: InvocationCallbacks }][]>;
    private listeners: InternalInvocationListenerInterface;
    private bodyParser: Map<string, BodyParserInterface>;

    constructor(private fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'>) {
        this.listeners = new InternalInvocationListener();
        this.bodyParser = new Map();
        this.contextCache = new Map();
        this.listenersCache = new Map();

        this.registerBodyParser(new JsonBodyParser(), new UrlEncodedBodyParser());
    }

    registerBodyParser(...parsers: BodyParserInterface[]) {
        parsers.forEach(x => this.bodyParser.set(x.name, x));
    }

    get(pattern: string, callbacks: InvocationCallbacks) {
        this.handle('GET', pattern, callbacks);
    }

    post(pattern: string, callbacks: InvocationCallbacks) {
        this.handle('POST', pattern, callbacks);
    }

    any(pattern: string, callbacks: InvocationCallbacks) {
        AllInvocationMethods.forEach(x => this.handle(x, pattern, callbacks));
    }

    handle(method: InvocationMethod, pattern: string, callbacks: InvocationCallbacks) {
        const { origin, pathname } = new URL(pattern);

        !IsInvocationMethod(method) && (() => { throw void 0; })();
        this.listeners.set(method, origin, pathname, match<{ [key: string]: string }>(pathname), callbacks);
    }

    private getBodyParser(contentType: string): BodyParserInterface | undefined {
        const ct = /^(?<contentType>[a-zA-Z0-9]+\/[a-zA-Z0-9\-\_]+)(;.*)?/.exec(contentType)?.groups?.contentType || 'N/A';
        return this.bodyParser.get(ct);
    }

    private async requestPaused(params: Protocol.Fetch.RequestPausedEvent) {
        const { request: { method, url, headers: reqHdrs, hasPostData = false, postData = '' }, requestId, responseStatusCode, responseStatusText, responseHeaders: rspHdrs = [] } = params;
        const { origin, pathname, searchParams } = new URL(url);
        const crq: Protocol.Fetch.ContinueRequestRequest = { requestId };
        const isreq = responseStatusCode === undefined || responseStatusText === undefined;
        const isredirect = !isreq && responseStatusCode >= 300 && responseStatusCode < 400;

        /** Check invocation method */
        if (!IsInvocationMethod(method)) return this.fetch.continueRequest(crq);

        /** Format headers */
        const requestHeaders: [string, string][] = Object.entries(reqHdrs).map(([name, value]) => [name.toLowerCase(), value]);
        const responseHeaders: [string, string][] = rspHdrs.map(({ name, value }) => [name.toLowerCase(), value]);

        /** Retrieve the listeners */
        const p = this.listeners.get(method, origin); if (!p) return this.fetch.continueRequest(crq);
        const pp = this.listenersCache.get(p) || this.listenersCache.set(p, Array.from(p.entries())).get(p) || (() => { throw void 0; })();

        /** Retrieve the callbacks */
        const [matcher, callbacks] = pp.find(([m, c]) => m(pathname)) || [];
        if (!matcher || !callbacks) return this.fetch.continueRequest(crq);

        /**
         * onRequest
         */
        if (isreq) {

            /**
             * Step 1: Build context, bind to callback and invoke callback.
             *
             * Note: If no callback is specified,
             * send the `Fetch.continueRequest` command without any intercepted request.
             */
            const { params: p } = matcher(pathname) || ({ params: {} } as MatchResult<{ [key: string]: string; }>);
            const params = new Map(Object.entries(p));
            const headers = new Map(requestHeaders);
            const body = new TextEncoder().encode(hasPostData ? postData : '');
            const preparser = this.getBodyParser(headers.get('content-type') || '');
            const parsedBody = Object.entries((preparser && hasPostData && preparser.parse(body)) || {});
            const form = new Map(parsedBody);
            const { callbacks: { onRequest: fn }, pattern } = callbacks;
            const context: InternalInvocationContext = new InternalInvocationContext(method, url, params, form, new Map(searchParams), body, headers);

            /** onRequest callback is not specified */
            if (!fn) return await this.fetch.continueRequest({ requestId });

            /** Bind context and invoke callback */
            const caller = context.copy();
            const invoker = fn.bind(caller);
            const invocationQuery = Object.fromEntries(caller.query);
            const invocationBody = Object.fromEntries(caller.form);
            const ret = (invoker(invocationQuery, invocationBody), caller);

            /** 
             * Step 2: Post callback process
             * 
             * Note:C lear the context cache, format the response header (in case the user has set a custom header name).
             * Additionally, reparse the body (in case the user has changed the content-type).
             */
            this.contextCache.set(requestId, ret);
            Array.from(ret.requestHeaders).forEach(([name, value]) => /[A-Z]/.test(name) && (ret.requestHeaders.delete(name), ret.requestHeaders.set(name.toLowerCase(), value)));
            const postparser = this.getBodyParser(ret.requestHeaders.get('content-type') || '');

            /**
            * Step 3: Build `Fetch.continueRequest` request
            *
            * Note: When a field is changed by a callback, all fields must be specified
            * to ensure that the change is applied.
            */
            const crrq: Protocol.Fetch.ContinueRequestRequest = { requestId, interceptResponse: true };
            const { modified, modifiedParams, modifiedForm, modifiedQuery } = await context.compare(ret);

            /**
             * @TODO Determine if `postData` needs to be encoded in `base64`.
             */
            modified && ( /** Update url */crrq.url = (modifiedParams || modifiedQuery) ? (modifiedParams && (ret.target.pathname = compile<{ [key: string]: string; }>(pattern)(Object.fromEntries(ret.params))), (modifiedQuery && (ret.target.search = new URLSearchParams(Array.from(ret.query.entries())).toString())), ret.target.toString()) : ret.url, /** Update method */ crrq.method = ret.method, /** Update headers */ crrq.headers = Array.from(ret.requestHeaders).map(([name, value]) => ({ name, value })), /** Update post data */ crrq.postData = Buffer.from((modifiedForm && postparser) ? postparser.encode(Object.fromEntries(ret.form)) : (!!ret.body.byteLength ? ret.body : body)).toString('base64'));

            return await this.fetch.continueRequest(crrq);
        }

        /**
         * onResponse
         * 
         * Note: When a redirect status is received,
         * the browser will stop receiving headers after the `Location` header.
         * As a result, the headers are not fully received,
         * which prevents us from retrieving the response body using `Fetch.getResponseBody`.
         */
        const { base64Encoded, body: rawBody } = await (isredirect ? Promise.resolve({ base64Encoded: true, body: '' }) : this.fetch.getResponseBody({ requestId }));

        /**
         * Step 1: Build context, bind to callback and invoke callback.
         *
         * Note: If no callback is specified,
         * send the `Fetch.continueResponse` command without any intercepted response.
         */
        const headers = new Map(responseHeaders);
        const body = new TextEncoder().encode(base64Encoded ? Buffer.from(rawBody, 'base64').toString() : rawBody);
        const preparser = this.getBodyParser(headers.get('content-type') || '');
        const parsedBody = Object.entries((preparser && hasPostData && preparser.parse(body)) || {});
        const form = new Map(parsedBody);
        const statusText = !responseStatusText.length ? (HttpStatusText.get(responseStatusCode) || 'UNKNOWN') : responseStatusText;
        const { callbacks: { onResponse: fn } } = callbacks;
        const context: InternalInvocationReturnValue = new InternalInvocationReturnValue(responseStatusCode, statusText, headers, body, form);

        /** onResponse callback is not specified */
        if (!fn) return await this.fetch.continueResponse({ requestId });

        /** Invoke callback */
        const caller = context.copy();
        const invoker = fn.bind(caller);
        const invocationBody = Object.fromEntries(caller.form);
        const ret = (invoker(invocationBody), caller);

        /** 
         * Step 2: Post callback process
         * 
         * Note:C lear the context cache, format the response header (in case the user has set a custom header name).
         * Additionally, reparse the body (in case the user has changed the content-type).
         */
        this.contextCache.delete(requestId);
        Array.from(ret.responseHeaders).forEach(([name, value]) => /[A-Z]/.test(name) && (ret.responseHeaders.delete(name), ret.responseHeaders.set(name.toLowerCase(), value)));
        const postparser = this.getBodyParser(ret.responseHeaders.get('content-type') || '');

        /**
         * Step 3: Build `Fetch.FulfillRequestRequest` request
         *
         * Note: When a field is changed by a callback, all fields must be specified
         * to ensure that the change is applied.
         */
        const cffrq: Protocol.Fetch.FulfillRequestRequest = { requestId, responseCode: responseStatusCode };
        const { modified, modifiedForm } = await context.compare(ret);

        modified && ( /** Update status code */cffrq.responseCode = ret.statusCode, /** Update status text */ cffrq.responsePhrase = ret.statusText, /** Update headers */ cffrq.responseHeaders = Array.from(ret.responseHeaders.entries(), ([name, value]) => ({ name, value })), /** Update body */ cffrq.body = Buffer.from((modifiedForm && postparser) ? postparser.encode(Object.fromEntries(ret.form)) : (!!ret.body.byteLength ? ret.body : body)).toString(base64Encoded ? 'base64' : 'utf8'));

        /**
         * Step 3: Send cdp command
         */
        return await this.fetch.fulfillRequest(cffrq);
    }

    async enable() {
        this.fetch.requestPaused(async params => await this.requestPaused(params));
        return await this.fetch.enable({});
    }
}