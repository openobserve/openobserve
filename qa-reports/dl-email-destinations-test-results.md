# Email Destinations / DL — Test Execution Report

**Build:** local `v0.92.0-rc3`, commit `cb78ef36`, `build_type: opensource`
**Date:** 2026-08-18 · **Tester:** QA
**Method:** Playwright UI suite (17 cases) + REST API cases + real alert firing, against a local
Mailpit SMTP sink so every delivery claim is checked against the actual RFC822 message.

## Result

| | |
|---|---|
| UI cases run | 17 — **15 passed, 2 failed** (both the same defect, B4) |
| API cases run | 8 — all behaved as specified |
| Lifecycle cases | 3 — one serious defect (B2) |
| Template cases | both kinds exercised end to end via a real firing alert |
| Defects raised | **5** — 2×P1, 2×P2, 1×P3 |

The feature works for its main path: a DL address that is an org member saves, tests, and receives
real alerts with correctly-resolved template variables. The defects are concentrated in **template
rendering** and in **what happens after configuration time**.

---

## Defects

### B1 · P1 · "Show matching rows" toggle is inert — log rows are always embedded

**What happens.** A Content-kind template saved with `rows.enabled: false` (confirmed false in the
stored spec via `GET /alerts/templates/qa_tpl_content`) still rendered a five-row table of raw log
lines into both the HTML and the plain-text part of the delivered alert email.

**Root cause.** `src/core/src/alerts/notifications/resolve.rs` builds `rows` from `ctx.rows` using
only `spec.rows.max` — `spec.rows.enabled` is never read anywhere in the resolve or render layer.
The renderers then emit the table whenever the collection is non-empty
(`render/email.rs:114` and `:217`).

**Why it matters.** The switch is exposed in the template editor as **"Show matching rows"**
(`content-template-form-rows-enabled-switch`). An operator who turns it off — precisely because the
stream carries customer data, tokens or PII — still ships those rows to every recipient. Against a
distribution list the mail server then fans that out to everyone behind the alias. Applies to every
channel that uses content templates, not just email.

**Evidence.** Stored: `{'enabled': False, 'max': 5, 'columns': None, 'format': None}`.
Delivered text part contained five `_timestamp: … | code: … | level: error | message: …` lines.

---

### B2 · P1 · A user removed from the org keeps receiving alert emails

**What happens.** `qa-temp@test.local` was a valid recipient on a saved destination. The user was
then removed from the organization. The alert fired twice afterwards and **delivered to that address
both times**.

At the same moment, the same address is refused everywhere else:

| Action | Result |
|---|---|
| Alert fires → email sent | **delivered** (twice) |
| Test button | `Email destination recipients must be part of this org` |
| Re-save the destination unchanged | HTTP 400, same message |

**Root cause.** Membership is validated in `save()` and in `test_email()`
(`src/core/src/alerts/destinations.rs`), but the alert send path does no re-validation — it reads the
stored recipients and sends.

**Why it matters.** Two separate problems from one cause:

1. **Offboarding does not stop alert delivery.** A departed employee keeps receiving production
   alert content — including, per B1, raw log rows — indefinitely. Removing them from the org looks
   like it worked; it did not.
2. **The destination becomes un-editable.** Any later save is blocked by the stale recipient, and
   the error names no address, so an admin trying to *add* a recipient is stopped by an unrelated
   entry they cannot identify from the message.

**Suggested fix.** Validate (or at least filter) recipients at send time and log skipped ones; and
name the offending address in the error.

---

### B3 · P2 · Custom-kind templates put raw HTML into the text/plain part

**What happens.** The `text/plain` MIME part of an alert email contains HTML markup:

```
Content-Type: text/plain; charset=utf-8

<h2>🚨 Alert Notification: qa_dl_alert</h2><p><strong>Stream:</strong> qa_dl_stream<br>…
```

Confirmed on the real alert path using the **default `prebuilt_email` template**, and on the Test
email path. A side-by-side Content-kind template on the same alert produced a correct, readable text
part — so the defect is isolated to the Custom path.

**Root cause.** `src/core/src/alerts/alert.rs`, `TemplateKind::Custom` arm:
`send_email_notification(&email_subject, email, msg.clone(), msg)` — the same string is passed as
both the text and the HTML body. `test_email()` does the same.

**Why it matters.** `prebuilt_email` is attached automatically to every destination created from the
Email tile, so this is the **default** experience. Anything that prefers or only renders text/plain
shows markup: plain-text clients, phone/watch notification previews, screen readers, and email-intake
systems such as Jira, ServiceNow or Slack's email-to-channel.

---

### B4 · P2 · Prebuilt Email form rejects semicolon-separated recipients, and blames the addresses

**What happens.** Entering `qa-a@test.local;qa-b@test.local` fails client-side with
**"Invalid email addresses: qa-a@test.local;qa-b@test.local"**. No request is sent. Both suite
failures (ML-02, ML-03) are this.

**Root cause.** `web/src/utils/prebuilt-templates/email.ts:120` splits on `","` only, so the whole
string is tested as a single address and fails the email regex.

