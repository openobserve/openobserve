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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppFiltersSummary from "./AppFiltersSummary.vue";

const mountSummary = (props: Record<string, unknown>) =>
  mount(AppFiltersSummary, { props: { counts: null, included: false, app: "shop-web", ...props } });
const LINE = '[data-test="rum-analytics-funnel-app-filters"]';

describe("AppFiltersSummary", () => {
  it("is hidden while the counts are unknown", () => {
    expect(mountSummary({}).find(LINE).exists()).toBe(false);
  });

  it("is hidden when nothing was removed", () => {
    const w = mountSummary({ counts: { builtin: 0, rules: 0, synthetic: 0 } });
    expect(w.find(LINE).exists()).toBe(false);
  });

  it("lists built-in, saved-rule and synthetic removals with their counts", () => {
    const w = mountSummary({ counts: { builtin: 1200, rules: 30, synthetic: 4 } });
    const at = (id: string) => w.find(`[data-test="rum-analytics-funnel-app-filters-${id}"]`);
    expect(at("builtin").text()).toBe("Built-in bot rule 1,200");
    expect(at("rules").text()).toBe("Saved rules 30");
    expect(at("synthetic").text()).toBe("Synthetic tests 4 · always excluded");
    expect(at("include").text()).toBe("Include hidden sessions (this view only)");
    expect(at("edit").text()).toBe("Edit app filters");
  });

  it("leaves out a zero count and offers Include only when rules removed something", () => {
    const w = mountSummary({ counts: { builtin: 0, rules: 0, synthetic: 4 } });
    expect(w.find(LINE).exists()).toBe(true);
    expect(w.find('[data-test="rum-analytics-funnel-app-filters-builtin"]').exists()).toBe(false);
    expect(w.find('[data-test="rum-analytics-funnel-app-filters-include"]').exists()).toBe(false);
  });

  it("while hidden traffic is included only the synthetic sessions stay listed", () => {
    const w = mountSummary({ counts: { builtin: 9, rules: 3, synthetic: 4 }, included: true });
    expect(w.find('[data-test="rum-analytics-funnel-app-filters-builtin"]').exists()).toBe(false);
    expect(w.find('[data-test="rum-analytics-funnel-app-filters-rules"]').exists()).toBe(false);
    expect(w.find('[data-test="rum-analytics-funnel-app-filters-synthetic"]').exists()).toBe(true);
    expect(w.find('[data-test="rum-analytics-funnel-app-filters-include"]').exists()).toBe(false);
  });

  it("shows the synthetic count while the rule counts are still unknown", () => {
    const w = mountSummary({
      counts: { builtin: null, rules: null, synthetic: 4 },
      included: true,
    });
    expect(w.find('[data-test="rum-analytics-funnel-app-filters-synthetic"]').exists()).toBe(true);
    expect(w.find('[data-test="rum-analytics-funnel-app-filters-include"]').exists()).toBe(false);
  });

  it("emits include and edit from its links", async () => {
    const w = mountSummary({ counts: { builtin: 1, rules: 0, synthetic: 0 } });
    await w.find('[data-test="rum-analytics-funnel-app-filters-include"]').trigger("click");
    await w.find('[data-test="rum-analytics-funnel-app-filters-edit"]').trigger("click");
    expect(w.emitted("include")).toHaveLength(1);
    expect(w.emitted("edit")).toHaveLength(1);
  });

  it("with always set, says nothing is hidden instead of disappearing", () => {
    const w = mountSummary({ counts: { builtin: 0, rules: 0, synthetic: 0 }, always: true });
    expect(w.find('[data-test="rum-analytics-funnel-app-filters-none"]').text()).toBe(
      "Nothing is hidden in this range",
    );
  });
});
