### Bug Description

The RUM error detail page loads the error with `select * from _rumdata where type='error' and _timestamp=?`. Quick mode reduces `select *` to the first `ZO_QUICK_MODE_NUM_FIELDS` schema fields plus the columns the query names, so once `_rumdata` grows past that cutoff the page stops receiving `service`, `version`, `session_id` and `view_url` — it names none of them.

Consequences:

- **Pretty tab**: `PrettyStackTrace.vue` only adds `service` to the translate payload when it is truthy, so the request goes out unscoped. The backend then falls back to a filename-only match — intentional lenient behaviour, so errors/uploads that don't set these fields still resolve — and when two services share a minified filename it can answer with a **different** service's sourcemap.
- **Breadcrumbs / session replay**: both key on `session_id`, which is missing for the same reason.

**Not a security / RBAC issue** — sourcemaps are org-scoped and access is all-or-none (there is no per-service permission). The wrong-source outcome also needs a filename collision, which content-hashed bundler output usually avoids.

### Root cause (backend, `select *` field reduction)

- `ZO_QUICK_MODE_FORCE_ENABLED` defaults to **true** (`src/config/src/config.rs:2561`), and `src/search/src/sql/mod.rs:221` ORs it with the request's own flag — so quick mode applies to every request regardless of what the client sends.
- `generate_quick_mode_fields` (`src/search/src/sql/schema.rs:130`) keeps the first `ZO_QUICK_MODE_NUM_FIELDS` fields, the columns the query references, FTS fields, and the (previously empty) `ZO_FEATURE_QUICK_MODE_FIELDS` list.
- Truncation only starts once the schema exceeds the cutoff (`schema.fields().len() > quick_mode_num_fields`), which is why this surfaced abruptly rather than on a code change.

Evidence from the failing `e2e / RUM` run (Playwright trace of run 33608206016):

- translate request body: `{"stacktrace":"...","env":"e2e"}` — `env` present, `service` and `version` absent, so the detail was loaded and simply did not carry those fields;
- the detail search response contained **16 fields**, without `service`/`version`/`session_id`;
- the errors-list query in the same session, which names `max(service) AS service`, got `service` back.

The backend `get_sourcemap_file` (`src/infra/src/table/source_maps.rs:214`) deliberately drops absent `service`/`env`/`version` filters (graceful degradation). This is intended and should **not** change — requiring an exact `IS NULL` match would regress the legitimate "RUM error without a configured service" case.

> **Superseded:** this issue originally described the cause as the Pretty tab translating before the error detail had loaded. The trace disproves that — `env` arrives from the same object in the same request. No frontend timing change is needed.

### Priority

P2 - Medium

### Severity

Minor

### Related Story/Issue

Surfaced by the e2e deflake PR #14113 (`e2e / RUM` shard) and test `tests/ui-testing/playwright-tests/RUM/sourcemap-upload-pretty.spec.js`.

### Is this a regression?

No — long-standing behaviour that starts biting when a stream's field count crosses `ZO_QUICK_MODE_NUM_FIELDS` (CI runs with 100, the default is 500).

### Steps to Reproduce

1. Ingest RUM errors until `_rumdata` has more fields than `ZO_QUICK_MODE_NUM_FIELDS`, with `service` positioned past the cutoff.
2. Open any error detail page and watch `POST /api/<org>/sourcemaps/stacktrace` — the payload carries no `service`.
3. With two services sharing a minified filename, one mapped and one not, the unmapped service's Pretty tab renders the other service's source instead of "Source Maps Not Available".

### Proposed fix

- **Backend (done in #14113):** default `ZO_FEATURE_QUICK_MODE_FIELDS` to `service,version,session_id,view_url`. The list is already applied after truncation and only adds a field the stream actually has, which is the mechanism other built-in fields use. Backend fuzzy fallback stays as-is.
- **Test note (done):** the e2e fixtures shared one filename across services, manufacturing a collision production wouldn't have; the unmapped-service and delete-flow fixtures now use their own filenames.

### Which OpenObserve Functionalities Are Affected?

- [x] Real User Monitoring (RUM)

