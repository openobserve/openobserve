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
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import TopBar from "./TopBar.vue";

const mountBar = (props: Record<string, unknown> = {}) =>
  mount(TopBar, { props, global: { plugins: [i18n], stubs: { ViewSwitch: true } } });

const has = (wrapper: ReturnType<typeof mountBar>, name: string) =>
  wrapper.find(`[data-test="autoobserve2-${name}"]`).exists();

const TODAY = raw("Thursday, November 5");

describe("TopBar", () => {
  it("fixture mode keeps every control and the demo date", () => {
    const wrapper = mountBar();
    for (const name of ["nav-search", "nav-history", "nav-settings", "nav-how-it-works"])
      expect(has(wrapper, name), name).toBe(true);
    expect(has(wrapper, "topbar-checked")).toBe(false);
    expect(wrapper.text()).toContain("Checked 2 minutes ago");
  });

  it("live mode keeps search, History, Settings and How it works", () => {
    const wrapper = mountBar({ live: true, date: TODAY, checked: { kind: "none" } });
    for (const name of [
      "nav-search",
      "nav-search-open",
      "nav-history",
      "nav-settings",
      "nav-how-it-works",
    ])
      expect(has(wrapper, name), name).toBe(true);
    expect(wrapper.text()).toContain("Thursday, November 5");
  });

  it("the check slot follows the coverage pass", () => {
    const slot = (checked: Record<string, unknown>) =>
      mountBar({ live: true, date: TODAY, checked }).find(
        '[data-test="autoobserve2-topbar-checked"]',
      );

    const loading = slot({ kind: "loading" });
    expect(loading.classes()).toContain("min-w-32");
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true);
    expect(loading.text()).not.toContain("Checked");

    const ready = slot({ kind: "text", text: raw("Checked 12 minutes ago") });
    expect(ready.classes()).toContain("min-w-32");
    expect(ready.text()).toContain("Checked 12 minutes ago");
    expect(ready.find('[aria-busy="true"]').exists()).toBe(false);

    const none = slot({ kind: "none" });
    expect(none.exists()).toBe(true);
    expect(none.classes()).toContain("min-w-32");
    expect(none.attributes("aria-hidden")).toBe("true");
    expect(none.text()).toBe("");
  });
});
