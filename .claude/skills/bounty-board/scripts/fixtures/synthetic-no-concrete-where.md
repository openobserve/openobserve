### Bug Description

Synthetic fixture: one item whose Where names a component in prose but no file path.

- [ ] **`P3` · The two dashboard tabs use different font sizes.** The active tab label renders smaller than the inactive one, so the pair looks mismatched.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  **Where:** the tab toggle component on the dashboard header; the active and inactive states apply different `font-size` values.

  **Proposed fix:** set a single shared `font-size` on both tab labels so the states differ only in color.
  </details>

### Priority

P3 - Low

### Steps to Reproduce

1. Open a dashboard.
2. Compare the two tab labels.
