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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { ref } from "vue";
import i18n from "@/locales";

vi.mock("@/composables/rum/useAnalyticsSearch", () => ({
  default: () => ({
    panel: () =>
      ref({
        status: "ok",
        rows: [{ u: "a@x.com", retained: 1, sessions: 3, last_seen: 1790000000000000 }],
      }),
    run: vi.fn(),
    abortAll: vi.fn(),
  }),
}));

vi.mock("@/composables/rum/useProductAnalytics", () => ({
  default: () => ({
    usersUnit: ref({ partial: false, label: "", noun: "users", one: "User" }),
    sampleRatio: ref(1),
    identitySql: ref(null),
  }),
}));

import RetentionCellDrawer from "./RetentionCellDrawer.vue";

describe("RetentionCellDrawer", () => {
  let wrapper: VueWrapper | null = null;

  const mountDrawer = async (features: Record<string, string>) => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    wrapper = mount(RetentionCellDrawer, {
      props: {
        open: true,
        cohort: 0,
        k: 1,
        def: { mode: "on" } as never,
        periods: { boundariesUs: [] } as never,
        cohortLabel: "Week 1",
        periodLabel: "Week 1" as never,
      },
      global: {
        plugins: [
          i18n,
          router,
          createStore({ state: { zoConfig: { features }, timezone: "UTC", theme: "light" } }),
        ],
      },
      attachTo: document.body,
    });
    await flushPromises();
  };

  const sessionsBtn = () =>
    wrapper!
      .findAllComponents({ name: "OButton" })
      .find((b) => b.attributes("data-test") === "rum-analytics-retention-user-0-sessions-btn");

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("disables View in sessions with a lock when rum is locked", async () => {
    await mountDrawer({ rum: "locked" });

    expect(sessionsBtn()?.props("disabled")).toBe(true);
    expect(sessionsBtn()?.props("iconLeft")).toBe("lock");
  });

  it("keeps View in sessions live when rum is enabled", async () => {
    await mountDrawer({ rum: "enabled" });

    expect(sessionsBtn()?.props("disabled")).toBeFalsy();
    expect(sessionsBtn()?.props("iconRight")).toBe("arrow-forward");
  });
});
