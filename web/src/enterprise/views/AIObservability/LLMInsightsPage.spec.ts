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
//
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, onMounted } from "vue";
import { mount } from "@vue/test-utils";
import type * as I18n from "@/types/i18n";

const route = { query: {} as Record<string, string> };
const replace = vi.fn((_to: { query: Record<string, string> }) => Promise.resolve());
vi.mock("vue-router", () => ({ useRoute: () => route, useRouter: () => ({ replace }) }));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof I18n>();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

// Like DateTime: the picker seeds itself from `dateState` in its own onMounted, which runs
// before the page's, and replays that window as a date-change.
const pickerSeed: { value: Record<string, unknown> | null } = { value: null };
vi.mock("@/enterprise/components/AIObservability/AiPageShell.vue", () => ({
  default: defineComponent({
    name: "AiPageShell",
    props: ["dateState"],
    emits: ["date-change"],
    setup(props, { emit }) {
      onMounted(() => {
        pickerSeed.value = { ...props.dateState };
        emit("date-change", { ...props.dateState, userChangedValue: false });
      });
    },
    template: "<div><slot /></div>",
  }),
}));

vi.mock("@/plugins/traces/LLMInsightsDashboard.vue", () => ({
  default: { name: "LLMInsightsDashboard", template: "<div />" },
}));

vi.mock("@/enterprise/composables/useChildRefresh", () => ({
  useChildRefresh: () => ({
    lastRunAt: { value: null },
    isLoading: { value: false },
    refresh: vi.fn(),
  }),
}));

const SAVED = {
  valueType: "absolute",
  startTime: 1_000_000,
  endTime: 2_000_000,
  relativeTimePeriod: null,
};

async function mountPage(query: Record<string, string>) {
  route.query = query;
  // The shared date state is a module singleton loaded from localStorage at import, so each
  // test re-imports the page to load the range it saved.
  vi.resetModules();
  const Page = (await import("./LLMInsightsPage.vue")).default;
  return mount(Page);
}

beforeEach(() => {
  pickerSeed.value = null;
  replace.mockClear();
  localStorage.setItem("aiObservability:dateRange", JSON.stringify(SAVED));
});

describe("LLMInsightsPage deep link over a saved date range", () => {
  it("seeds the picker and the URL with the link's from/to", async () => {
    await mountPage({ from: "5000000", to: "9000000", stream: "agent_e2e" });
    expect(pickerSeed.value).toMatchObject({
      valueType: "absolute",
      startTime: 5_000_000,
      endTime: 9_000_000,
    });
    for (const [arg] of replace.mock.calls) {
      expect(arg.query).toMatchObject({ from: "5000000", to: "9000000", stream: "agent_e2e" });
    }
  });

  it("seeds the picker with the link's period", async () => {
    await mountPage({ period: "6h" });
    expect(pickerSeed.value).toMatchObject({ valueType: "relative", relativeTimePeriod: "6h" });
    for (const [arg] of replace.mock.calls) expect(arg.query.period).toBe("6h");
  });

  it("keeps the saved range when the link has no date", async () => {
    await mountPage({ stream: "agent_e2e" });
    expect(pickerSeed.value).toMatchObject({ startTime: 1_000_000, endTime: 2_000_000 });
  });
});