**Why it matters for this feature specifically.** Outlook and Exchange — the clients most likely to
be in use wherever distribution lists are — separate recipients with **semicolons** by default. The
natural DL workflow (copy the member list out of Outlook, paste it in) is rejected, and the message
says the addresses are invalid rather than that the separator is wrong. The field's hint
("Comma-separated email addresses") is *replaced* by the error, so the one piece of guidance
disappears exactly when the user needs it.

**Suggested fix.** Split on `[;,]` (matching the other destination path), or keep comma-only and say
so: "Separate addresses with commas".

---

### B5 · P3 · "Skip TLS Verify" is shown on Email destinations and does nothing

The Email form renders a **Skip TLS Verify** toggle under Additional Settings. An email destination
carries only `recipients` in the backend model; SMTP transport security is server configuration
(`ZO_SMTP_ENCRYPTION`, derived from the port). Custom Headers are already hidden for email
(`v-if="dtVal !== 'email'"`); this toggle was not. An operator may reasonably believe they are
changing SMTP TLS behaviour from here.

---

## Verified correct — no defect

Recorded so the next tester does not re-investigate:

- **Both gates** behave exactly as specified, with stable error strings.
- **Test endpoint returns HTTP 200 with `success:false`** on failure — assert on the body, never the
  status code.
- **Trim + lowercase on save**: `"  QA-A@Test.Local  "` → `qa-a@test.local`.
- **Trailing separator is blocked** (`qa-a@test.local,` → refused). The pre-run prediction that the
  prebuilt path would store an empty recipient was **wrong** — that validator does catch it.
- **200 recipients** stored intact in 6.8 ms; no truncation.
- **Delete-in-use** returns 409 naming the alert: `Destination is currently used by alert: qa_dl_alert`.
- **Transport failure is reported honestly**: with the sink stopped, `Email send failed: … Connection
  refused (os error 61)` — no false success.
- **No unresolved placeholders** in either template kind; `{alert_count}`, `{alert_operator}`,
  `{alert_threshold}`, `{alert_url}` all resolved.
- **Content-kind email rendering is good**: table-based HTML, a genuinely readable text alternative,
  severity prefix, working short link.

---

## UI and usability findings

1. **Two different paradigms for the same field.** *Custom Destination → Email* uses an org-user
   multi-select — only real members are selectable, so the error in B2/D-03 is impossible to trigger.
   The *prebuilt Email tile* uses free text — type anything, discover the problem on save.
   Pick one. The picker is the better model.
2. **The picker makes the DL workflow a dead end.** A DL alias is not a person, so it is not in the
   picker; the user must leave the form, invite the alias in IAM, and come back — with nothing in the
   UI telling them so. The form already carries `showCreateUser` / `createUserRoles` scaffolding —
   surface an inline "Add a recipient who isn't in this org" that opens that drawer.
3. **The error replaces the hint.** Losing "Comma-separated email addresses" at the moment of failure
   is the difference between a five-second fix and a support ticket.
4. **Errors should name the offender.** With three recipients and one non-member, the message says
   "recipients must be part of this org" without saying which one.
5. **No de-duplication anywhere.** 200 identical addresses were accepted and would be addressed 200
   times in one message.
6. **All recipients go in `To:`, never `Bcc:`.** Correct for a DL alias; questionable for a 30-person
   list where everyone sees everyone. Consider Bcc above a threshold.

---

## Environment gotchas worth fixing

- **A stray `Show less` line in the repo-root `.env`** (line 117, pasted from a docs page) makes
  `dotenvy` abort, and **every variable after it is silently ignored**. My `ZO_SMTP_*` block sat
  below it, so SMTP reported "not configured" while being correctly set. OpenObserve logs no warning.
  *Product suggestion:* warn when `.env` parsing fails rather than half-loading the config.
- **`tests/ui-testing/.env` carries `IS_CLOUD=true`** left over from alpha runs, so
  `getOrgIdentifier()` reads a cached `cloud-config.json` and every UI request goes to the **alpha
  cloud org** even when `ZO_BASE_URL` points at localhost. A local run silently exercises the wrong
  organization. Export `IS_CLOUD=false` for local runs, or gate the cloud-config read on the base URL.
- **OSS builds accept only `admin` / `root` / `service_account`.** `viewer` returns "Custom roles not
  allowed", so recipient users must be created as `admin` locally.

## Artifacts

| File | Purpose |
|---|---|
| `tests/ui-testing/playwright-tests/Alerts/dl-email-destinations.spec.js` | 17 UI-weighted cases |
| `tests/ui-testing/playwright-tests/utils/mailpit.js` | Reads the sink — envelope, MIME, raw source |
| `tests/ui-testing/playwright-tests/utils/o2-api.js` | Asserts what was persisted, not what the form shows |

Run with:

```bash
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
ZO_BASE_URL=http://localhost:5080 INGESTION_URL=http://localhost:5080 ORGNAME=default \
IS_CLOUD=false ZO_ROOT_USER_EMAIL=root@example.com ZO_ROOT_USER_PASSWORD='Complexpass#123' \
npx playwright test playwright-tests/Alerts/dl-email-destinations.spec.js --workers=1
```
