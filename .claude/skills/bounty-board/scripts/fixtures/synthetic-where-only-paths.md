### Bug Description

- [ ] **`P3` · Legend overlaps the chart.** The legend covers the last bar.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  **Where:** `web/src/components/dashboards/Legend.vue` — `layout()`.

  **Proposed fix:** reserve the legend height before drawing; `web/src/utils/dashboard/convertSQLData.ts` shows the same pattern.

  **How to verify:** render a 20-series bar chart and see the last bar uncovered.
  </details>

- [ ] **`P2` · Old-style item without a Where label.** Context only.

  <details>
  <summary>🔧 Technical details &amp; proposed fix</summary>

  The bug sits in `web/src/components/Old.vue`.

  **Proposed fix:** guard the null.
  </details>
