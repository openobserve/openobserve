### Bug Description

Second round of testing on the **domain-based org mapping** feature (cloud), against the newly deployed build on alpha. The problems reported in #14695 are **confirmed fixed** in this build — the phantom "Invited" row is gone (a pending invite is now consumed automatically when someone is auto-joined), and a person who already had an account before the mapping existed **can** now be invited and onboarded. The items below are the **new** problems found, grouped by priority.

#### P1

- [ ] **A brand-new person can be left with no organization at all.** If a domain rule points at an organization that has since been deleted, the next matching person to sign in is "added" to that dead organization — so the normal fallback that would have given them their own workspace is skipped. They land in the app with **zero organizations** and nothing works. Logging out and back in quietly fixes it, but nobody would know to do that, and they never reach the organization they were supposed to join.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  Verified on alpha: created a throwaway org, mapped `domain3.com` to it, deleted the org (`DELETE /api/{org}/organizations` → *"Organization deletion initiated"*), then signed in a fresh `qa1@domain3.com`.
  - Login callback returned `new_user_login=false` → the mapping reported success, so the default-org fallback in `check_and_add_to_org` never ran.
  - `GET /api/organizations` → `{"data":[]}` — **zero orgs**.
  - `GET /api/{deletedOrg}/users` → `403 "Organization is deleted"`.
  - A **second** login self-heals: `is_new_user` is now false, the mapping is skipped, the org list is empty, so a personal `default` org is finally created.

  - **Where:** `process_domain_org_mapping` / `check_and_add_to_org` in `src/api/common/src/auth/jwt.rs`. The org is validated when the mapping is **saved**, never re-checked when it is **applied**. Same class as the deleted-group item below.
  - **Proposed fix:** before auto-joining, confirm the target org still exists and is not deleted/blocked; if it isn't, skip the mapping and fall through to the normal new-user path (and log it).
  </details>

- [ ] **A rule can be saved pointing at an organization that no longer exists.** Creating a brand-new domain rule that targets an already-deleted organization is accepted without complaint, so a rule can be broken from the moment it is created — and anyone matching it then hits the problem above.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  Verified on alpha: after deleting the target org, `POST /api/_meta/settings` with `domain_org_mappings: [{ domain: "domain3.com", org_id: "<deleted org id>", ... }]` returned `200` and stored the rule. The existing rule also kept pointing at the deleted org after the deletion, with no warning.

  - **Where:** the org existence check in `src/api/management/src/request/organization/settings.rs` passes for an org in a deleted/pending-deletion state.
  - **Proposed fix:** reject mappings whose target org is deleted or pending deletion, and warn (or clear the reference) when an org referenced by a mapping is deleted. Together with the item above this is one root cause: references are validated at save time but never re-checked at apply time.
  </details>

#### P2

