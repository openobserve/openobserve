// @vitest-environment jsdom
import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import type { QualityRow } from "../utils/qualityFormat";
import {
  matchesTileFilter,
  qualityTiles,
  type QualityTileFilter,
} from "../composables/useQualityList";
import QualityConfigsTable from "./QualityConfigsTable.vue";

const { push } = vi.hoisted(() => ({ push: vi.fn(() => Promise.resolve()) }));

vi.mock("vue-router", () => ({
  useRoute: () => ({ name: "aiEvaluations", query: { tab: "quality" } }),
  useRouter: () => ({ push, resolve: () => ({ href: "/web/ai/evaluations" }) }),
}));

// Renders every cell slot inside a clickable row, like OTable, so a stopped click stays in its cell.
const OTableStub = defineComponent({
  name: "OTable",
  props: {
    data: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
  },
  emits: ["row-click"],
  template: `
    <div>
      <slot name="subheader" />
      <slot name="toolbar" />
      <div
        v-for="row in data"
        :key="row.configId"
        :data-test="'row-' + row.configId"
        @click="$emit('row-click', row)"
      >
        <template v-for="column in columns" :key="column.id">
          <slot :name="'cell-' + column.id" :row="row" />
        </template>
      </div>
      <slot v-if="!data.length" name="empty" />
    </div>
  `,
});

function row(overrides: Partial<QualityRow>): QualityRow {
  return {
    configId: "id",
    name: "name",
    dataType: "numeric",
    status: "healthy",
    total: 10,
    unhealthy: 0,
    average: 0.5,
    lastScoredAt: null,
    scopeCounts: { span: 0, trace: 10, session: 0 },
    topValue: null,
    description: "",
    version: 1,
    thresholdLabel: "",
    range: { min: 0, max: 1 },
    ...overrides,
  };
}

const ROWS: QualityRow[] = [
  row({
    configId: "ins",
    name: "instruction_following",
    dataType: "categorical",
    status: "attention",
    total: 37,
    unhealthy: 35,
    average: null,
    topValue: { key: "medium", count: 18 },
    thresholdLabel: "high",
    description: "Follows the instructions",
  }),
  row({ configId: "hal", name: "hallucination", status: "healthy", thresholdLabel: "≤ 0.2" }),
  row({ configId: "con", name: "conciseness", status: "unset", unhealthy: null }),
  row({
    configId: "gro",
    name: "groundedness_v2",
    status: "no_data",
    total: 0,
    average: null,
    scopeCounts: { span: 0, trace: 0, session: 0 },
  }),
];

// The sample list's 16 configs: 11 need attention, 1 healthy, 3 have no threshold, 1 got no scores.
const TILES = qualityTiles([
  ...Array.from({ length: 11 }, (_, i) => row({ configId: `a${i}`, status: "attention" })),
  row({ configId: "h", status: "healthy" }),
  ...Array.from({ length: 3 }, (_, i) =>
    row({ configId: `u${i}`, status: "unset", unhealthy: null }),
  ),
  row({ configId: "n", status: "no_data", total: 0 }),
]);

const ALL_GIVE_A_RESULT = { ...TILES, withoutResult: 0, noScores: 0, noThreshold: 0 };

// The note spaces its parts with a flex gap, so the text has bare "·" separators.
const noteOf = (wrapper: { find: (selector: string) => { text: () => string } }) =>
  wrapper
    .find('[data-test="quality-tile-without-result-note"]')
    .text()
    .replace(/\s*·\s*/g, " · ");

function mountTable(props: Partial<InstanceType<typeof QualityConfigsTable>["$props"]> = {}) {
  return mount(QualityConfigsTable, {
    props: {
      rows: ROWS,
      tiles: TILES,
      failedRuns: 0,
      tileFilter: null,
      loading: false,
      forbidden: false,
      loadError: false,
      ...props,
    },
    global: {
      plugins: [store],
      stubs: { OTable: OTableStub, OEmptyState: true },
    },
  });
}

// Wires the tile filter like QualityPage does: the filter comes back as a prop and the rows narrow to it.
function mountWired() {
  const wrapper = mountTable({
    "onUpdate:tileFilter": (filter: QualityTileFilter | null) =>
      wrapper.setProps({
        tileFilter: filter,
        rows: filter ? ROWS.filter((current) => matchesTileFilter(current, filter)) : ROWS,
      }),
  });
  return wrapper;
}

