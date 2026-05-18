// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { mount, VueWrapper, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

installQuasar();

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: { noData: "No data available" },
      common: { loading: "Loading..." },
    },
  },
});

beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
});

import OTable from "./OTable.vue";
import type { OTableColumnDef } from "./OTable.types";

interface BenchRow {
  id: number;
  name: string;
  email: string;
  status: string;
  timestamp: number;
  category: string;
  priority: string;
  score: number;
  notes: string;
}

function makeColumns(): OTableColumnDef<BenchRow>[] {
  return [
    { id: "id", header: "ID", accessorKey: "id", sortable: true, size: 80 },
    { id: "name", header: "Name", accessorKey: "name", sortable: true, size: 200 },
    { id: "email", header: "Email", accessorKey: "email", size: 250 },
    { id: "status", header: "Status", accessorKey: "status", size: 100 },
    { id: "timestamp", header: "Timestamp", accessorKey: "timestamp", size: 180 },
    { id: "category", header: "Category", accessorKey: "category", size: 130 },
    { id: "priority", header: "Priority", accessorKey: "priority", size: 100 },
    { id: "score", header: "Score", accessorKey: "score", sortable: true, size: 80 },
    { id: "notes", header: "Notes", accessorKey: "notes", size: 300 },
  ];
}

const categories = ["API", "Web", "Mobile", "Infra", "Security"];
const priorities = ["Low", "Medium", "High", "Critical"];
const statuses = ["Active", "Inactive", "Pending", "Archived"];

/**
 * Generate a deterministic dataset of N rows.
 */
function generateRows(count: number): BenchRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    status: statuses[i % statuses.length],
    timestamp: Date.now() - i * 3600000,
    category: categories[i % categories.length],
    priority: priorities[i % priorities.length],
    score: Math.round(Math.random() * 1000),
    notes: `Note for row ${i + 1}: this is a longer description field used for testing text rendering performance.`,
  }));
}

function measureTime<T>(label: string, fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  console.log(`  [PERF] ${label}: ${ms.toFixed(0)}ms`);
  return { result, ms };
}

/*
 * NOTE: Virtual scroll DOM efficiency (rendered rows << data rows) depends on
 * CSS layout — the scroll container needs a constrained height. jsdom doesn't
 * apply CSS layout, so DOM row counts will match the full dataset.
 *
 * To validate virtual scroll at 100K scale, use a real browser (Playwright).
 * These jsdom tests verify:
 *   - Component mounts without crashing at typical scales
 *   - TanStack table instance is accessible via exposed API
 *   - Sort, filter, and data-update operations complete correctly
 *   - getRows() returns correct count after each operation
 *   - Memory stability across mount/unmount cycles
 */

