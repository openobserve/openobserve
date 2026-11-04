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
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";

import type { FirstEventResult } from "@/composables/firstEvent/useFirstEventWatch";
import { queryClient } from "@/composables/query/queryClient";
import { streamKeys } from "@/services/stream.querykeys";
import store from "@/test/unit/helpers/store";
import analytics from "@/services/product_analytics";
import { raw } from "@/types/i18n";

import OnboardingFirstData from "./OnboardingFirstData.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const empty = { render: () => null };

const RANGE = { rangeStart: 1_700_000_000_000_000, rangeEnd: 1_700_001_800_000_000 };
const resultFor = (
  streamType: FirstEventResult["streamType"] = "logs",
  count = 1284,
  streamName = "default",
): FirstEventResult => ({ streamType, streamName, count, ...RANGE });

async function mountPanel(result: FirstEventResult = resultFor(), note?: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: empty },
      { path: "/logs", name: "logs", component: empty },
      { path: "/metrics", name: "metrics", component: empty },
      { path: "/traces", name: "traces", component: empty },
      { path: "/ingestion/recommended", name: "recommended", component: empty },
      { path: "/onboarding/:path*", name: "onboarding", component: empty },
    ],
  });
  await router.push("/onboarding/infrastructure");
  const wrapper = mount(OnboardingFirstData, {
    props: {
      title: raw("Linux is sending data"),
      note: note ? raw(note) : undefined,
      result,
      route: "ingestFromLinux",
    },
    global: { plugins: [store, router] },
  });
  return { wrapper, router };
}

const click = async (wrapper: Awaited<ReturnType<typeof mountPanel>>["wrapper"], id: string) => {
  await wrapper.find(`[data-test="onboarding-first-data-${id}"]`).trigger("click");
  await flushPromises();
};

const org = store.state.selectedOrganization.identifier;

describe("OnboardingFirstData", () => {
  afterEach(() => vi.mocked(analytics.track).mockClear());

  it("shows the title, the record count and the stream", async () => {
    const { wrapper } = await mountPanel();
    expect(wrapper.text()).toContain("Linux is sending data");
    expect(wrapper.find('[data-test="onboarding-first-data-count"]').text()).toBe(
      "1,284 records arrived in default",
    );
  });

  it("uses the singular for one record", async () => {
    const { wrapper } = await mountPanel(resultFor("metrics", 1, "system_cpu_time"));
    expect(wrapper.find('[data-test="onboarding-first-data-count"]').text()).toBe(
      "1 record arrived in system_cpu_time",
    );
  });

  // The same targets as the inline status's own button (rangeRoute).
  it.each([
    [
      "logs",
      "Explore Your Logs",
      { stream: "default", stream_type: "logs", from: String(RANGE.rangeStart) },
    ],
    [
      "metrics",
      "Explore Your Metrics",
      { metric: "default", from: String(RANGE.rangeStart / 1000) },
    ],
    ["traces", "Explore Your Traces", { stream: "default", from: String(RANGE.rangeStart) }],
  ] as const)("opens the %s stream and time range that arrived", async (type, label, query) => {
    const { wrapper, router } = await mountPanel(resultFor(type));
    expect(wrapper.find('[data-test="onboarding-first-data-open"]').text()).toBe(label);
    await click(wrapper, "open");
    expect(router.currentRoute.value.name).toBe(type);
    expect(router.currentRoute.value.query).toMatchObject({ org_identifier: org, ...query });
  });

  it("sends Add Another Source to Data sources, not back into onboarding", async () => {
    const { wrapper, router } = await mountPanel();
    await click(wrapper, "another");
    expect(router.currentRoute.value.name).toBe("recommended");
    expect(router.currentRoute.value.query.org_identifier).toBe(org);
  });

  it("offers one next step and one way to add more, nothing else", async () => {
    const { wrapper } = await mountPanel();
    expect(wrapper.findAll("button").map((b) => b.text())).toEqual([
      "Explore Your Logs",
      "Add Another Source",
    ]);
  });

  it("tracks onboarding_first_data once with the route and count", async () => {
    await mountPanel(resultFor("metrics", 7));
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith("onboarding_first_data", {
      route: "ingestFromLinux",
      count: 7,
    });
  });

  it("marks every user stream list stale, so the data pages read the new streams", async () => {
    for (const type of ["logs", "metrics", "traces"]) {
      queryClient.setQueryData(streamKeys.nameList(org, type), []);
    }
    await mountPanel();
    await flushPromises();
    for (const type of ["logs", "metrics", "traces"]) {
      expect(queryClient.getQueryState(streamKeys.nameList(org, type))?.isInvalidated).toBe(true);
    }
    queryClient.clear();
  });

  it("shows a next-step line only when the page gives one", async () => {
    expect(
      (await mountPanel()).wrapper.find('[data-test="onboarding-first-data-note"]').exists(),
    ).toBe(false);
    const { wrapper } = await mountPanel(resultFor(), "Next, run your app.");
    expect(wrapper.find('[data-test="onboarding-first-data-note"]').text()).toBe(
      "Next, run your app.",
    );
  });
});