const rowIds = (wrapper: ReturnType<typeof mountTable>) =>
  wrapper.findAll('[data-test^="row-"]').map((found) => found.attributes("data-test"));

describe("QualityConfigsTable", () => {
  it("shows the four statuses with the design labels and their rule line", () => {
    const text = mountTable().text();
    for (const label of ["Needs attention", "Healthy", "Threshold not set", "No score data"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("Healthy if high");
    expect(text).toContain("Healthy if ≤ 0.2");
    expect(text).toContain("Set a healthy threshold");
    expect(text).toContain("No scores in this window");
  });

  it("shows the typical score and the unhealthy count before the bold share", () => {
    const wrapper = mountTable();
    const ins = wrapper.find('[data-test="row-ins"]');
    expect(ins.text()).toContain("medium");
    expect(ins.text()).toContain("most common · 18 of 37");
    const unhealthy = wrapper.find('[data-test="quality-configs-unhealthy-ins"]');
    expect(unhealthy.text()).toMatch(/35 out of 37\s*94\.6%/);
    expect(wrapper.find('[data-test="row-hal"]').text()).toContain("average, 0 to 1");
    // No threshold or no scores: a dash instead of the button.
    expect(wrapper.find('[data-test="quality-configs-unhealthy-con"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="quality-configs-unhealthy-gro"]').exists()).toBe(false);
  });

  it("colours the Unhealthy bar green, orange or red by share, and keeps the text and its colours", () => {
    const wrapper = mountTable({
      rows: [
        row({ configId: "low", status: "healthy", total: 10, unhealthy: 2 }),
        row({ configId: "mid", status: "attention", total: 10, unhealthy: 5 }),
        row({ configId: "high", status: "attention", total: 10, unhealthy: 9 }),
        row({ configId: "none", status: "unset", total: 10, unhealthy: null }),
      ],
    });
    const fills = {
      low: "bg-progress-bar-success",
      mid: "bg-progress-bar-warning",
      high: "bg-progress-bar-danger",
    };
    for (const [id, fill] of Object.entries(fills)) {
      const cell = wrapper.find(`[data-test="quality-configs-unhealthy-${id}"]`);
      expect(cell.find('[role="progressbar"] > div').classes()).toContain(fill);
      for (const other of Object.values(fills).filter((value) => value !== fill)) {
        expect(cell.find(`.${other}`).exists()).toBe(false);
      }
    }
    const mid = wrapper.find('[data-test="quality-configs-unhealthy-mid"]');
    expect(mid.find(".text-text-secondary").text()).toBe("5 out of 10");
    expect(mid.find(".text-text-heading.font-semibold").text()).toBe("50.0%");
    expect(wrapper.find('[data-test="quality-configs-unhealthy-none"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="row-none"]').find('[role="progressbar"]').exists()).toBe(
      false,
    );
  });

  it("opens the detail from a row click, and with the unhealthy filter from the Unhealthy cell only", async () => {
    const wrapper = mountTable();
    await wrapper.find('[data-test="row-hal"]').trigger("click");
    expect(wrapper.emitted("open")).toEqual([[ROWS[1], "all"]]);
    await wrapper.find('[data-test="quality-configs-unhealthy-ins"]').trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [ROWS[1], "all"],
      [ROWS[0], "unhealthy"],
    ]);
  });

  it("highlights and filters from the attention tile, and clears on a second click, with no chip", async () => {
    const wrapper = mountWired();
    const tile = wrapper.find('[data-test="quality-tile-attention"]');
    expect(tile.text()).toMatch(/11\s*of 16/);
    expect(tile.attributes("aria-pressed")).toBe("false");
    expect(tile.classes()).toContain("border-border-default");

    await tile.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:tileFilter")).toEqual([["attention"]]);
    expect(tile.attributes("aria-pressed")).toBe("true");
    expect(tile.classes()).toContain("border-accent");
    expect(rowIds(wrapper)).toEqual(["row-ins"]);
    expect(wrapper.find('[data-test="quality-tile-chip"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="quality-configs-search"]').exists()).toBe(true);

    await tile.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:tileFilter")?.at(-1)).toEqual([null]);
    expect(tile.attributes("aria-pressed")).toBe("false");
    expect(tile.classes()).not.toContain("border-accent");
    expect(rowIds(wrapper)).toEqual(["row-ins", "row-hal", "row-con", "row-gro"]);
  });

  it("counts the configs without a result and names the non-zero reasons", () => {
    const tile = mountTable().find('[data-test="quality-tile-without-result"]');
    expect(tile.text()).toMatch(/4\s*of 16/);
    expect(tile.text()).toContain("Configs without a result");
    expect(noteOf(tile)).toBe("1 got no scores · 3 have no threshold");
    expect(tile.find(".text-icon-chip-warning-text").exists()).toBe(true);
    const onlyThreshold = mountTable({
      tiles: { ...TILES, withoutResult: 1, noScores: 0, noThreshold: 1 },
    });
    expect(noteOf(onlyThreshold)).toBe("1 has no threshold");
  });

  it("adds failed runs and the Eval Jobs link only when runs failed", () => {
    const failing = mountTable({ failedRuns: 12 });
    expect(noteOf(failing)).toBe(
      "1 got no scores · 3 have no threshold · 12 failed runs · Eval Jobs",
    );
    expect(failing.find('[data-test="quality-tile-failed-runs"]').classes()).toContain(
      "text-status-error-text",
    );
    for (const failedRuns of [0, null]) {
      const note = mountTable({ failedRuns }).find(
        '[data-test="quality-tile-without-result-note"]',
      );
      expect(note.text()).not.toContain("failed");
      expect(note.find('[data-test="quality-tile-eval-jobs"]').exists()).toBe(false);
    }
  });

  it("switches from one tile to the other, one highlighted at a time, with no chip", async () => {
    const wrapper = mountWired();
    const attention = wrapper.find('[data-test="quality-tile-attention"]');
    const withoutResult = wrapper.find('[data-test="quality-tile-without-result"]');
    await attention.trigger("click");
    await flushPromises();
    await withoutResult.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:tileFilter")).toEqual([["attention"], ["withoutResult"]]);
    expect(withoutResult.attributes("aria-pressed")).toBe("true");
    expect(withoutResult.classes()).toContain("border-accent");
    expect(attention.attributes("aria-pressed")).toBe("false");
    expect(attention.classes()).not.toContain("border-accent");
    expect(rowIds(wrapper)).toEqual(["row-con", "row-gro"]);
    expect(wrapper.find('[data-test="quality-tile-chip"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Without a result 4");
  });

  it("reads 0 of 16 and says every config gives a result, still clickable like the first tile", async () => {
    const wrapper = mountTable({ tiles: ALL_GIVE_A_RESULT, failedRuns: 0 });
    const tile = wrapper.find('[data-test="quality-tile-without-result"]');
    expect(tile.text()).toMatch(/0\s*of 16/);
    expect(noteOf(tile)).toBe("Every config gives a result");
    expect(tile.find(".text-icon-chip-warning-text").exists()).toBe(false);
    expect(tile.element.tagName).toBe("BUTTON");
    await tile.trigger("click");
    expect(wrapper.emitted("update:tileFilter")).toEqual([["withoutResult"]]);
  });

  it("opens the Score Config and the Eval Jobs tab in the same tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    push.mockClear();
    const wrapper = mountTable({ failedRuns: 12 });
    await wrapper.find('[data-test="quality-configs-config-link-hal"]').trigger("click");
    expect(push).toHaveBeenLastCalledWith({
      name: "aiEvaluations",
      query: { org_identifier: "default", tab: "scoreConfigs", action: "view", id: "hal" },
    });
    expect(wrapper.emitted("open")).toBeUndefined();
    await wrapper.find('[data-test="quality-tile-eval-jobs"]').trigger("click");
    expect(push).toHaveBeenLastCalledWith({
      name: "aiEvaluations",
      query: { org_identifier: "default", tab: "jobs" },
    });
    expect(wrapper.emitted("update:tileFilter")).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it("matches the search on name and description", async () => {
    const wrapper = mountTable();
    await wrapper.find('[data-test="quality-configs-search"] input').setValue("instructions");
    await flushPromises();
    expect(wrapper.find('[data-test="row-ins"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="row-hal"]').exists()).toBe(false);
  });
});
