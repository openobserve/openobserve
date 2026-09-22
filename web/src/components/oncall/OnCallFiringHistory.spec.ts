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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallFiringHistory from "@/components/oncall/OnCallFiringHistory.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Renders the real cell slots, so the tests exercise what the card actually
// draws rather than a column-def function OTable never calls.
const stubs = {
  OTable: {
    name: "OTable",
    props: ["data", "columns", "loading"],
    template: `<div>
      <div v-if="loading" data-test="skeleton" />
      <div v-else-if="!data.length"><slot name="empty" /></div>
      <div v-for="row in data" :key="row.id" data-test="row">
        <slot name="cell-opened_at" :row="row" />
        <slot name="cell-state" :row="row" />
        <slot name="cell-acked_by" :row="row" />
        <slot name="cell-cause" :row="row" />
      </div>
    </div>`,
  },
};

function firing(over: Record<string, unknown> = {}) {
  return {
    id: "resp_9",
    state: "resolved",
    opened_at: 1_700_000_000_000_000,
    acked_by: "ana@corp.com",
    cause: "noisy_threshold",
    ...over,
  } as any;
}

function render(firings: unknown[], loading = false) {
  return mount(OnCallFiringHistory, {
    props: { firings: firings as any, loading },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallFiringHistory", () => {
  it("lists each past firing", () => {
    const wrapper = render([firing(), firing({ id: "resp_8" })]);
    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(2);
  });

  /// A firing nobody ever claimed is the interesting one — it must not read as
  /// a blank cell that could equally mean "no data".
  it("says so when a firing was never acknowledged", () => {
    const wrapper = render([firing({ acked_by: null })]);
    expect(wrapper.text()).toContain("Never acknowledged");
  });

  it("shows the recorded cause", () => {
    const wrapper = render([firing()]);
    expect(wrapper.text()).toContain("Noisy threshold");
  });

  // First-ever firing is the normal case, not an error.
  it("explains an empty history rather than showing a bare frame", () => {
    const wrapper = render([]);
    expect(wrapper.find('[data-test="oncall-firing-history-empty"]').exists()).toBe(true);
  });

  /// Before `loading` existed, an in-flight fetch and a genuinely first-ever
  /// firing were indistinguishable: both rendered `firings: []`, so the "never
  /// fired before" copy flashed for every response while its history was still
  /// on the wire, then swapped to the real rows a moment later.
  it("does not claim first-ever firing while the fetch is still in flight", () => {
    const wrapper = render([], true);
    expect(wrapper.find('[data-test="oncall-firing-history-empty"]').exists()).toBe(false);
  });
});
