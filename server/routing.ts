/** Vercel 的普通函数路由不支持 Next.js 式 catch-all；由显式 rewrite 传入路径。 */
export function normalizeApiRequest(request: Request): Request {
    const url = new URL(request.url);
    const route = url.searchParams.get('__route');
    if (route === null) return request;
    url.searchParams.delete('__route');
    url.pathname = /^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*$/i.test(route) ? `/api/v1/${route}` : '/api/v1/invalid-route';
    return new Request(url, request);
}
