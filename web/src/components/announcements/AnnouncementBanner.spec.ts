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

import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";
import type { Banner } from "@/composables/useAnnouncementBanners";

const NOW_MS = 1_770_000_000_000;
const banners = ref<Banner[]>([]);

vi.mock("@/composables/useAnnouncementBanners", () => ({
  useAnnouncementBanners: () => ({
    banners,
    dismiss: vi.fn(),
    start: vi.fn(),
    serverNowMs: () => NOW_MS,
  }),
}));

import AnnouncementBanner from "./AnnouncementBanner.vue";

const downtimeBanner = (url: string): Banner => ({
  id: "downtime:dt-1:1",
  message: raw("Kafka upgrade is active."),
  variant: "warning",
  ends_at: (NOW_MS + 20 * 60_000) * 1000,
  dismissible: true,
  cta: { text: raw("View downtimes"), url },
});

const mountBanner = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/downtimes", name: "downtimes", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  await router.isReady();
  const wrapper = mount(AnnouncementBanner, { global: { plugins: [store, router] } });
  await flushPromises();
  return { wrapper, router };
};

describe("AnnouncementBanner", () => {
  beforeEach(() => {
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "acme",
    };
  });

  afterEach(() => {
    banners.value = [];
  });

  it("opens an in-app link in place, on the current org", async () => {
    banners.value = [downtimeBanner("/web/downtimes?status=active&scope=all")];
    const { wrapper, router } = await mountBanner();

    const cta = wrapper.get('[data-test="announcement-banner-cta-downtime:dt-1:1"]');
    expect(cta.attributes("target")).toBeUndefined();
    await cta.trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/downtimes");
    expect(router.currentRoute.value.query).toEqual({
      status: "active",
      scope: "all",
      org_identifier: "acme",
    });
  });

  it("keeps an external link in a new tab", async () => {
    banners.value = [downtimeBanner("https://status.example.com/incident")];
    const { wrapper } = await mountBanner();

    const cta = wrapper.get('[data-test="announcement-banner-cta-downtime:dt-1:1"]');
    expect(cta.attributes("href")).toBe("https://status.example.com/incident");
    expect(cta.attributes("target")).toBe("_blank");
  });

  it("stacks the countdown under the message on a phone", async () => {
    banners.value = [downtimeBanner("/web/downtimes")];
    const { wrapper } = await mountBanner();

    const body = wrapper.get('[data-test="announcement-banner-body-downtime:dt-1:1"]');
    expect(body.classes()).toContain("max-sm:flex-col");
    expect(body.text()).toContain("Kafka upgrade is active.");
    expect(body.find('[data-test="announcement-banner-countdown-downtime:dt-1:1"]').exists()).toBe(
      true,
    );
  });
});
