import { createServer } from 'node:https';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

/** Local HTTPS reverse proxy exercises browser cookies, origins and real streaming sockets. */
export async function mobileTlsProxy() {
  let targetPort = 0;
  let loseTaskReply = false;
  let loseAdminReply = false;
  let loseWorkspaceReply = false;
  let loseProjectReply = false;
  let loseTerminalReply = false;
  let loseInputReply = false;
  let inputReplyMatch: string | undefined;
  let rejectApi = false;
  let upstreamOrigin: string | null = null;
  const sockets = new Set<Duplex>();
  const server = createServer({ key: readFileSync(resolve('scripts/fixtures/mobile-tls/key.pem')),
    cert: readFileSync(resolve('scripts/fixtures/mobile-tls/cert.pem')) }, (req, res) => {
    if (rejectApi && req.url?.startsWith('/api/')) { res.destroy(); return; }
    const headers = { ...req.headers, ...(upstreamOrigin ? { host: new URL(upstreamOrigin).host,
      ...(req.headers.origin ? { origin: upstreamOrigin } : {}) } : {}) };
    const inputChunks: Buffer[] = []; let inputBytes = 0;
    if (req.url === '/api/v1/terminal/input') req.on('data', (chunk: Buffer) => {
      inputBytes += chunk.length; if (inputBytes <= 128 * 1024) inputChunks.push(chunk);
    });
    const upstream = request({ hostname: '127.0.0.1', port: targetPort, path: req.url, method: req.method, headers }, (reply) => {
      // Target a specific text submission when a test must not lose an unrelated resize acknowledgement.
      let matchingInput = inputReplyMatch === undefined;
      if (inputReplyMatch && inputBytes <= 128 * 1024) {
        try { const input = JSON.parse(Buffer.concat(inputChunks).toString('utf8')); matchingInput = typeof input.data === 'string' && input.data.includes(inputReplyMatch); } catch {}
      }
      if (req.method === 'POST' && ((loseTaskReply && req.url === '/api/v1/tasks')
        || (loseAdminReply && req.url === '/api/v1/admin/commands') || (loseWorkspaceReply && req.url === '/api/v1/workspace/save')
        || (loseProjectReply && req.url === '/api/v1/projects/command')
        || (loseTerminalReply && req.url === '/api/v1/terminal/command') || (loseInputReply && matchingInput && req.url === '/api/v1/terminal/input'))) {
        reply.resume(); res.destroy(); return;
      }
      res.writeHead(reply.statusCode!, reply.headers); reply.pipe(res);
      reply.on('aborted', () => res.destroy()); reply.on('error', () => res.destroy());
      res.on('close', () => reply.destroy());
    });
    upstream.on('error', () => res.destroy());
    req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  return { origin: `https://ade-mobile.fixture.ts.net:${port}`, localOrigin: `https://127.0.0.1:${port}`,
    target: (value: number) => { targetPort = value; },
    rewriteOrigin: (value: string) => { upstreamOrigin = value; },
    loseTaskReplies: (value: boolean) => { loseTaskReply = value; },
    loseAdminReplies: (value: boolean) => { loseAdminReply = value; },
    loseWorkspaceReplies: (value: boolean) => { loseWorkspaceReply = value; },
    loseProjectReplies: (value: boolean) => { loseProjectReply = value; },
    loseTerminalReplies: (value: boolean) => { loseTerminalReply = value; },
    loseInputReplies: (value: boolean, match?: string) => { loseInputReply = value; inputReplyMatch = match; },
    setApiOffline: (value: boolean) => { rejectApi = value; if (value) for (const socket of sockets) socket.destroy(); },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((done) => server.close(() => done())); },
  };
}
