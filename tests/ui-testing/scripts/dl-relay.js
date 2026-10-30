#!/usr/bin/env node
/**
 * Distribution-list relay — test infrastructure for email fan-out.
 *
 * Mailpit is a sink: it accepts mail for any address and stores exactly ONE
 * message. It has no alias table, so it can never demonstrate what a real
 * distribution list does — turn one alias into N deliveries. This sits in front
 * of it and supplies exactly that, so the DL fan-out case can run with no
 * external mail provider, no secrets and no network egress.
 *
 * Same pattern the repo already uses for webhooks, where
 * alerts-content-templates.spec.js runs an in-test HTTP server to capture what
 * each destination actually sent. This is the email equivalent.
 *
 *   OpenObserve --:1026--> [this relay] --:1025--> Mailpit
 *                           expands DL_ADDRESS into DL_MEMBERS
 *
 * It behaves the way a real MTA does for an alias: the RFC822 headers are passed
 * through untouched (an MTA rewrites the envelope, not the To: header), so
 * recipients still see the alias in To: — which is the property D-02 asserts.
 * Each copy is stamped with Delivered-To so the members can be told apart.
 *
 * Any address that is not a configured alias is forwarded unchanged, so every
 * other suite sharing this runner is unaffected.
 *
 * Env: DL_ADDRESS, DL_MEMBERS (comma-separated), DL_RELAY_PORT, MAILPIT_SMTP_PORT
 */
const net = require('net');

const LISTEN_PORT = Number(process.env.DL_RELAY_PORT || 1026);
const FORWARD_HOST = process.env.MAILPIT_SMTP_HOST || '127.0.0.1';
const FORWARD_PORT = Number(process.env.MAILPIT_SMTP_PORT || 1025);
const DL_ADDRESS = (process.env.DL_ADDRESS || '').toLowerCase();
const DL_MEMBERS = (process.env.DL_MEMBERS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const log = (...a) => console.log('[dl-relay]', ...a);

/** Resolve one address to leaf mailboxes; unknown addresses pass through. */
function expand(addr) {
  const a = addr.toLowerCase().replace(/^<|>$/g, '').trim();
  return DL_ADDRESS && a === DL_ADDRESS && DL_MEMBERS.length ? DL_MEMBERS : [a];
}

/** Minimal SMTP client: hand one message to Mailpit for one recipient. */
function forward(from, rcpt, data) {
  return new Promise((resolve) => {
    const sock = net.connect(FORWARD_PORT, FORWARD_HOST);
    const steps = [`EHLO dl-relay`, `MAIL FROM:<${from}>`, `RCPT TO:<${rcpt}>`, 'DATA'];
    let i = -1;
    let inData = false;
    let done = false;   // the server answers again after the body; ignore it
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      if (done) return;
      // Only act on the final line of a multi-line reply (e.g. "250-..." then "250 ...").
      const last = chunk.trim().split(/\r?\n/).pop() || '';
      if (/^\d{3}-/.test(last)) return;
      if (inData) { done = true; sock.write('QUIT\r\n'); sock.end(); return resolve(true); }
      i += 1;
      if (i < steps.length) return sock.write(steps[i] + '\r\n');
      // server answered 354 to DATA — send the body, dot-stuffed, then terminate
      inData = true;
      const body = data.replace(/\r?\n\./g, '\n..');
      sock.write(`Delivered-To: ${rcpt}\r\n` + body + '\r\n.\r\n');
    });
    sock.on('error', (e) => { if (!done) log('forward failed', rcpt, e.message); resolve(false); });
    sock.setTimeout(15000, () => { if (!done) log('forward timed out', rcpt); sock.destroy(); resolve(false); });
  });
}

const server = net.createServer((sock) => {
  let rcpts = [];
  let from = '';
  let collecting = false;
  let buf = '';
  sock.setEncoding('utf8');
  sock.write('220 dl-relay ESMTP\r\n');

  sock.on('data', async (chunk) => {
    if (collecting) {
      buf += chunk;
      const end = buf.indexOf('\r\n.\r\n');
      if (end === -1) return;
      const data = buf.slice(0, end);
      collecting = false;
      buf = '';

      const leaves = [];
      for (const r of rcpts) for (const leaf of expand(r)) if (!leaves.includes(leaf)) leaves.push(leaf);
      log(`envelope ${JSON.stringify(rcpts)} -> ${leaves.length} delivery(ies)`, leaves);
      for (const leaf of leaves) await forward(from, leaf, data);

      rcpts = [];
      sock.write('250 OK: queued\r\n');
      return;
    }

    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      const up = line.toUpperCase();
      if (up.startsWith('EHLO') || up.startsWith('HELO')) sock.write('250-dl-relay\r\n250 SIZE 26214400\r\n');
      else if (up.startsWith('MAIL FROM')) { from = (line.split(':')[1] || '').replace(/[<>]/g, '').trim(); sock.write('250 OK\r\n'); }
      else if (up.startsWith('RCPT TO')) { rcpts.push((line.split(':')[1] || '').trim()); sock.write('250 OK\r\n'); }
      else if (up === 'DATA') { collecting = true; sock.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
      else if (up === 'RSET') { rcpts = []; sock.write('250 OK\r\n'); }
      else if (up === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {   // loopback only: shared runner
  log(`listening on ${LISTEN_PORT}, forwarding to ${FORWARD_HOST}:${FORWARD_PORT}`);
  log(DL_ADDRESS ? `alias ${DL_ADDRESS} -> ${DL_MEMBERS.length} member(s): ${DL_MEMBERS.join(', ')}`
                 : 'no DL_ADDRESS configured — pure pass-through');
});
