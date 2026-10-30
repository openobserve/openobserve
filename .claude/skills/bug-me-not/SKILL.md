---
name: bug-me-not
description: File a well-structured bug in the right OpenObserve repo (openobserve, or the private repo when a private repo config sits next to this checkout) from a short description and an optional screenshot or recording. Matches the repo's issue template, writes the bug as a prioritised plain-English checklist with collapsed technical details, asks only for the fields you did not give, sets the issue type to Bug, labels it `bug-me-not`, and hands it to autofix triage. Use when the user says "bug-me-not", "file a bug", "raise an issue for this", or "log this bug".
---

# bug-me-not

Turns "this is broken" plus an optional screenshot or video into a GitHub issue that anyone can read at the top and an engineer can act on underneath. It runs as your own `gh` login and creates exactly one issue per run. Start the Claude session in your openobserve checkout: this skill and bounty-board live only in its `.claude/skills/`, so a session started in another checkout never loads them. Filing uses only `gh`, so it can still file in the private repo from there; triage of items whose fix is in private code needs the private checkout as a sibling of this one.

## Input

`[media_path] <description> [repo=openobserve|<private repo name>] [priority=P0|P1|P2|P3] [severity=Blocker|Major|Minor|Trivial] [regression=yes|no]`

Only `description` is required. Accept bare tokens (`private P2 Minor no`) or `key=value` pairs; `oss` means openobserve and `private` means the private repo. `media_path` is a screenshot (`.png`/`.jpg`) or recording (`.mov`/`.mp4`); if the user has a file open or selected in the IDE, use that. Remember which fields were given: you ask only for the rest. No description → ask for it first.

## Repos

Run `"<this checkout>/.claude/skills/bounty-board/scripts/checkouts.sh"`. It prints `openobserve=<path>` and, when a private repo config is found next to this checkout, `private=<path>` and `private_repo=<name>`. Then `cat "<private path>/.claude/bounty-board.private.json"` for the private repo's facts: `repo`, `bug_labels`, `issue_template`, `edition`, `file_here_when`. No config found → only openobserve is available; if the user asked for the private repo, say "no private-repo config found next to this checkout" and stop.

| Repo | Template | Bug label | Edition |
|---|---|---|---|
| `openobserve/openobserve` | `.github/ISSUE_TEMPLATE/bug-report-template-latest.yaml` | `☢️ Bug` | `OSS` |
| `openobserve/<config repo>` | config `issue_template`, read in the private checkout | first of config `bug_labels` that exists in the repo | config `edition` |

Every issue also gets `bug-me-not`, which is what sends it to autofix triage. Never copy anything from the private config into an openobserve issue.

GitHub Issue Type is a separate, org-level field, so the same ids work in every org repo: Bug `IT_kwDOBbbTCM4A9sV1`, Task `IT_kwDOBbbTCM4A9sVy`, Feature `IT_kwDOBbbTCM4A9sV4`. `gh issue create` has no `--type` flag, so the type is set with a GraphQL mutation after creation. If the ids stop working, re-fetch them:
`gh api graphql -f query='{ repository(owner:"openobserve", name:"openobserve"){ issueTypes(first:20){ nodes{ name id } } } }'`

`openobserve/openobserve` is public. Never put secrets, tokens, customer data, or internal hostnames in an openobserve issue. If a bug shows up in the open-source UI or flow but is caused by private code, file it in the private repo instead, so openobserve issues never name private paths.

**Security bugs are never filed as issues.** Anything that lets someone bypass auth or RBAC, read or change another org's or user's data, inject code or queries, leak secrets, or crash a server on purpose is a vulnerability: stop before filing, file nothing in any repo, and tell the user to report it privately as `SECURITY.md` says (GitHub → Security → "Report a vulnerability", or security@openobserve.ai). A public issue with **Where:** and **Proposed fix:** would be a disclosure with exploit pointers.

## Procedure

Shell variables do not survive between Bash tool calls, so commands below use placeholders (`<tmp>`, `<N>`, `<REPO>`, `<node id>`). Substitute literal values and absolute paths, and keep every path in double quotes (paths such as `Work Files` contain spaces).

