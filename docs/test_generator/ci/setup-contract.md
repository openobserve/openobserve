# Test Setup Contract: Workflow Folders (area: Workflows)

> These specs are enterprise-only. They run ONLY in the ENT playwright matrix
> (`ci_matrix.ent.json` `Workflows` shard), where `O2_WORKFLOWS_ENABLED=true` is pinned.
> There is NO runtime availability skip: if `GET /api/{org}/workflows` answers 403/404 the
> whole file fails loudly in `beforeEach` (`pm.workflowsPage.assertEnabled()`), never silently green.

## Streams / data the spec must establish

Workflow Folders has **no stream/ingest dependency** — every fixture is a **folder** and a
**workflow**, seeded through the REST API (not built on the canvas, which would require a live
destination the SSRF guard refuses on `*.common-dev`). All fixtures are namespaced
`wf_auto_fld_*` and torn down in `afterAll`.

| Item | Scope | Fields / shape | Why |
|------|-------|----------------|-----|
| pipeline destination `wf_auto_fld_dest_<RUN>` | `[shared/read-only]` (file-level `beforeAll`) | `{name, url:"http://example.com/sink", method:"post", type:"http"}` | every seeded workflow's destination node must reference a real destination_id |
| folder A `wf_auto_fld_a_<RUN>` | `[shared/read-only]` (file-level `beforeAll`) | `{name, description}` → `folderId` | primary move source / search-scope fixture |
| folder B `wf_auto_fld_b_<RUN>` | `[shared/read-only]` (file-level `beforeAll`) | `{name, description}` → `folderId` | primary move destination |
| workflows (published) | `[per-test]` | trigger node + destination node wired, `enabled:true`, `folder=<folderId>` | listing/scoping/moving assertions |
| draft workflow | `[per-test: WFF-UI-13]` | same graph, `?draft=true`, `folder=<folderId>` | draft tag + move-unavailable assertions |
| doomed folder `wf_auto_fld_del_<RUN>` | `[per-test: WFF-UI-10]` | created inline, workflow seeded into it | non-empty-folder delete-guard assertion |

### Naming note (bites the Engineer/Healer)
The backend **lowercases and trims** the workflow name on save. The seed returns the normalized
name (`{ id, name: name.trim().toLowerCase() }`) and every row data-test is keyed by that
normalized name. Use `seedWorkflow(...).name` (the return value), never the raw input string.

## How to create it (copy these EXACT patterns — do NOT invent setup)

All helpers already exist in `tests/ui-testing/pages/workflowsPages/workflowFolderSeed.js`. The
spec (`tests/ui-testing/playwright-tests/Workflows/workflows-folders.spec.js`) already wires them;
a generated/refactored spec must keep the same calls.

- **Folder:** `seed.createFolder(page, name)` → POST `/api/v2/{org}/folders/workflows`
  (`workflowFolderSeed.js:23-30`). Returns `folderId`.
- **Destination:** `seed.createPipelineDestination(page, name)` → POST
  `/api/{org}/alerts/destinations?module=pipeline` (`workflowFolderSeed.js:39-51`). URL is
  `http://example.com/sink` (IANA-reserved, never contacted; NOT loopback — SSRF guard rejects
  private/localhost at save time).
- **Workflow (published):** `seed.createWorkflow(page, { name, destName, folderId })` →
  POST `/api/{org}/workflows?folder=<id>` (`workflowFolderSeed.js:93-104`). The graph is a
  two-node trigger→destination edge (never fired).
- **Draft:** same call with `draft: true` → `?draft=true&folder=<id>`.
- **List:** `seed.listWorkflows(page, { folder })` → GET `/api/{org}/workflows?folder=<id>`
  (`workflowFolderSeed.js:113-121`). Normalizes `body | body.list | body.data`.
- **Teardown:** `seed.purgeFolder(page, folderId)` (deletes workflows then folder,
  `workflowFolderSeed.js:125-130`) + `seed.deleteWorkflow` / `seed.deleteDestination`. A folder
  holding a workflow/draft REFUSES to delete, so purge before delete — otherwise a failed test
  leaks the folder permanently.

### Auth / org
- `getOrgIdentifier()` and `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`. Seeding uses `page.request` (shares the
  browser context cookies → works on cloud OIDC and self-hosted Basic auth alike).
- **Do NOT call `navigateToBase()` in the seeding `beforeAll`** — it attaches `page.waitHelpers`
  to the fixture-provided page, which a raw `browser.newPage()` lacks. Seed on a raw `newPage()`.

### Timing / readiness
- List readiness: `pm.workflowFoldersPage.goToList(folderId)` → `waitForListReady()` waits for
  `workflows-list-page` visible + `text=Loading data` detached (45s timeout — the list GET is slow).
- Folder-store hydration: `expectFolderTabVisible(name)` polls `resolveFolderIdByName` (store
  `foldersByType.workflows`) until the id resolves, THEN asserts the tab visible. Do not assert a
  folder tab before the store populates.

## Preconditions / toggles
- `O2_WORKFLOWS_ENABLED=true` on the build under test (route guard + `assertEnabled`).
- No SQL-mode / quick-mode toggle relevant to this feature.
- Folder rail uses `type="workflows"`; `showFavorites` is false → there is NO "Favorites"
  pseudo-folder under Workflows.

## Gotchas (so the Healer/Engineer don't rediscover them)
1. **`data-test` prefix is NOT a typo.** The rail/add/move dialogs are the SHARED components
   (`FolderList`/`AddFolder`/`MoveAcrossFolders`), so they still answer to `dashboard-*` /
   `move-across-folders-*`. Only the list-side and editor-side selectors are `workflow-*`. Do not
   "fix" the dashboard-prefixed names.
2. **OInput/OSelect/OInlineEdit put the consumer `data-test` on a NON-interactive wrapper.** The
   real control is `-field` (input), `-trigger` (select trigger), `-value`/`-input` (inline edit),
   `-option` (select options, stamped with `data-test-value`). Filling the wrapper is a silent no-op.
3. **Move dialog's outer `data-test` is the consumer's override.** `WorkflowsList` passes
   `data-test="workflow-move-to-another-folder-dialog"` which overrides `MoveAcrossFolders`'s inner
   `move-across-folders-dialog` via attr inheritance.
4. **Move destination OSelect is NOT searchable and virtualizes options.** Page down (`PageDown`)
   until the target option renders; waiting on an off-screen option never appears.
5. **Editor folder picker IS searchable.** Filter by name first (`inline-select-folder-dropdown-search`)
   to collapse the virtualized list, then click the option.
6. **Folder tabs key on folderId, not display name** — resolve id via the store, never via role/text.
7. **Move submit stays disabled while destination == source**, and the destination picker starts
   BLANK (source excluded). `expectMoveDisabled()` before picking, `expectMoveEnabled()` after.
8. **Cold-load folder resolution:** the editor lists ALL folders and adopts `wf.folder_id`, so a
   deep-link/reload on a non-default folder no longer "not found"s. Assert via
   `expectEditorNameContains` after `reloadCurrentUrl()`.
9. **Draft rows render no move button** (`v-if="!row.is_draft"`) → assert `toHaveCount(0)`, not
   disabled. The row anchor is the **view** button (unconditional); never anchor on move/pause.
