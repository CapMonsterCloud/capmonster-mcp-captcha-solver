export type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;

const originalFetch = globalThis.fetch;

export function mockFetch(handler: FetchHandler): void {
  globalThis.fetch = ((url: string | URL, init?: RequestInit) =>
    handler(url.toString(), init)) as typeof fetch;
}

export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}
