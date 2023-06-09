import { MatchFunction, match } from 'path-to-regexp';
import type ProtocolProxyApi from 'devtools-protocol/types/protocol-proxy-api';
import type Protocol from 'devtools-protocol/types/protocol';
import { DoEventListeners, DoEventPromises } from 'chrome-remote-interface';

const AllInvocationMethods = ['GET', 'POST'] as const;

export type InvocationMethod = typeof AllInvocationMethods[number];

export type InvocationOrigin = string;

export type InvocationPath = string;

function IsInvocationMethod(value: string): value is InvocationMethod {
    return AllInvocationMethods.includes(value as InvocationMethod)
}

export type InvocationContext = {
    method: InvocationMethod;
    url: string;
    params: Map<string, string>;
    requestHeaders: Map<string, string>;
}

export type InvocationArguments = { [key: string]: string };

export type InvocationReturnValue = {
    statusCode: number;
    statusText: string;
    responseHeaders: Map<string, string>;
};

export type InvocationCallbacks = {
    onRequest?: (this: InvocationContext, query: InvocationArguments, body: InvocationArguments) => void;
    onResponse?: (this: InvocationReturnValue) => void;
}


const HttpStatusText = new Map<number, string>([
    [100, "Continue"],
    [101, "Switching Protocols"],
    [200, "OK"],
    [201, "Created"],
    [202, "Accepted"],
    [203, "Non-Authoritative Information"],
    [204, "No Content"],
    [205, "Reset Content"],
    [206, "Partial Content"],
    [300, "Multiple Choices"],
    [301, "Moved Permanently"],
    [302, "Found"],
    [303, "See Other"],
    [304, "Not Modified"],
    [305, "Use Proxy"],
    [307, "Temporary Redirect"],
    [400, "Bad Request"],
    [401, "Unauthorized"],
    [402, "Payment Required"],
    [403, "Forbidden"],
    [404, "Not Found"],
    [405, "Method Not Allowed"],
    [406, "Not Acceptable"],
    [407, "Proxy Authentication Required"],
    [408, "Request Timeout"],
    [409, "Conflict"],
    [410, "Gone"],
    [411, "Length Required"],
    [412, "Precondition Failed"],
    [413, "Payload Too Large"],
    [414, "URI Too Long"],
    [415, "Unsupported Media Type"],
    [416, "Range Not Satisfiable"],
    [417, "Expectation Failed"],
    [426, "Upgrade Required"],
    [500, "Internal Server Error"],
    [501, "Not Implemented"],
    [502, "Bad Gateway"],
    [503, "Service Unavailable"],
    [504, "Gateway Timeout"],
    [505, "HTTP Version Not Supported"]
])

export class FetchInterceptor {
    private contextCache: Map<string, InvocationContext>;
    private listeners: Map<InvocationMethod, Map<InvocationOrigin, Map<MatchFunction, InvocationCallbacks>>>;

    constructor(private fetch: ProtocolProxyApi.FetchApi & DoEventPromises<'Fetch'> & DoEventListeners<'Fetch'>) {
        this.listeners = new Map<InvocationMethod, Map<InvocationOrigin, Map<MatchFunction, InvocationCallbacks>>>();
        this.contextCache = new Map<string, InvocationContext>();
    }

    get(pattern: string, callbacks: InvocationCallbacks) {
        const { origin, pathname } = new URL(pattern);
        const reason = `can not attach to ${pattern} on method GET`;

        const o = (!this.listeners.has('GET') && this.listeners.set('GET', new Map<InvocationOrigin, Map<MatchFunction, InvocationCallbacks>>()), this.listeners.get('GET'));
        if (!o) throw reason;

        const p = (!o.has(origin) && o.set(origin, new Map<MatchFunction, InvocationCallbacks>()), o.get(origin));
        if (!p) throw reason;

        const cb = p.set(match(pathname), callbacks);
        if (!cb) throw reason;
    }

    post(pattern: string, callbacks: InvocationCallbacks) {
        const { origin, pathname } = new URL(pattern);
        const reason = `can not attach to ${pattern} on method GET`;

        const o = (!this.listeners.has('POST') && this.listeners.set('POST', new Map<InvocationOrigin, Map<MatchFunction, InvocationCallbacks>>()), this.listeners.get('POST'));
        if (!o) throw reason;

        const p = (!o.has(origin) && o.set(origin, new Map<MatchFunction, InvocationCallbacks>()), o.get(origin));
        if (!p) throw reason;

        const cb = p.set(match(pathname), callbacks);
        if (!cb) throw reason;
    }

    private requestPaused(params: Protocol.Fetch.RequestPausedEvent) {
        const { request: { method, url, headers }, requestId, responseStatusCode: statusCode, responseStatusText: statusText, responseHeaders = [] } = params;
        const { origin, pathname, searchParams } = new URL(url);

        if (!IsInvocationMethod(method)) {
            this.fetch.continueRequest({ requestId });
            return;
        }

        const o = this.listeners.get(method);
        if (!o) {
            this.fetch.continueRequest({ requestId });
            return;
        }

        const p = o.get(origin);
        if (!p) {
            this.fetch.continueRequest({ requestId });
            return;
        }

        for (const [k, v] of p) {

            const r = k(pathname);
            if (!r) {
                continue;
            }

            const { params } = r;

            if (statusCode === undefined || statusText === undefined) {
                const ctx: InvocationContext = { method, url, params: new Map(Object.entries(params)), requestHeaders: new Map(Object.entries(headers)) };
                const { onRequest: fn = () => void 0 } = v;
                const invoker = fn.bind(ctx);
                const ret = (invoker(Object.fromEntries(searchParams), {}), ctx);
                this.contextCache.set(requestId, ret);
                this.fetch.continueRequest({
                    requestId,
                    method: ret.method !== method ? ret.method : undefined,
                    interceptResponse: true,
                    headers: Array.from(ctx.requestHeaders.entries()).filter(x => !Object.hasOwn(headers, x[0])).map(([name, value]) => ({ name, value }))
                });
                return;
            }

            const ctx: InvocationReturnValue = { statusCode, statusText: !statusText ? (HttpStatusText.get(statusCode) || 'UNKNOWN') : statusText, responseHeaders: new Map(responseHeaders.map(({ name, value }) => [name, value])) };
            const { onResponse: fn = () => void 0 } = v;
            const invoker = fn.bind(ctx);
            const ret = (invoker(), ctx);

            this.contextCache.delete(requestId);

            this.fetch.continueResponse({
                requestId,
                responseCode: ret.statusCode,
                responsePhrase: ret.statusText,
                responseHeaders: Array.from(ret.responseHeaders.entries()).filter(x => !Object.hasOwn(headers, x[0])).map(([name, value]) => ({ name, value }))
            });
            return;
        }

        return this.fetch.continueRequest({ requestId });
    }

    enable(): Promise<void> {

        this.fetch.requestPaused(params => this.requestPaused(params));
        return this.fetch.enable({});
    }
}