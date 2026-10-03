// Disposable stand-ins for the harnesses only: Resend (SMTP), Cloudflare Turnstile and an OIDC
// provider that plays Google. SMTP sink :12525 · control :12526 (GET/DELETE /messages, POST /mode)
// · Turnstile :12527 (single-use tokens starting "ok"; "down…" answers 500) · OIDC :12528 (code = base64url identity JSON).
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { createServer } from 'node:http';

const messages = [];
let mode = 'ok';
const smtp = new SMTPServer({
  authOptional: true, disabledCommands: ['STARTTLS', 'AUTH'], logger: false,
  onRcptTo(_address, _session, callback) {
    if (mode === 'fail') return callback(Object.assign(new Error('Mailbox unavailable (test)'), { responseCode: 554 }));
    callback();
  },
  onData(stream, session, callback) {
    simpleParser(stream).then((m) => {
      messages.push({ to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), subject: m.subject ?? '', text: m.text ?? '' });
      callback();
    }, callback);
  }
});
const readBody = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => resolve(s)); });
const control = createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/health') return send(200, { ok: true });
  if (req.url === '/messages' && req.method === 'GET') return send(200, messages);
  if (req.url === '/messages' && req.method === 'DELETE') { messages.length = 0; return send(200, {}); }
  if (req.url === '/mode' && req.method === 'POST') { mode = JSON.parse(await readBody(req)).mode; return send(200, { mode }); }
  send(404, {});
});
// Like Cloudflare, a token passes once: a client that resubmits a used token must fail.
const usedTokens = new Set();
const turnstile = createServer(async (req, res) => {
  const form = new URLSearchParams(await readBody(req));
  const token = form.get('response') ?? '';
  // A token starting "down" plays a siteverify outage.
  if (token.startsWith('down')) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{}'); }
  const success = token.startsWith('ok') && !usedTokens.has(token) && form.get('secret') === 'test-turnstile-secret';
  usedTokens.add(token);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ success }));
});
// The token endpoint hands the code back as the access token; userinfo decodes it.
const oidc = createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url?.startsWith('/token')) {
    const code = new URLSearchParams(await readBody(req)).get('code') ?? '';
    return send(200, { access_token: code, token_type: 'Bearer', expires_in: 3600 });
  }
  if (req.url?.startsWith('/userinfo')) {
    try { return send(200, JSON.parse(Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''), 'base64url').toString('utf8'))); }
    catch { return send(401, {}); }
  }
  send(404, {});
});
smtp.listen(12525, '127.0.0.1');
control.listen(12526, '127.0.0.1');
turnstile.listen(12527, '127.0.0.1');
oidc.listen(12528, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { smtp.close(); control.close(); turnstile.close(); oidc.close(); process.exit(0); });
