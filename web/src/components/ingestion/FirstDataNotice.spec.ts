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
import { createStore } from "vuex";
import i18n from "@/locales";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import FirstDataNotice from "./FirstDataNotice.vue";

const mountNotice = (streamType: string, features: Record<string, string> = {}) =>
  mount(FirstDataNotice, {
    props: { stream: { name: "default", streamType } as never },
    global: { plugins: [i18n, createStore({ state: { zoConfig: { features } } })] },
  });

describe("FirstDataNotice — open in the signal page", () => {
  it("opens the signal page when its license is enabled", async () => {
    const wrapper = mountNotice("metrics", { traces: "locked" });
    const open = wrapper.find('[data-test="first-data-notice-open-btn"]');
    expect(open.text()).toBe("Open in Metrics");
    expect(open.attributes("disabled")).toBeUndefined();
    await open.trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("disables the open control with a lock when the signal is locked", async () => {
    const wrapper = mountNotice("traces", { traces: "locked" });
    const open = wrapper.find('[data-test="first-data-notice-open-btn"]');
    expect(open.attributes("disabled")).toBeDefined();
    expect(open.findAllComponents(OIcon).map((i) => i.props("name"))).toContain("lock");
    await open.trigger("click");
    expect(wrapper.emitted("open")).toBeUndefined();
  });
});