- [ ] **A person can end up in a user group that admins cannot see or remove.** If a domain rule points at a user group and that group is later deleted, the next person who auto-joins is still placed into the deleted group. The organization's group list shows no groups at all, yet the person is a member of one — so an admin has no way to see it or take them out of it.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  Verified on alpha (org `<org-id>`): after deleting group `probe_grp` while a mapping still referenced it, signing in `qa1@domain2.com` produced:
  - `GET /api/{org}/groups` → `[]` (admin-visible list is empty)
  - `GET /api/{org}/groups/probe_grp` → `200` `{"name":"probe_grp","users":["qa1@domain2.com"],"roles":[]}`
  - `GET /api/{org}/users/qa1@domain2.com/groups` → `["probe_grp"]`

  The user is otherwise added correctly (viewer, right org, no personal org) — only the group handling is wrong. Today the resurrected group carries `roles: []`, so no extra permission is granted, but if a group of that name is later recreated with roles attached the user would silently inherit them.

  - **Where:** `process_domain_org_mapping` in `src/api/common/src/auth/jwt.rs` calls `update_group(org, group, {user})` without checking the group still exists. Group existence is validated only at **save** time in `src/api/management/src/request/organization/settings.rs`, never at **apply** time.
  - **Proposed fix:** verify the group still exists before calling `update_group` at auto-join (skip and log if it's gone), and/or make `update_group` refuse to create a group that isn't a listed org group.
  - Still reproducible on alpha as evidence: org `test_autostore`, group `probe_grp`, user `qa1@domain2.com`.
  </details>

- [ ] **Rejecting an invitation drops the person into a completely empty app.** When someone declines an invitation, the rejection itself works — but they are immediately left with **no organization and a blank workspace**: no content, no prompt, no guidance, just the empty navigation. Nothing tells them what to do. Logging out and back in quietly fixes it (they get their own workspace), but a real person would reasonably assume the product is broken.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  Verified on alpha with no domain rules configured at all (so nothing else could interfere). A brand-new `qa1@domain1.com` was invited to `test_autostore` as editor, signed in, and declined via the confirm dialog *"Are you sure you want to reject the invitation to join test_autostore?"*.

  - Rejection is correct in itself: invite removed (`GET /api/invites` → `0`), and the user is **not** added to the org.
  - **Immediately after rejecting:** `GET /api/organizations` → `{"data":[]}` — zero orgs, `main` renders empty, no dialog, no prompt.
  - **After logging out and back in:** a personal `default` org is created and the app renders normally.

  Cause: when a new user has a pending invite, default-org creation is deliberately skipped (there is an explicit early return for the pending-invite case in `check_and_add_to_org`, `src/api/common/src/auth/jwt.rs`). Rejecting clears the invite, but nothing re-runs that fallback in the **current** session — it only happens on the next login.

  This is the **same root cause shape as the first P1 item**: an early return skips the default-org fallback and leaves the person with zero organizations until a second login silently repairs it.

  - **Proposed fix:** on rejection, provision the personal organization (or route them into the onboarding prompt) straight away instead of waiting for a re-login. More generally, never leave a session in a zero-organization state — if a user ends up with no orgs, run the fallback at that point. One guard covers both this and the deleted-org P1.
  - Note: with a domain rule in place this cannot occur, because the rule auto-joins the person and consumes the invite, leaving nothing to reject.
  </details>

#### P3

- [ ] **Deleting a user group silently leaves domain rules pointing at it.** A group can be deleted even while a domain rule still references it. The delete succeeds with no warning, and the rule keeps naming the now-missing group, so the configuration looks valid but isn't.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  Verified on alpha: `DELETE /api/{org}/groups/probe_grp` returned `200`, and the `_meta` mapping still showed `user_group: "probe_grp"` afterwards. No warning at delete time and no revalidation of existing mappings. This is what directly enables the deleted-group item above.

  - **Proposed fix:** warn (or refuse) when deleting a group that is referenced by a domain→org mapping, or clear the reference from affected mappings as part of the delete.
  </details>

- [ ] **Saving the domain mapping settings without changing anything still performs a save.** On the domain → organization mapping screen, clicking **Save** when nothing has been edited still fires the save request and re-writes the settings. It should do nothing — the button should be inactive (or the save skipped) when there are no unsaved changes.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  The org-settings form submits the whole payload regardless of whether anything is dirty, so a no-op click produces a real write.

  Beyond the pointless request and audit noise, this carries a concrete risk: the settings save posts the **entire** `domain_org_mappings` array, so it is last-write-wins over the whole list. If another admin added or edited a rule since the page was loaded, an accidental "Save with no changes" silently overwrites their change with the stale list held in the browser.

  - **Proposed fix:** track the form's dirty state and disable **Save** (or short-circuit the request) when nothing has changed. Ideally also re-fetch before writing, or send only what changed, so a stale list cannot clobber a concurrent edit.
  </details>

_All items were reproduced live on alpha; no screenshot is attached (findings were verified via the UI and the API directly)._

### Priority

P1 - High

### Severity

Major

### Related Story/Issue

Follow-up to #14695 (round 1, closed — all 4 items fixed). Feature PR #14691; fix PR #14749.

### Is this a regression?

No — new findings on the current build.

### Steps to Reproduce

#### P1

**A brand-new person is left with no organization at all:**
1. Create a throwaway organization.
2. In `_meta` org settings, add a domain → organization mapping for `domain3.com` → that org.
3. Delete that organization.
4. Sign in a brand-new user `qa1@domain3.com`.
5. The user lands with **zero organizations** and an unusable app. Signing out and back in gives them a personal org instead.

**A rule can be saved pointing at an organization that no longer exists:**
1. Delete an organization that a mapping targets (or pick any already-deleted org id).
2. Save a new domain mapping pointing at that org id — it is accepted with `200`.
3. The pre-existing mapping also still points at the deleted org, with no warning.

#### P2

**A person ends up in a user group that admins cannot see:**
1. In the target org, create a user group named `probe_grp`.
2. In `_meta` org settings, add a mapping for `domain2.com` → that org, base role Viewer, User group = `probe_grp` (it saves, because the group exists).
3. Delete the user group `probe_grp`.
4. Sign in a brand-new user `qa1@domain2.com`.
5. The user is added as Viewer, but is also placed into the deleted group — the org's group list is empty while the user's groups show `probe_grp`.

**Rejecting an invitation leaves the person in an empty app:**
1. Ensure no domain mapping exists for the test domain (so the rule cannot interfere).
2. Invite a brand-new user (e.g. `qa1@domain1.com`) to an organization.
3. Sign in as that user — the invitation screen appears and they have no organization yet (expected while an invite is pending).
4. Click **Reject**, then confirm in the dialog.
5. Observe: the invitation is correctly removed and they are not added to the org — but they are left with **zero organizations and a blank workspace**, with no prompt or guidance.
6. Log out and back in — only then is a personal organization created and the app usable.

#### P3

**Deleting a user group leaves domain rules dangling:**
1. Create a group, reference it from a domain mapping, then delete the group.
2. The delete succeeds silently and the mapping still lists the deleted group name.

**Saving with no changes still performs a save:**
1. Open `_meta` org settings → the domain → organization mappings section.
2. Without editing anything, click **Save**.
3. With the browser network tab open, observe the settings save request is still sent and the settings are re-written, instead of the action being a no-op.

### Environment Details

```yaml
Version: Unknown
Edition: Example
Environment: test.example.com
OS: macOS
Browser: Chrome
```

### Which OpenObserve Functionalities Are Affected?

- [x] Home & Login
- [x] IAM & Management
- [x] UI / Styling

