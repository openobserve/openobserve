/**
 * Readable mail sink — the observability layer for email-destination tests.
 *
 * Historically every email test was skipped with "the test environment does not
 * have email infrastructure set up". That over-stated the dependency: most email
 * cases (validation, splitting, storage, error strings) need only SMTP switched
 * ON, and never read a mailbox. Only delivery assertions — envelope headers, MIME
 * parts, fan-out — need a sink. This module isolates that dependency so the rest
 * of the suite runs anywhere.
 *
 * Two backends, chosen by MAIL_SINK (or auto-detected):
 *   mailpit    — local container, ideal for dev/CI-with-services
 *                docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit
 *   mailinator — public inbox read over HTTP, works against a shared env where
 *                you cannot run a container next to the app
 *
 * Tests that need a sink call `await sink.available()` and skip cleanly when
 * false, rather than failing.
 */
const MODE = process.env.MAIL_SINK || 'auto';
const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025';
const MAILINATOR_INBOX = process.env.MAILINATOR_INBOX || '';

let resolved = null;

async function reachable(url, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return r.ok;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Which backend is usable right now. Cached — probing is a network call. */
async function backend() {
  if (resolved !== null) return resolved;
  if (MODE === 'mailpit' || MODE === 'auto') {
    if (await reachable(`${MAILPIT}/api/v1/messages`)) return (resolved = 'mailpit');
    if (MODE === 'mailpit') return (resolved = null);
  }
  if ((MODE === 'mailinator' || MODE === 'auto') && MAILINATOR_INBOX) {
    if (await reachable(`https://www.mailinator.com/api/v2/domains/public/inboxes/${MAILINATOR_INBOX}`)) {
      return (resolved = 'mailinator');
    }
  }
  return (resolved = null);
}

async function available() {
  return (await backend()) !== null;
}

/** Human-readable reason for a skip, so the report says why rather than just "skipped". */
async function unavailableReason() {
  return `no readable mail sink (MAIL_SINK=${MODE}); start Mailpit on ${MAILPIT} `
       + `or set MAILINATOR_INBOX to a public inbox name`;
}

/** `ts` is epoch ms, carried so latest() can sort rather than trust API order —
 *  Mailpit returns /api/v1/messages newest-first, but Mailinator's v2 inbox
 *  returns oldest-first, and neither ordering is documented as an API contract. */
async function list() {
  const b = await backend();
  if (b === 'mailpit') {
    const r = await fetch(`${MAILPIT}/api/v1/messages`);
    const d = await r.json();
    return (d.messages || []).map((m) => ({ id: m.ID, subject: m.Subject, ts: Date.parse(m.Created) || 0 }));
  }
  if (b === 'mailinator') {
    const r = await fetch(`https://www.mailinator.com/api/v2/domains/public/inboxes/${MAILINATOR_INBOX}`);
    const d = await r.json();
    return (d.msgs || []).map((m) => ({ id: m.id, subject: m.subject, ts: Number(m.time) || 0 }));
  }
  return [];
}

async function count() {
  return (await list()).length;
}

/** Mailpit can be emptied; a public inbox cannot, so callers baseline instead. */
async function clear() {
  if ((await backend()) === 'mailpit') {
    await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
    return true;
  }
  return false;
}

async function waitForCount(n, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    last = await count();
    if (last >= n) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}

/** Newest message normalised to { subject, from, to[], text, html, raw }. */
async function latest() {
  const b = await backend();
  const msgs = await list();
  if (!msgs.length) return null;
  const id = [...msgs].sort((a, c) => c.ts - a.ts)[0].id;

  if (b === 'mailpit') {
    const m = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
    const raw = await (await fetch(`${MAILPIT}/api/v1/message/${id}/raw`)).text();
    return {
      subject: m.Subject,
      from: (m.From && m.From.Address) || '',
      to: (m.To || []).map((t) => t.Address.toLowerCase()).sort(),
      text: m.Text || '',
      html: m.HTML || '',
      raw,
    };
  }
  if (b === 'mailinator') {
    const m = await (await fetch(
      `https://www.mailinator.com/api/v2/domains/public/inboxes/${MAILINATOR_INBOX}/messages/${id}`)).json();
    const parts = {};
    for (const p of m.parts || []) {
      const ct = ((p.headers || {})['content-type'] || '').split(';')[0].trim();
      parts[ct] = p.body || '';
    }
    const h = m.headers || {};
    return {
      subject: h.subject || m.subject,
      from: h.from || m.fromfull || '',
      to: String(h.to || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).sort(),
      text: parts['text/plain'] || '',
      html: parts['text/html'] || '',
      raw: JSON.stringify(h),
    };
  }
  return null;
}

module.exports = { available, unavailableReason, backend, list, count, clear, waitForCount, latest };
