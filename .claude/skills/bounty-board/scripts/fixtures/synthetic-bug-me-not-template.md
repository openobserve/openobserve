### Bug Description

The alert list page has two problems; this is a checklist of the problems found.

- [ ] **`P2` · Saving an alert twice creates a duplicate.** Clicking Save quickly twice adds the same alert two times to the list.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  **Where:** `web/src/components/alerts/AddAlert.vue` → `onSubmit()` and `web/src/services/alerts.ts` → `create()`; the submit handler does not disable the button while the request is in flight.

  **Proposed fix:** set `isSubmitting` before the request and return early while it is true; reset it in `finally`. The same guard exists in `web/src/components/pipeline/AddPipeline.vue`.

  **How to verify:** add a vitest case in `AddAlert.spec.ts` that calls submit twice and expects one `create()` call.
  </details>

- [ ] **`P3` · The folder name is cut off.** Long folder names are truncated with no tooltip.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  **Where:** `web/src/components/alerts/FolderList.vue` → `render`; the label has `overflow: hidden` and no title.

  **Proposed fix:** add a `title` binding with the full name.

  **How to verify:** hover a 100-character folder name and see the full name.
  </details>

_A screenshot/recording demonstrating this is available and will be attached to this issue._

### Priority

P2 - Medium

### Severity

Minor
