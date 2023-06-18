import { MatchFunction, match } from 'path-to-regexp';
import type ProtocolProxyApi from 'devtools-protocol/types/protocol-proxy-api';
import type Protocol from 'devtools-protocol/types/protocol';
import { DoEventListeners, DoEventPromises } from 'chrome-remote-interface';

type MIMEType = 'text/plain' | 'application/json';
const MIME_REGEX: Array<{ name: MIMEType, regex: RegExp }> = [
    { regex: /application\/json/, name: 'application/json' }
];

const AllInvocationMethods = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'TRACE', 'PATCH'] as const;

export type InvocationMethod = typeof AllInvocationMethods[number];

export type InvocationOrigin = string;

export type InvocationPath = string;

function IsInvocationMethod(value: string): value is InvocationMethod {
    return AllInvocationMethods.includes(value as InvocationMethod)
}

export type InvocationContext = {
    method: InvocationMethod;
    url: string;
    query: URLSearchParams;
    params: Map<string, string>;
    requestHeaders: Map<string, string>;
}

class InternalInvocationContext implements InvocationContext {
    public target: URL;
    public query: URLSearchParams;

    constructor(
        public method: InvocationMethod,
        public url: string,
        public params: Map<string, string>,
        public requestHeaders: Map<string, string>
    ) {
        this.target = new URL(url);
        this.query = this.target.searchParams;
    }
}

export type InvocationArguments = { [key: string]: string };

export type InvocationReturnValue = {
    statusCode: number;
    statusText: string;
    body: ArrayBuffer;
    responseHeaders: Map<string, string>;
};

class InternalInvocationReturnValue implements InvocationReturnValue {

    constructor(
        public statusCode: number,
        public statusText: string,
        public responseHeaders: Map<string, string>,
        public body: ArrayBuffer,
    ) {

    }
};


export type InvocationCallbacks = {
    onRequest?: (this: InvocationContext, query: InvocationArguments, body: InvocationArguments) => void;
    onResponse?: (this: InvocationReturnValue, body: InvocationArguments) => void;
}


