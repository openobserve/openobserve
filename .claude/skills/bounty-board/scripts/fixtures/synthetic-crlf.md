### Bug Description

Synthetic fixture: a ticked item, a How-to-verify label, CRLF-free.

- [x] **`P2` · Already handled item.** Was fixed by hand.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  **Where:** `web/src/components/Foo.vue` — `onSave`.

  **Proposed fix:** guard against a null row.
  </details>

- [ ] **`P3` · Tooltip text is cut off.** The tooltip truncates long names.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  **Where:** `web/src/components/shared/Tip.vue:42` and acme_ext/src/search/mod.rs (the `web/src/components/iam/` folder and `src/service/users` are context only).

  **Proposed fix:** add `white-space: normal` to the tooltip body.

  **How to verify:** hover a 120-char name and see it wrap.
  </details>

- [ ] **`P0` · Data loss.** Everything breaks.

### Priority

P0 - Critical

- [ ] **`P2` · Not an item.** Outside the Bug Description section.
