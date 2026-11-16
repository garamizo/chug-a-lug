// Disposable stand-in for the harnesses only: Resend (SMTP). SMTP sink :12525 · control :12526 (GET/DELETE /messages, POST /mode).
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
      messages.push({ to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), subject: m.subject ?? '', text: m.text ?? '', html: typeof m.html === 'string' ? m.html : '' });
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
smtp.listen(12525, '127.0.0.1');
control.listen(12526, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { smtp.close(); control.close(); process.exit(0); });
