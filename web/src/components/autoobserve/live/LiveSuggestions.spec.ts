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
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { gt, raw } from "@/types/i18n";
import type { AutoObserveSuggestion } from "@/services/autoobserve";
import LiveSuggestions from "./LiveSuggestions.vue";
import { toRequests } from "./liveAdapter";
import type { RailSource } from "./liveModel";

const suggestion = (id: string): AutoObserveSuggestion => ({
  id,
  org: "acme",
  analyzer: "coverage",
  kind: "coverage_gap",
  subject: { kind: "service", key_dims: { service_name: id } },
  evidence: { service_name: id, severity: "medium", cells: {} },
  score: 1,
  confidence: "sufficient",
  status: "proposed",
  decided_score: null,
  on_accept: null,
});

const rail = (count: number, total: number, over: Partial<RailSource> = {}): RailSource => ({
  status: "ready",
  retry: () => undefined,
  busy: false,
  failure: null,
  detail: raw(""),
  stale: null,
  requests: toRequests(
    gt,
    { locale: "en-US", timeZone: "UTC" },
    Array.from({ length: count }, (_, i) => suggestion(`svc${i}`)),
  ),
  total,
  ...over,
});

const mountRail = (source: RailSource, skeleton = false) =>
  mount(LiveSuggestions, {
    props: { rail: source, skeleton },
    global: { plugins: [i18n, store, router] },
  });

const cards = (wrapper: ReturnType<typeof mountRail>) =>
  wrapper.findAll('[data-test^="autoobserve2-request-headline-"]');

const countChip = (wrapper: ReturnType<typeof mountRail>) => {
  const chip = wrapper.find("header > span");
  return chip.exists() ? chip.text() : null;
};

const SUBTITLE = '[data-test="autoobserve2-suggestions-subtitle"]';

