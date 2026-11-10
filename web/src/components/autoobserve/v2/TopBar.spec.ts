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
import TopBarStatus from "./TopBarStatus.vue";
import ViewSwitch from "./ViewSwitch.vue";
import router from "@/test/unit/helpers/router";

const mountBar = () => mount(TopBar, { global: { plugins: [i18n], stubs: { ViewSwitch: true } } });

const mountStatus = (props: Record<string, unknown> = {}) =>
  mount(TopBarStatus, { props, global: { plugins: [i18n] } });

const has = (wrapper: { find: ReturnType<typeof mountBar>["find"] }, name: string) =>
  wrapper.find(`[data-test="autoobserve2-${name}"]`).exists();

const TODAY = raw("Thursday, November 5");

describe("TopBar", () => {
  it("fixture mode shows the demo date and check time", () => {
    const wrapper = mountStatus();
    expect(has(wrapper, "topbar-checked")).toBe(false);
    expect(wrapper.text()).toContain("Checked 2 minutes ago");
  });

  it("the status is one line that never wraps, so a ticking time moves nothing", () => {
    const wrapper = mountStatus({ live: true, date: TODAY, checked: { kind: "none" } });
    expect(wrapper.find('[data-test="autoobserve2-topbar"]').classes()).toContain(
      "whitespace-nowrap",
    );
    expect(wrapper.text()).toContain("Thursday, November 5");
  });

  it("keeps search, History, Settings and How it works", () => {
    const wrapper = mountBar();
    for (const name of [
      "nav-search",
      "nav-search-open",
      "nav-history",
      "nav-settings",
      "nav-how-it-works",
    ])
      expect(has(wrapper, name), name).toBe(true);
  });

  it("the check slot follows the coverage pass", () => {
    const slot = (checked: Record<string, unknown>) =>
      mountStatus({ live: true, date: TODAY, checked }).find(
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

describe("ViewSwitch label (T5-28)", () => {
  it("names the full view by what it shows, not 'Nerd'", () => {
    const w = mount(ViewSwitch, { global: { plugins: [i18n, router] } });
    expect(w.find('[data-test="autoobserve-view-nerd"]').text()).toBe("Detailed");
  });
});
