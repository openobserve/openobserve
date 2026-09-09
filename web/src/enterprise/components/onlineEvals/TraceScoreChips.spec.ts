// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import type { TraceScoreChip } from "./composables/useTraceScoreChips";

const mockLoad = vi.fn();
const chipsRef = ref<TraceScoreChip[]>([]);
const loadingRef = ref(false);
vi.mock("./composables/useTraceScoreChips", () => ({
  useTraceScoreChips: () => ({ chips: chipsRef, loading: loadingRef, load: mockLoad }),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useI18nTyped: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key} ${Object.values(params).join(" ")}` : key,
    }),
  };
});

const stubs = {
  OTag: {
    props: ["clickable"],
    template: `<span v-bind="$attrs"><slot name="icon" /><slot /></span>`,
  },
  OIcon: { template: `<i />` },
  OTooltip: { template: `<span><slot /><slot name="content" /></span>` },
  // A real toggle, not a passthrough: the overflow behaviour hinges on the panel opening on click.
  ODropdown: {
    data() {
      return { isOpen: false };
    },
    template: `<div>
      <span data-test="overflow-trigger-wrap" @click="isOpen = !isOpen"><slot name="trigger" /></span>
      <div v-if="isOpen" data-test="overflow-panel-wrap"><slot /></div>
    </div>`,
  },
  OSeparator: { template: `<hr />` },
  OSkeleton: { template: `<span v-bind="$attrs" />` },
};

function makeChip(overrides: Partial<TraceScoreChip> = {}): TraceScoreChip {
  return {
    key: "chip",
    label: "score",
    value: "1.00",
    description: null,
    reasoning: null,
    scoredAtMs: null,
    ...overrides,
  };
}

async function mountChips(slots?: Record<string, string>) {
  const TraceScoreChips = (await import("./TraceScoreChips.vue")).default;
  return mount(TraceScoreChips, {
    props: { scope: "span", targetId: "span-1", startTimeUs: 1_000 },
    global: { stubs },
    slots,
  });
}

describe("TraceScoreChips overflow", () => {
  beforeEach(() => {
    loadingRef.value = false;
    chipsRef.value = [];
  });

  it("shows a skeleton while loading and no chips have resolved yet", async () => {
    loadingRef.value = true;
    const wrapper = await mountChips();

    expect(wrapper.findAll('[data-test^="trace-score-chips-skeleton-"]')).toHaveLength(2);
    expect(wrapper.find('[data-test^="trace-score-chip-"]').exists()).toBe(false);
  });

  it("hides the skeleton once real chips have resolved, even if still loading", async () => {
    loadingRef.value = true;
    chipsRef.value = [makeChip({ key: "a" })];
    const wrapper = await mountChips();

    expect(wrapper.findAll('[data-test^="trace-score-chips-skeleton-"]')).toHaveLength(0);
    expect(wrapper.findAll('[data-test^="trace-score-chip-"]')).toHaveLength(1);
  });

  it("renders the empty slot once the query settles with no scores", async () => {
    const wrapper = await mountChips({
      empty: `<button data-test="annotate-cta">Annotate</button>`,
    });

    expect(wrapper.find('[data-test="annotate-cta"]').exists()).toBe(true);
  });

  it("does not render the empty slot while still loading", async () => {
    loadingRef.value = true;
    const wrapper = await mountChips({
      empty: `<button data-test="annotate-cta">Annotate</button>`,
    });

    expect(wrapper.find('[data-test="annotate-cta"]').exists()).toBe(false);
  });

  it("does not render the empty slot once real chips have resolved", async () => {
    chipsRef.value = [makeChip({ key: "a" })];
    const wrapper = await mountChips({
      empty: `<button data-test="annotate-cta">Annotate</button>`,
    });

    expect(wrapper.find('[data-test="annotate-cta"]').exists()).toBe(false);
  });

  it("exposes refresh() so a caller can re-run the query after recording a new score", async () => {
    const wrapper = await mountChips();

    (wrapper.vm as unknown as { refresh: () => void }).refresh();

    expect(mockLoad).toHaveBeenCalledWith("span", "span-1", 1_000);
  });

  it("renders every chip directly when there are only a couple", async () => {
    chipsRef.value = [
      makeChip({ key: "a", label: "safety" }),
      makeChip({ key: "b", label: "quality" }),
    ];
    const wrapper = await mountChips();

    expect(wrapper.findAll('[data-test^="trace-score-chip-"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="trace-score-chips-overflow"]').exists()).toBe(false);
  });

  it("caps visible chips at 2 and folds the rest behind a +N more trigger", async () => {
    chipsRef.value = Array.from({ length: 7 }, (_, i) =>
      makeChip({ key: `s${i}`, label: `scorer-${i}` }),
    );
    const wrapper = await mountChips();

    expect(wrapper.findAll('[data-test^="trace-score-chip-"]')).toHaveLength(2);
    const overflow = wrapper.get('[data-test="trace-score-chips-overflow"]');
    expect(overflow.text()).toContain("onlineEvals.traceScoreChip.moreCount 5");
  });

  it("opens the full list, including the already-visible chips, on click", async () => {
    chipsRef.value = Array.from({ length: 5 }, (_, i) =>
      makeChip({ key: `s${i}`, label: `scorer-${i}` }),
    );
    const wrapper = await mountChips();

    expect(wrapper.find('[data-test="trace-score-chips-overflow-panel"]').exists()).toBe(false);

    await wrapper.get('[data-test="overflow-trigger-wrap"]').trigger("click");

    const panel = wrapper.get('[data-test="trace-score-chips-overflow-panel"]');
    expect(panel.text()).toContain("scorer-0");
    expect(panel.text()).toContain("scorer-4");
    expect(panel.text()).toContain("onlineEvals.traceScoreChip.allScores 5");
  });
});