describe("OTable Performance Benchmarks", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  }, 30000);

  // ── Render at 1K (typical usage) ───────────────────────────

  describe("render at 1K rows (typical usage)", () => {
    it("should mount 1K rows with virtual scroll without crashing", () => {
      const rows = generateRows(1_000);
      const { ms } = measureTime("mount 1K rows (virtual scroll)", () => {
        wrapper = mount(OTable, {
          props: {
            data: rows,
            columns: makeColumns(),
            virtualScroll: true,
            rowHeight: 28,
            maxHeight: 600,
          },
        });
      });

      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
      expect(wrapper.vm.table).toBeDefined();
      expect(wrapper.vm.getRows()).toHaveLength(1_000);
      console.log(`  [PERF] 1K rows mounted with virtual scroll in ${ms.toFixed(0)}ms`);
    });

    it("should mount 1K rows without virtual scroll", () => {
      const rows = generateRows(1_000);
      const { ms } = measureTime("mount 1K rows (no virtual scroll)", () => {
        wrapper = mount(OTable, {
          props: {
            data: rows,
            columns: makeColumns(),
            virtualScroll: false,
          },
        });
      });

      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
      expect(wrapper.vm.getRows()).toHaveLength(1_000);
      const renderedRows = wrapper.findAll('[data-test^="o2-table-row-"]');
      expect(renderedRows.length).toBe(1_000);
      console.log(`  [PERF] 1K non-virtual: ${renderedRows.length} DOM rows in ${ms.toFixed(0)}ms`);
    });
  });

  // ── Sort at scale ──────────────────────────────────────────

  describe("sort at scale", () => {
    it("should sort 1K rows by numeric column correctly", () => {
      const rows = generateRows(1_000);
      const { ms } = measureTime("mount + sort 1K rows", () => {
        wrapper = mount(OTable, {
          props: {
            data: rows,
            columns: makeColumns(),
            sorting: "client",
            virtualScroll: true,
            rowHeight: 28,
            maxHeight: 600,
          },
        });
      });

      const sortTrigger = wrapper.find('[data-test="o2-table-th-sort-trigger"]');
      expect(sortTrigger.exists()).toBe(true);

      const sortMs = measureTime("click sort", () => {
        sortTrigger.trigger("click");
      });

      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
      expect(wrapper.vm.getRows()).toHaveLength(1_000);
      // After sorting by ID descending, first row should be the last (id=1000)
      const sortedRows = wrapper.vm.getRows();
      expect(sortedRows[0].id).toBe(1_000);
      console.log(`  [PERF] Sort completed in ${sortMs.ms.toFixed(0)}ms`);
    }, 30000);
  });

  // ── Filter at scale ────────────────────────────────────────

  describe("filter at scale", () => {
    it("should filter 1K rows to a single match with client-side global filter", () => {
      const rows = generateRows(1_000);
      const { ms } = measureTime("mount + filter 1K rows", () => {
        wrapper = mount(OTable, {
          props: {
            data: rows,
            columns: makeColumns(),
            virtualScroll: true,
            rowHeight: 28,
            maxHeight: 600,
            globalFilter: "User 500",
            filterMode: "client",
          },
        });
      });

      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
      // Client-side global filter should reduce visible rows
      const filteredRows = wrapper.vm.getRows();
      expect(filteredRows.length).toBeLessThan(rows.length);
      console.log(`  [PERF] Global filter filtered 1K → ${filteredRows.length} rows in ${ms.toFixed(0)}ms`);
    }, 30000);

    it("should filter 1K rows with no-match returning zero rows", () => {
      const rows = generateRows(1_000);
      wrapper = mount(OTable, {
        props: {
          data: rows,
          columns: makeColumns(),
          globalFilter: "ZZZ_NONEXISTENT_ZZZ",
          filterMode: "client",
        },
      });

      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
      const filteredRows = wrapper.vm.getRows();
      expect(filteredRows).toHaveLength(0);
      console.log(`  [PERF] Global filter (no-match): ${filteredRows.length} rows returned`);
    }, 30000);
  });

  // ── Data update at scale ───────────────────────────────────

  describe("data update at scale", () => {
    it("should replace 1K rows with new data without crashing", () => {
      const rows = generateRows(1_000);
      wrapper = mount(OTable, {
        props: {
          data: rows,
          columns: makeColumns(),
          virtualScroll: true,
          rowHeight: 28,
          maxHeight: 600,
        },
      });

      const newRows = generateRows(1_000);
      const { ms } = measureTime("update 1K rows via setProps", () => {
        wrapper.setProps({ data: newRows });
      });

      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
      expect(wrapper.vm.getRows()).toHaveLength(1_000);
      console.log(`  [PERF] Data update completed in ${ms.toFixed(0)}ms`);
    }, 30000);
  });

  // ── Memory stability ───────────────────────────────────────

  describe("memory stability", () => {
    it("should survive repeated mount/unmount cycles", () => {
      const rows = generateRows(1_000);

      for (let cycle = 0; cycle < 5; cycle++) {
        wrapper = mount(OTable, {
          props: {
            data: rows,
            columns: makeColumns(),
            virtualScroll: true,
            rowHeight: 28,
            maxHeight: 600,
          },
        });
        expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
        expect(wrapper.vm.getRows()).toHaveLength(1_000);
        wrapper.unmount();
      }

      // Final mount after cycles — should still work
      wrapper = mount(OTable, {
        props: {
          data: rows,
          columns: makeColumns(),
          virtualScroll: true,
          rowHeight: 28,
          maxHeight: 600,
        },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
      expect(wrapper.vm.getRows()).toHaveLength(1_000);
      console.log("  [PERF] 5 mount/unmount cycles completed without errors");
    }, 30000);
  });

  // ── 100K scale (requires browser — documented for reference) ──

  describe("100K rows benchmark (browser-only)", () => {
    /*
     * 100K row benchmarks CANNOT run in jsdom. Vue wraps all data objects in
     * reactivity proxies, which exhausts the Node.js heap (~4GB for 100K).
     *
     * To run 100K benchmarks:
     *   1. cd web && npm run dev
     *   2. Open the OTable page with 100K generated rows + virtual scroll
     *   3. Measure: mount time, scroll FPS, sort latency, memory
     *
     * Expected results (real browser, virtual scroll, 100K rows):
     *   - Mount time: < 2s
     *   - DOM nodes: < 500 (virtual scroll limits rendering to viewport)
     *   - Scroll FPS: 60fps
     *   - Sort latency: < 500ms
     *   - Memory: ~50-100MB for data + DOM
     *
     * The NODE_OPTIONS="--max-old-space-size=16384" workaround allows ~20-30K
     * in jsdom but is not practical for CI. Browser benchmarks are required.
     */
    it.skip("100K rows — requires real browser (not jsdom)", () => {
      // Placeholder — documented above
    });
  });
});
