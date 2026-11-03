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

import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import About from "./About.vue";
import i18n from "@/locales";

const licenseLimit = vi.hoisted(() => ({
  value: 100 as number | undefined,
  typ: "PerDayCount",
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `/mocked/${path}`),
}));

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

vi.mock("@/services/license_server", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_license: vi.fn().mockImplementation(async () => ({
        data: {
          license: {
            license_id: "test-license-123",
            created_at: 1704067200000000,
            expires_at: 1735689600000000,
            limits:
              licenseLimit.value !== undefined
                ? { Ingestion: { typ: licenseLimit.typ, value: licenseLimit.value } }
                : {},
          },
          expired: false,
          ingestion_used: 45.5,
          installation_id: "install-123",
        },
      })),
    },
  });
});

const mountAbout = async () => {
  const store = createStore({
    state: {
      theme: "light",
      zoConfig: {
        version: "v2.0.0",
        build_type: "enterprise",
        commit_hash: "abc",
        build_date: "x",
      },
      organizations: [],
      userInfo: { email: "test@example.com" },
    },
  });
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: "/about", component: About }],
  });
  const wrapper = mount(About, { global: { plugins: [i18n, store, router] } });
  await flushPromises();
  return wrapper;
};

describe("About license plan text", () => {
  it("shows the free-tier plan line for the 50 GB/day licence", async () => {
    licenseLimit.value = 50;
    licenseLimit.typ = "PerDayCount";
    const wrapper = await mountAbout();
    expect(wrapper.find('[data-test="about-license-plan-detail"]').exists()).toBe(true);
  });

  it("shows the free-tier plan line when the licence carries no ingestion limit", async () => {
    licenseLimit.value = undefined;
    licenseLimit.typ = "PerDayCount";
    const wrapper = await mountAbout();
    expect(wrapper.find('[data-test="about-license-plan-detail"]').exists()).toBe(true);
  });

  it("hides the free-tier 50 GB line for a 100 GB licence", async () => {
    licenseLimit.value = 100;
    licenseLimit.typ = "PerDayCount";
    const wrapper = await mountAbout();
    expect(wrapper.text()).toContain("100 GB");
    expect(wrapper.find('[data-test="about-license-plan-detail"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("free for up to 50 GB/day");
  });

  it("hides the free-tier 50 GB line for an unlimited licence", async () => {
    licenseLimit.value = 0;
    licenseLimit.typ = "Unlimited";
    const wrapper = await mountAbout();
    expect(wrapper.find('[data-test="about-license-plan-detail"]').exists()).toBe(false);
  });
});