**0. Preflight.** This skill is for OpenObserve team members. Run `gh api "orgs/openobserve/members/$(gh api user -q .login)" --silent`; a non-zero exit means the login is not an org member: stop, file nothing, and point the user to the repo's normal issue templates (https://github.com/openobserve/openobserve/issues/new/choose). Then run `checkouts.sh` and read the private config as described under Repos.

**1. See the bug.** When media is given, verify it before filing; never file blind from the description alone.
- Screenshot: read it with the Read tool.
- Recording: copy it into a fresh temp directory (`mktemp -d`, referred to as `<tmp>` below) and extract frames there, then read the first, a couple of middle, and the last frame:
  ```bash
  ffmpeg -hide_banner -loglevel error -i "<tmp>/bug_media.mov" -vf fps=2 "<tmp>/f_%03d.png"
  ```
  macOS screen-recording names can contain non-standard space characters that make a fully quoted path fail with "No such file or directory". Copy via a glob instead (`cp "<media dir>"/Screen\ Recording*PREFIX*.mov "<tmp>/bug_media.mov"`). If `ffmpeg` is missing, say so and ask the user to describe what the recording shows.
- If the media does not show the reported behaviour, say so and ask before filing.

State in one line what you observed. Without media, say the bug was not visually verified.

**2. Pick the repo.** Suggest one from the feature area, leaning toward where the code lives: the private repo when the area matches its config `file_here_when` list or the code you find in step 4 lives in the private checkout; otherwise openobserve (logs, metrics, traces, dashboards, alerts, pipelines, streams, ingestion, RUM, reports, general UI and styling). Without a private config, the answer is always openobserve.

Never file before the repo is confirmed (step 3), unless the user named it.

**3. Ask only for what is missing.** One `AskUserQuestion` call, only for fields the user did not pass:
1. Target repo, your pick first, marked "(Recommended)". Asked unless the user named the repo or only openobserve is available.
2. Priority: `P0 - Critical`, `P1 - High`, `P2 - Medium`, `P3 - Low` (suggest P2 for a UI or cosmetic bug).
3. Severity: `Blocker`, `Major`, `Minor`, `Trivial` (suggest Minor for a UI or cosmetic bug).
4. Is this a regression?: `No` / `Yes` (default No unless the user said it used to work).

If everything was given, skip this step.

Pick the affected-functionality checkboxes yourself, never ask: the functional area, plus `UI / Styling` when the bug is visible in the UI. Use the chosen template's exact option labels, read from the template file itself (the `affected-functionalities` checkboxes). openobserve's are: Home & Login · Logs / Metrics / Traces · Dashboards · Alerts · Streams, Pipelines & Functions · Ingestion · Real User Monitoring (RUM) · Reports · IAM & Management · UI / Styling · Unknown / Other. The private template has its own list; never mix the two.

**4. Find the code.** For each problem, locate where it happens in the current checkout of the target repo (grep / read, read-only): the file, the function, the mechanism. This feeds the `Where:` line, and it is what autofix triage checks the item against later. If you cannot find it, write what you know and say "not located" rather than guessing a path.

**5. Write the body.** Templates drift; read the chosen repo's live template and follow its labels if they changed. Headings below match the templates as of October 2026.

The Bug Description is always a checklist, even for one problem:
- Each item's visible line is plain English: what the user sees. No code identifiers, paths, function names, or jargon there.
- Prefix each item with its own priority, `` `P0` `` to `` `P3` ``, then ` · `. Judge each item on its own; items in one issue can differ. Order most severe first. The top-level `### Priority` is the highest among the items.
- Priority rubric: **P0** data loss or a whole feature unusable (a security bug never gets here, see above); **P1** core path broken with no reasonable workaround; **P2** real bug with a workaround or limited blast radius; **P3** minor, cosmetic, or edge case. Only P2/P3 items are ever considered for autofix, so do not downgrade an item to get it fixed.
- Under each item, a collapsed `<details>` block with exactly three parts: **Where:** list EVERY repo-relative file path the fix touches (backticked) + function names (`` `web/src/components/Foo.vue` → `onSave()` ``) and the mechanism — autofix triage declines items touching more than 3 files, so completeness matters; **Proposed fix:** the concrete change; **How to verify:** one line, the check or unit test that proves the fix.
- Markdown gotchas: a blank line after `<summary>…</summary>` so the inner markdown renders, and the whole `<details>` block indented 2 spaces so it stays inside the list item.
- Refer to other items as "item N", never `#N` (that links an issue).

