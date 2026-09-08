import { get } from 'node:https';

export type HttpsReadinessProbe = (origin: string, signal: AbortSignal) => Promise<boolean>;

/** Normal certificate/hostname verification. No redirects, proxy env, cookies or credential material. */
export const probePrivateHttps: HttpsReadinessProbe = (origin, signal) => new Promise((resolve) => {
  let settled = false;
  const finish = (ok: boolean): void => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
  const request = get(`${origin}/`, { signal, rejectUnauthorized: true, headers: { accept: 'text/html' } }, (response) => {
    let bytes = 0; let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 512 * 1024) { response.destroy(); finish(false); return; }
      body += chunk;
    });
    response.on('end', () => finish(response.statusCode === 200 && body.includes('ADE') && body.includes('id="root"')));
    response.on('error', () => finish(false));
  });
  const timer = setTimeout(() => { request.destroy(); finish(false); }, 20_000);
  timer.unref();
  request.on('error', () => finish(false));
});