describe("LiveSuggestions rail (OSS-11, OSS-9)", () => {
  it("shows the top five, the server total, 'and N more' and 'See all N'", () => {
    const wrapper = mountRail(rail(8, 12));
    expect(cards(wrapper)).toHaveLength(5);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-more"]').text()).toBe("and 7 more");
    expect(wrapper.find('[data-test="autoobserve2-suggestions-see-all"]').text()).toBe(
      "See all 12",
    );
    expect(countChip(wrapper)).toBe("12");
  });

  it("has no footer when every suggestion fits", () => {
    const wrapper = mountRail(rail(1, 1));
    expect(cards(wrapper)).toHaveLength(1);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-more"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-see-all"]').exists()).toBe(false);
  });

  it("keeps its card with no suggestions and says so", () => {
    const wrapper = mountRail(rail(0, 0));
    expect(wrapper.find('[data-test="autoobserve2-suggestions"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-empty"]').text()).toContain(
      "No suggestions right now",
    );
  });

  it("shows a red, retryable failure instead of vanishing", () => {
    const wrapper = mountRail(rail(0, 0, { status: "error", failure: "failed" }));
    const error = wrapper.find('[data-test="autoobserve2-suggestions-error"]');
    expect(error.attributes("role")).toBe("alert");
    expect(wrapper.find('[data-test="autoobserve2-suggestions-retry"]').exists()).toBe(true);
  });

  it("keeps the cards under a red line when a refresh fails", () => {
    const wrapper = mountRail(
      rail(3, 3, { failure: "failed", stale: { failedAt: 2_000, dataAt: 1_000 } }),
    );
    expect(cards(wrapper)).toHaveLength(3);
    const line = wrapper.find('[data-test="autoobserve2-suggestions-refresh-failed"]');
    expect(line.attributes("role")).toBe("alert");
    expect(line.text()).toContain("Refresh failed at");
  });

  it("shows the skeleton, not the cards, while it is held", () => {
    const wrapper = mountRail(rail(3, 3), true);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-skeleton"]').exists()).toBe(true);
    expect(cards(wrapper)).toHaveLength(0);
  });

  it("keeps the subtitle from loading through the hold to the cards", async () => {
    const wrapper = mountRail(rail(0, 0, { status: "loading" }), true);
    expect(wrapper.find(SUBTITLE).exists()).toBe(true);
    await wrapper.setProps({ rail: rail(3, 3), skeleton: true });
    expect(wrapper.find(SUBTITLE).exists()).toBe(true);
    await wrapper.setProps({ skeleton: false });
    expect(wrapper.find(SUBTITLE).exists()).toBe(true);
    expect(countChip(wrapper)).toBe("3");
  });

  it("gives a failed load a red icon and the raw cause behind Details", async () => {
    const wrapper = mountRail(
      rail(0, 0, { status: "error", failure: "failed", detail: raw("upstream timed out") }),
    );
    const error = wrapper.find('[data-test="autoobserve2-suggestions-error"]');
    expect(error.find(".o2-empty-state__inline-icon").classes()).toContain("bg-status-error-bg");
    const details = wrapper.find('[data-test="autoobserve2-suggestions-error-details"]');
    expect(details.exists()).toBe(true);
    expect(wrapper.text()).not.toContain("upstream timed out");
    await details.trigger("click");
    expect(wrapper.text()).toContain("upstream timed out");
  });

  it("shows the refresh failure over an empty list too", () => {
    const wrapper = mountRail(
      rail(0, 0, { failure: "failed", stale: { failedAt: 2_000, dataAt: 1_000 } }),
    );
    expect(wrapper.find('[data-test="autoobserve2-suggestions-refresh-failed"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="autoobserve2-suggestions-empty"]').exists()).toBe(true);
  });

  it("shows that a retry is running", () => {
    const failed = mountRail(rail(0, 0, { status: "error", failure: "failed", busy: true }));
    expect(
      failed.find('[data-test="autoobserve2-suggestions-retry"]').attributes("aria-busy"),
    ).toBe("true");
    const stale = mountRail(
      rail(2, 2, { failure: "failed", busy: true, stale: { failedAt: 2_000, dataAt: 1_000 } }),
    );
    expect(
      stale
        .find('[data-test="autoobserve2-suggestions-refresh-failed-retry"]')
        .attributes("aria-busy"),
    ).toBe("true");
  });

  it("announces loading while the skeleton shows and loaded once the cards land", async () => {
    const announce = (w: ReturnType<typeof mountRail>) =>
      w.find('[data-test="autoobserve2-suggestions-announce"]');
    const wrapper = mountRail(rail(0, 0, { status: "loading" }), true);
    expect(announce(wrapper).attributes("role")).toBe("status");
    expect(announce(wrapper).text()).toBe("Loading suggestions");
    await wrapper.setProps({ rail: rail(2, 2), skeleton: false });
    expect(announce(wrapper).text()).toBe("Suggestions loaded");
  });
});

describe("LiveSuggestions rail when decisions empty the first page", () => {
  it("keeps See all from the server total, and never says there are no suggestions", () => {
    const wrapper = mountRail(rail(0, 12));
    expect(cards(wrapper)).toHaveLength(0);
    const seeAll = wrapper.find('[data-test="autoobserve2-suggestions-see-all"]');
    expect(seeAll.exists()).toBe(true);
    expect(seeAll.text()).toBe("See all 12");
    expect(wrapper.find('[data-test="autoobserve2-suggestions-more"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-page-empty"]').text()).toContain(
      "The top suggestions were already handled",
    );
    expect(countChip(wrapper)).toBe("12");
  });

  it("keeps See all when the page holds fewer cards than the total", () => {
    const wrapper = mountRail(rail(2, 12));
    expect(cards(wrapper)).toHaveLength(2);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-more"]').text()).toBe("and 10 more");
    expect(wrapper.find('[data-test="autoobserve2-suggestions-see-all"]').exists()).toBe(true);
  });
});