````markdown
### Bug Description

<One plain-English sentence naming the feature/area and saying this is a checklist of the problems found.>

- [ ] **`P<n>` · <Plain-English problem title>.** <1–2 sentences on the symptom the user sees.>

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  **Where:** `<repo-relative/path>` → `<function()>`; <the mechanism>.

  **Proposed fix:** <the concrete change>.

  **How to verify:** <one line>.
  </details>

- [ ] **`P<n>` · <next problem, same shape>** …

<Only when media was given:> _A screenshot/recording demonstrating this is available and will be attached to this issue._

### Priority

<P0 - Critical | P1 - High | P2 - Medium | P3 - Low>

### Severity

<Blocker | Major | Minor | Trivial>

### Related Story/Issue

<#1234 or URL if the user named one, else Not Available>

### Is this a regression?

<Yes | No>

### Steps to Reproduce (Optional)

1. <numbered, concrete steps that lead to the bug>

### Environment Details

```yaml
Version: <from the About page if visible, else Unknown>
Edition: <the repo's edition from the table above>
Environment: <env or URL if visible, else omit the line>
OS: <if known, else Unknown>
Browser: <if known, else Unknown>
```

### Which OpenObserve Functionalities Are Affected?

- [x] <area>
- [x] UI / Styling
````

Stay grounded in what you saw and what the code says. Never invent versions, commits, or environments.

**6. File, set the type, triage.**

a. Write the body with the Write tool to `<tmp>/body.md` in a fresh temp directory and create the issue. Text you or the user wrote never goes into a double-quoted argument, where backticks and `$(...)` would execute: the title goes in single quotes, with any `'` in it written as `'\''`, and the body only via `--body-file`. Title: area first, then the symptom, e.g. `IAM Roles > Users: info (ⓘ) icon next to user name does nothing on hover or click`.
```bash
gh issue create --repo 'openobserve/<REPO>' \
  --title '<title>' --label '<bug label>' --label 'bug-me-not' --body-file "<tmp>/body.md"
```
For the private repo, pick `<bug label>` by trying config `bug_labels` in order and using the first that exists (`gh label list --repo 'openobserve/<REPO>' --limit 300`). If create still fails with "label not found" for the bug label, retry without it but keep `--label 'bug-me-not'`. Only if `bug-me-not` itself is missing, retry with no labels and tell the user the issue will not reach autofix triage.

b. Set Issue Type = Bug: take `<N>` from the issue URL, run the first call, then paste the node id it prints into the second.
```bash
gh api graphql -f query='{ repository(owner:"openobserve", name:"<REPO>"){ issue(number:<N>){ id } } }' --jq '.data.repository.issue.id'
gh api graphql -f query='mutation { updateIssue(input:{id:"<node id>", issueTypeId:"IT_kwDOBbbTCM4A9sV1"}){ issue{ number issueType{name} } } }'
```
Confirm the response shows `issueType.name == "Bug"`. Repo automation may already have set it; setting it again is safe.

c. Run autofix triage on the new issue: follow `/bounty-board triage <REPO> <N>` (`.claude/skills/bounty-board/SKILL.md`), where `<REPO>` is `openobserve` or the private repo name from the config. Run it for every filed issue, including one whose items are all P0/P1: triage then declines them all and the issue gets `autofix-declined` and the standard verdict comment, so every `bug-me-not` issue ends up in the same state. Triage shows its comment and asks before posting. If the bounty-board skill is not present in this checkout (`git pull` main), say so and leave the issue untriaged; never fix anything from here.

**7. Report.**
- The issue URL.
- One line on what you verified from the media, or that it was text-only.
- Repo, priority, severity, regression, affected areas.
- The triage outcome: posted (accepted items or declined), skipped by the user, or not run and why.
- Media: `gh` cannot upload images or videos. Give the original media path and ask the user to drag it into the issue. Offer `open <media>` and `gh issue view <N> --repo 'openobserve/<REPO>' --web` so both are ready side by side.

## Rules

- Never close an issue, and never tick an issue's checkboxes; those are for whoever fixes the item.
- One issue per run. Several problems in the same area go in one checklist; unrelated problems are separate runs.
- Never create or rename labels unless the user asks.
