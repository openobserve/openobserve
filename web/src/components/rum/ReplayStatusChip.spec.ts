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

import { describe, expect, it, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import ReplayStatusChip from "./ReplayStatusChip.vue";

function mountChip(loadState: string) {
  return mount(ReplayStatusChip, {
    props: { loadState: loadState as any },
    global: { plugins: [i18n] },
  });
}

function dotClasses(wrapper: VueWrapper) {
  return wrapper.find('[data-test="replay-status-chip"] > span').classes();
}

describe("ReplayStatusChip", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper.unmount();
  });

  it("shows nothing while the session is live, even once fully loaded", async () => {
    wrapper = mountChip("loading");
    await wrapper.setProps({ loadState: "live" });

    expect(wrapper.find('[data-test="replay-status-chip"]').exists()).toBe(false);
  });

  it("shows a primary dot while loading", () => {
    wrapper = mountChip("loading");

    const classes = dotClasses(wrapper);
    expect(classes).toContain("bg-button-primary");
  });

  it("shows a teal dot once a load completes", async () => {
    wrapper = mountChip("loading");
    await wrapper.setProps({ loadState: "complete" });

    const classes = dotClasses(wrapper);
    expect(classes).toContain("bg-badge-teal-solid-bg");
  });
});
