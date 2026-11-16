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
import { ref, shallowRef } from "vue";

import i18n from "@/locales";
import { raw } from "@/types/i18n";

import StarterPackInstallCard, { type StarterPackCardStatus } from "./StarterPackInstallCard.vue";
import { fakeFlow } from "./starterPackTestFlow";

const NO_PREVIEW = { alertCount: ref(null), dashboardCount: ref(null), viewCount: ref(null) };

const render = (status: StarterPackCardStatus, over: Record<string, unknown> = {}) =>
  mount(StarterPackInstallCard, {
    props: {
      flow: fakeFlow({ ...NO_PREVIEW, ...over }),
      title: raw("K"),
      streamCount: 1,
      testId: "card",
      status,
    },
    global: { plugins: [i18n] },
  });

describe("StarterPackInstallCard", () => {
  it("hides the counts before install while there is no preview", () => {
    const wrapper = render("ready");
    expect(wrapper.find('[data-test="card-counts"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="card-setup-btn"]').text()).toBe("Set up");
  });

  it("keeps the progress rows of an interrupted install without a preview", () => {
    const wrapper = render("interrupted", {
      record: shallowRef({ status: "incomplete" }),
      toCreate: ref([
        { kind: "dashboard", itemId: "overview", status: "created" },
        { kind: "alert", itemId: "a1", status: "pending" },
      ]),
    });
    expect(wrapper.get('[data-test="card-row-dashboard"]').text()).toContain("1 dashboard");
    expect(wrapper.find('[data-test="card-row-dashboard-status"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="card-row-alert-status"]').exists()).toBe(true);
  });
});
