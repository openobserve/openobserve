### Bug Description

Problems in the new **domain-based org mapping** feature (PR #14691, cloud-only) — the setting that automatically adds new users to an organization when their email domain matches a rule. Tracked together as a checklist since they all live in the same feature. Problems 2–4 share a root cause: the API does not validate/normalize the `domain` field the way the UI does.

- [ ] **`P1` · Problem 1 — Invited users get stuck as a ghost "Invited" entry (seen in the UI).** If someone is invited to an organization *and* a domain rule also matches their email, they end up added twice: once as a real member, and once as a leftover **Invited** row that can never be cleared. Accepting the invite does nothing (they're already in), so the phantom invite sits there forever, and the same person appears in the Users list with two different roles.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  On first sign-in, `process_domain_org_mapping` auto-adds the user (creates the `org_users` row + OpenFGA tuples) and `check_and_add_to_org` returns them as *not* a new user. The pending invite is never consumed, and invite acceptance is a no-op for an existing org member, so the invite row is never cleared. In the screenshot, `qa1@domain4.com` appears as both an active Editor (with a name) and a stuck **Invited** Admin (no name); `qa2@domain1.com` is similarly stuck.

  - **Where:** `src/api/common/src/auth/jwt.rs` — `process_domain_org_mapping` / `check_and_add_to_org`.
  - **Proposed fix:** when the domain rule auto-adds a user, revoke/consume any pending invite for that (email, org); or make invite acceptance idempotent for an existing member and clear the invite.
  </details>

- [ ] **`P2` · Problem 2 — Domain rules silently do nothing when the email's capitalisation differs.** Domain rules only match if the email domain has the exact same upper/lowercase as the saved rule. The app saves domains in lowercase, but real emails can arrive capitalised (e.g. `Alice@ACME.com`), so the rule is silently skipped — the user lands in their own empty org instead of the mapped one, with no error explaining why.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  The UI stores the mapping domain lowercased (`DomainOrgMappingDialog.vue` `onSubmit` → `value.domain.trim().toLowerCase()`), but the backend compares with exact string equality (`m.domain == domain`, where `domain = user_email.split_once("@").1`, un-normalized). Email domains are case-insensitive (RFC), and IdPs/Dex may preserve the case the user typed. Setting the domain via the API directly (bypassing the UI lowercase) with any uppercase creates a rule that can never match.

  - **Where:** `src/api/common/src/auth/jwt.rs` — `process_domain_org_mapping`; and the settings/create API in `src/api/management/src/request/organization/settings.rs`.
  - **Proposed fix:** lowercase/normalize both the stored domain (on the settings/create API) and the incoming email domain before comparison.
  </details>

- [ ] **`P3` · Problem 3 — A rule's domain with stray spaces is saved but never matches.** If a rule's domain is saved with leading/trailing/internal spaces (e.g. `" acme.com"` or `"a b.com"`), the rule saves fine but can never match a real email, so auto-join silently does nothing. Reachable via the API only (the form trims/blocks it).

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  The settings/create API (`src/api/management/src/request/organization/settings.rs`) stores the `domain` string as-is — no trim, no format check — and matching is exact (`m.domain == domain`). Verified live: `POST /api/_meta/settings` accepts `" "`, `" acme.com"`, `"a b.com"` with `200`. The UI is safe because `DomainOrgMappingDialog.vue` `onSubmit` does `value.domain.trim().toLowerCase()` and `isValidDomain` rejects internal spaces.

  - **Proposed fix:** trim (and lowercase — see Problem 2) the domain server-side, and reject a domain that isn't a syntactically valid hostname. One normalization/validation guard covers Problems 2–4.
  </details>

- [ ] **`P3` · Problem 4 — An empty domain can be saved as a rule.** The API accepts a rule whose domain is an empty string, creating a meaningless rule that could match a malformed `user@` address. Reachable via the API only (the form requires a non-empty, valid domain).

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  Verified live: `POST /api/_meta/settings` with `domain: ""` returns `200` and stores it. At sign-in the email domain comes from `user_email.split_once("@").1`, which is `""` only for an address ending in `@` — practically unreachable via normal signup, so impact is low, but an empty-domain rule should never be storable.

  - **Where:** `src/api/management/src/request/organization/settings.rs` (no domain validation on create).
  - **Proposed fix:** reject empty/blank domains (covered by the same server-side validation as Problem 3).
  </details>

_A screenshot demonstrating Problem 1 is available and will be attached to this issue._

### Priority

P1 - High

### Severity

Major

### Related Story/Issue

PR #14691 (feat: add support in cloud for domain based org mapping). design-at: none. No paired private PR.

### Is this a regression?

No — new, not-yet-released feature.

### Steps to Reproduce

**Problem 1 (stuck invite):**
1. In the `_meta` org settings, add a domain → org mapping rule (e.g. `domain4.com` → target org, base role Editor).
2. As an org admin, invite the same email (`qa1@domain4.com`) to that org.
3. Have that user sign in for the first time (new user via SSO).
4. The rule auto-adds them (active Editor member row appears).
5. Open the org's Users list → the same email also appears as a separate **Invited** row that never clears; accepting the invite does nothing.

**Problem 2 (capitalisation mismatch):**
1. In `_meta` settings, add a mapping for domain `acme.com` (stored lowercase by the UI).
2. Have a new user sign in whose email domain arrives capitalised, e.g. `alice@ACME.com`.
3. The rule doesn't apply — the user gets a default empty org instead of joining the mapped org, and no error is shown.

**Problem 3 (whitespace in domain):**
1. `POST /api/_meta/settings` with `domain_org_mappings` containing a domain that has stray spaces, e.g. `{ "domain": " acme.com", "org_id": "<valid org>", "base_role": "viewer" }`.
2. The API returns `200` and stores the domain with the space (confirmed on alpha).
3. A new user `alice@acme.com` signs in → the rule never matches, so auto-join silently does nothing.

**Problem 4 (empty domain):**
1. `POST /api/_meta/settings` with a mapping whose `domain` is `""` and a valid `org_id`/`base_role`.
2. The API returns `200` and stores the empty-domain rule (confirmed on alpha) — the UI would have rejected it.

### Environment Details

```yaml
Version: Unknown
Edition: Example
OS: macOS
Browser: Chrome
```

### Which OpenObserve Functionalities Are Affected?

- [x] Home & Login
- [x] IAM & Management
- [x] UI / Styling

