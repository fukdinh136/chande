import { createServer, type IncomingMessage } from 'node:http';
export interface ResponseSpec { status?: number; body: unknown }
export async function withServer<T>(handler: (request: IncomingMessage, body: Record<string, unknown>) => ResponseSpec | Promise<ResponseSpec>, work: (url: string) => Promise<T>): Promise<T> {
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += String(chunk);
      const response = await handler(req, raw ? JSON.parse(raw) as Record<string, unknown> : {});
      res.writeHead(response.status ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(response.body));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server port');
  try { return await work(`http://127.0.0.1:${address.port}`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
export function envelope(data: unknown, requestId: unknown): unknown { return { data, meta: { requestId } }; }