const HttpStatusText = new Map<number, string>([
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
    get(method: InvocationMethod, origin: InvocationOrigin): Map<MatchFunction, InvocationCallbacks> | void
    set(method: InvocationMethod, origin: InvocationOrigin, matchFn: MatchFunction, pathname: string, callbacks: InvocationCallbacks): void;
}

class InternalInvocationListener implements InternalInvocationListenerInterface {
    private listeners: Map<InvocationMethod, Map<InvocationOrigin, Map<MatchFunction, InvocationCallbacks>>>;

    constructor() {
        this.listeners = new Map<InvocationMethod, Map<InvocationOrigin, Map<MatchFunction, InvocationCallbacks>>>();
    }

    get(method: InvocationMethod, origin: InvocationOrigin): Map<MatchFunction, InvocationCallbacks> | void {

        /** Check invocation method */
        !IsInvocationMethod(method) && (() => { throw `bad invocation method` })();

        /** Retrieve the listeners by method */
        const o = this.listeners.get(method); if (!o) return;

        /** Retrieve the listeners by origin */
        const p = o.get(origin); if (!p) return;

        return p;
    }

    set(method: InvocationMethod, origin: InvocationOrigin, matchFn: MatchFunction, pathname: string, callbacks: InvocationCallbacks): void {

        /** Check invocation method */
        !IsInvocationMethod(method) && (() => { throw `bad invocation method` })();

        /** Retrieve the listeners by method */
        const o = (!this.listeners.has(method) && this.listeners.set(method, new Map<InvocationOrigin, Map<MatchFunction, InvocationCallbacks>>()), this.listeners.get(method) || (() => { throw `can not register listeners for ${method} method` })());

        /** Retrieve the listeners by origin */
        const p = (!o.has(origin) && o.set(origin, new Map<MatchFunction, InvocationCallbacks>()), o.get(origin) || (() => { throw `can not register listeners for ${origin} origin` })());

        /** Save the listeners */
        const cb = (p.set(matchFn, callbacks), p.get(matchFn) || (() => { throw `can not register listeners for ${pathname} pathname` })());
    }
}

export class FetchInterceptor {
    private contextCache: Map<string, InvocationContext>;
    private listenersCache: Map<Map<MatchFunction, InvocationCallbacks>, [MatchFunction, InvocationCallbacks][]>;
    private listeners: InternalInvocationListenerInterface;

    constructor(private fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'>) {
        this.listeners = new InternalInvocationListener();
        this.contextCache = new Map<string, InvocationContext>();
        this.listenersCache = new Map<Map<MatchFunction, InvocationCallbacks>, [MatchFunction, InvocationCallbacks][]>();
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

        try {
            this.listeners.set(method, origin, match(pathname), pathname, callbacks);
        } catch (e) {
            throw `can not attach to ${pattern} on method ${method}, reason=${e}`;
        }
    }

    private requestPaused(params: Protocol.Fetch.RequestPausedEvent) {
        const { request: { method, url, headers }, requestId, responseStatusCode: statusCode, responseStatusText: statusText, responseHeaders = [] } = params;
        const { origin, pathname, searchParams } = new URL(url);
        const crq: Protocol.Fetch.ContinueRequestRequest = { requestId };
        const isreq = statusCode === undefined || statusText === undefined;
        const isredirect = !isreq && statusCode >= 300 && statusCode < 400;

        /** Check invocation method */
        if (!IsInvocationMethod(method)) return (this.fetch.continueRequest(crq), void 0);

        /** Retrieve the listeners */
        const p = this.listeners.get(method as InvocationMethod, origin); if (!p) return (this.fetch.continueRequest(crq), void 0);
        const pp = this.listenersCache.get(p) || this.listenersCache.set(p, Array.from(p.entries())).get(p) || (() => { throw void 0; })();

        /** Retrieve the callbacks */
        const [matcher, callbacks] = pp.find(([m, c]) => m(pathname)) || [];
        if (!matcher || !callbacks) return (this.fetch.continueRequest(crq), void 0);

        /**
         * onRequest
         */
        if (isreq) {

            /** Prepare for callback */
            const { params } = matcher(pathname) || { params: {} };
            const ctx: InternalInvocationContext = new InternalInvocationContext(method, url, new Map(Object.entries(params)), new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])));
            const { onRequest: fn } = callbacks;

            /** onRequest callback is not specified */
            if (!fn) return (this.fetch.continueRequest(crq), void 0);

            /** Bind context and invoke */
            const invoker = fn.bind(ctx);
            const ret = (invoker(Object.fromEntries(searchParams), {}), ctx);

            /** Save context into cache for later */
            this.contextCache.set(requestId, ret);



            /** Mark to intercept the request */
            crq.interceptResponse = true;

            /** Update url */
            const u = ret.target.toString();
            u !== url && (crq.url = u);

            /** Update method */
            const m = ret.method;
            m !== method && (crq.method = m);

            /** Update headers */
            !!ret.requestHeaders.size && (crq.headers = Array.from(ret.requestHeaders.entries()).map(([name, value]) => ({ name, value })));

            // console.log(crq);
            this.fetch.continueRequest(crq);

            return;
        }

        /**
         * onResponse
         * 
         * Note: Skip Fetch.getResponseBody when redirect status received
         */
        (isredirect ? Promise.resolve('') : this.fetch.getResponseBody({ requestId }).then(x => x.base64Encoded ? Buffer.from(x.body, 'base64').toString() : x.body)).then(x => {

            /** Prepare for callback */
            const ctx: InternalInvocationReturnValue = new InternalInvocationReturnValue(statusCode, !statusText ? (HttpStatusText.get(statusCode) || 'UNKNOWN') : statusText, new Map(responseHeaders.map(({ name, value }) => [name.toLowerCase(), value])), new ArrayBuffer(0));
            const { onResponse: fn } = callbacks;

            /** onResponse callback is not specified */
            if (!fn) return (this.fetch.continueResponse({ requestId }), void 0);

            /** Bind context and invoke */
            const invoker = fn.bind(ctx);
            const cffrq: Protocol.Fetch.FulfillRequestRequest = { requestId, responseCode: statusCode };

            /** Try to parse body */
            const contenType = responseHeaders.find(x => x.name.toLowerCase() === 'content-type')?.value || '';
            const mime = MIME_REGEX.find(x => x.regex.test(contenType))?.name;
            const body: { [key: string]: string } = {};
            switch (mime) {
                case 'application/json':
                    try { Object.assign(body, JSON.parse(x)); } catch { }
                    break;
                default:
                    break;
            }

            /** Invoke callback */
            const ret = (invoker(body), ctx);

            /** Remove context from cache */
            this.contextCache.delete(requestId);



            /** Update status code */
            cffrq.responseCode = ret.statusCode;

            /** Update status text */
            cffrq.responsePhrase = ret.statusText;

            /** Update headers */
            cffrq.responseHeaders = Array.from(ret.responseHeaders.entries()).map(([name, value]) => ({ name, value }));

            /** Update body */
            cffrq.body = (!!ret.body.byteLength ? Buffer.from(ret.body) : Buffer.from(x)).toString('base64');

            // console.log(cffrq);
            this.fetch.fulfillRequest(cffrq);

            return;
        });
    }

    enable(): Promise<void> {
        this.fetch.requestPaused(params => this.requestPaused(params));
        return this.fetch.enable({});
    }
}