# chromerd
A Chrome DevTools Protocol Wrapper with Frida Interceptor Style

```typescript
import CDP from 'chrome-remote-interface';
import { FetchInterceptor } from 'chromerd';

(async () => {

    const { Fetch, Page } = await CDP();

    const fetch = new FetchInterceptor(Fetch);

    fetch.get('https://github.com/', {
        onRequest(query, post) {
            console.log(`${this.method} ${this.url}`);
        },
        onResponse(body) {
        },
    });

    await fetch.enable();
    await Page.reload();
})();
```

