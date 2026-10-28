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
import { http, HttpResponse } from "msw";
import { defineComponent, h, inject, onBeforeUnmount, ref, type Ref } from "vue";
import { createMemoryHistory, createRouter, useRoute } from "vue-router";

import {
  FIRST_EVENT_REPORTER,
  type FirstEventReporter,
} from "@/composables/firstEvent/firstEventReporter";
import FirstEventStatus from "@/components/ingestion/FirstEventStatus.vue";
import { queryClient } from "@/composables/query/queryClient";
import analytics from "@/services/product_analytics";
import apiKeys from "@/services/api_keys";
import store from "@/test/unit/helpers/store";

import FrontendRumConfig from "@/components/ingestion/recommended/FrontendRumConfig.vue";
import { gt } from "@/types/i18n";

import OnboardingEmbeddedGuide from "./OnboardingEmbeddedGuide.vue";
import OnboardingStepGuide from "./OnboardingStepGuide.vue";
import { buildChoices, resolvePath } from "./onboardingChoices";

// The real curl page polls through this watch; it records what the page asked to watch.
const watchArgs = vi.fn();
// Each status's watch, so a test can make one receive.
const watches: { state: Ref<string>; result: Ref<unknown> }[] = [];
vi.mock("@/composables/firstEvent/useFirstEventWatch", async () => {
  const { ref: vueRef } = await import("vue");
  return {
    useFirstEventWatch: (...args: unknown[]) => {
      watchArgs(...args);
      const watch = {
        state: vueRef("waiting"),
        result: vueRef(),
        diagnosis: vueRef(),
        startedAtMs: vueRef(Date.now()),
        scope: vueRef("new-data"),
        troubleshooting: vueRef(false),
        sinceUs: vueRef(),
        start: vi.fn(),
        stop: vi.fn(),
        probeNow: vi.fn(),
        troubleshoot: vi.fn(),
      };
      watches.push(watch);
      return watch;
    },
  };
});

vi.mock("@/composables/useOrgCredential", () => ({
  useOrgCredential: () => ({ ready: ref(true), pickedName: ref(""), pickToken: vi.fn() }),
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

// A guide page as the Data sources routes declare it: it reads its route and its props, and
// reports through a first-event status when it has one.
let pageReporter: FirstEventReporter | undefined;
const statusShown = ref(true);
const Status = defineComponent({
  setup() {
    const reporter = inject(FIRST_EVENT_REPORTER)!;
    pageReporter = reporter;
    onBeforeUnmount(reporter.attach());
    return () => h("div", { "data-test": "first-event-status" });
  },
});
const Page = defineComponent({
  props: { currOrgIdentifier: String, currUserEmail: String, slug: String, withStatus: Boolean },
  setup(props) {
    const route = useRoute();
    return () =>
      h("div", { "data-test": "page" }, [
        `${String(route.name)}|${props.currOrgIdentifier}|${props.currUserEmail}|${props.slug ?? ""}`,
        props.withStatus && statusShown.value ? h(Status) : null,
      ]);
  },
});
// As an AI integration page: it declares neither the org nor the email.
const PlainPage = defineComponent({
  props: { slug: String },
  setup: () => () => h("div", { "data-test": "plain-page" }),
});
// The real status, remounted by a key, as the RUM page does on a platform switch.
const statusKey = ref("browser");
const KeyedStatusPage = defineComponent({
  setup: () => () => h(FirstEventStatus, { key: statusKey.value, org: "default" }),
});
const Chrome = defineComponent({
  setup: () => () => h("div", { "data-test": "data-sources-chrome" }),
});

const mountGuide = async (name: string) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/onboarding/:path*", name: "onboarding", component: Chrome },
      {
        path: "/ingestion",
        component: Chrome,
        children: [
          {
            path: "logs",
            component: Chrome,
            children: [
              // Lazy, as every Data sources page is.
              { path: "page", name: "page", component: () => Promise.resolve({ default: Page }) },
              {
                path: "status",
                name: "withStatus",
                component: () => Promise.resolve({ default: Page }),
                props: { withStatus: true },
              },
            ],
          },
          {
            path: "ai/openai",
            name: "ai-openai",
            component: () => Promise.resolve({ default: Page }),
            props: { slug: "openai" },
          },
          {
            path: "ai/plain",
            name: "ai-plain",
            component: () => Promise.resolve({ default: PlainPage }),
          },
          { path: "keyed", name: "keyedStatus", component: KeyedStatusPage },
          {
            path: "broken",
            name: "broken",
            component: () =>
              Promise.reject(new Error("Failed to fetch dynamically imported module")),
          },
          { path: "rum", name: "frontendMonitoring", component: Page },
          {
            path: "custom/logs",
            name: "ingestLogs",
            component: Chrome,
            children: [
              {
                path: "curl",
                name: "curl",
                component: () => import("@/components/ingestion/logs/Curl.vue"),
              },
            ],
          },
        ],
      },
    ],
  });
  await router.push("/onboarding/logs/over-http-with-curl");
  const wrapper = mount(OnboardingEmbeddedGuide, {
    props: { route: name },
    global: { plugins: [store, router] },
  });
  await flushPromises();
  return { wrapper, router };
};

describe("OnboardingEmbeddedGuide", () => {
  afterEach(() => {
    store.state.organizationData.rumToken = { rum_token: "" };
    statusShown.value = true;
    statusKey.value = "browser";
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("renders only the guide's own lazy page, with its route and the Data sources props", async () => {
    const { wrapper, router } = await mountGuide("page");
    expect(wrapper.find('[data-test="data-sources-chrome"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="page"]').text()).toBe("page|default|example@gmail.com|");
    // The URL stays on onboarding.
    expect(router.currentRoute.value.name).toBe("onboarding");
  });

  it("passes the props the route declares", async () => {
    const { wrapper } = await mountGuide("ai-openai");
    expect(wrapper.find('[data-test="page"]').text()).toContain("|openai");
  });

  it("reads the RUM token, and generates one for an org that has none", async () => {
    const created = vi.fn();
    global.server.use(
      http.get(`${store.state.API_ENDPOINT}/api/:org/rumtoken`, () =>
        HttpResponse.json({ data: { rum_token: "" } }),
      ),
      http.post(`${store.state.API_ENDPOINT}/api/:org/rumtoken`, () => {
        created();
        return HttpResponse.json({ data: { new_key: "rum-key" } });
      }),
    );
    const { wrapper } = await mountGuide("frontendMonitoring");
    const generate = wrapper.find('[data-test="onboarding-embedded-guide-rum-token"]');
    expect(generate.exists()).toBe(true);
    await generate.trigger("click");
    await flushPromises();
    expect(created).toHaveBeenCalledTimes(1);
    // The event the Data sources page sends for the same button.
    expect(analytics.track).toHaveBeenCalledWith("Button Click", {
      button: "Generate RUM Token",
      user_org: "default",
      user_id: "example@gmail.com",
      page: "Onboarding",
    });
    expect(store.state.organizationData.rumToken.rum_token).toBe("rum-key");
    expect(wrapper.find('[data-test="onboarding-embedded-guide-rum-token"]').exists()).toBe(false);
  });

  it("reports that a page with a first-event status checks for data itself", async () => {
    const { wrapper } = await mountGuide("withStatus");
    expect(wrapper.emitted("status")).toEqual([[true]]);
  });

  it("reports that a page with no status needs the org-wide check", async () => {
    const { wrapper } = await mountGuide("page");
    expect(wrapper.emitted("status")).toEqual([[false]]);
  });

  it("mirrors the page's status state and first record", async () => {
    const { wrapper } = await mountGuide("withStatus");
    const result = {
      streamName: "default",
      streamType: "logs" as const,
      count: 1,
      rangeStart: 1,
      rangeEnd: 2,
    };
    pageReporter!.state("rejected");
    pageReporter!.detected(result);
    expect(wrapper.emitted("state")).toEqual([["rejected"]]);
    expect(wrapper.emitted("received")).toEqual([[result]]);
  });

  it("asks for the org-wide check again when the page's own status goes away", async () => {
    const { wrapper } = await mountGuide("withStatus");
    statusShown.value = false;
    await flushPromises();
    expect(wrapper.emitted("status")).toEqual([[true], [false]]);
    statusShown.value = true;
    await flushPromises();
    expect(wrapper.emitted("status")).toEqual([[true], [false], [true]]);
  });

  it("gives a real Data sources page the signal and test stream its route implies", async () => {
    const { wrapper } = await mountGuide("curl");
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(wrapper.find('[data-test="ingestion-curl-code-block-container"]').exists()).toBe(true);
    const [org, signal, opts] = watchArgs.mock.calls[0] as [
      { value: string },
      { value: string },
      { targetStream: { value: string } },
    ];
    expect([org.value, signal.value, opts.targetStream.value]).toEqual([
      "default",
      "logs",
      "default",
    ]);
    // Its own status reports to the host, so onboarding runs no second check.
    expect(wrapper.emitted("status")).toEqual([[true]]);
  });

  it("keeps counting a status that a key swaps, so the org-wide check never starts", async () => {
    const { wrapper } = await mountGuide("keyedStatus");
    expect(wrapper.emitted("status")).toEqual([[true]]);
    statusKey.value = "react-native";
    await flushPromises();
    expect(wrapper.emitted("status")).toEqual([[true]]);
  });

  // the store holds one token, and the header's org switch stays open in onboarding
  it("keeps the new org's RUM token when the old org's read lands after a switch", async () => {
    let answerOld!: (res: unknown) => void;
    const read = vi
      .spyOn(queryClient, "fetchQuery")
      .mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)) as never);
    const before = store.state.selectedOrganization;
    try {
      store.state.selectedOrganization = { ...before, identifier: "org-a" };
      const { wrapper } = await mountGuide("frontendMonitoring");
      wrapper.unmount();
      store.state.selectedOrganization = { ...before, identifier: "org-b" };
      store.state.organizationData.rumToken = { rum_token: "org-b-token" };

      answerOld({ data: { rum_token: "org-a-token" } });
      await flushPromises();

      expect(store.state.organizationData.rumToken.rum_token).toBe("org-b-token");
    } finally {
      store.state.selectedOrganization = before;
      read.mockRestore();
    }
  });

  it("keeps the new org's RUM token when the old org's generated one lands after a switch", async () => {
    global.server.use(
      http.get(`${store.state.API_ENDPOINT}/api/:org/rumtoken`, () =>
        HttpResponse.json({ data: { rum_token: "" } }),
      ),
    );
    let answerOld!: (res: unknown) => void;
    const create = vi
      .spyOn(apiKeys, "createRUMToken")
      .mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)) as never);
    const before = store.state.selectedOrganization;
    try {
      store.state.selectedOrganization = { ...before, identifier: "org-a" };
      const { wrapper } = await mountGuide("frontendMonitoring");
      await wrapper.find('[data-test="onboarding-embedded-guide-rum-token"]').trigger("click");
      expect(create).toHaveBeenCalledWith("org-a");
      wrapper.unmount();
      store.state.selectedOrganization = { ...before, identifier: "org-b" };
      store.state.organizationData.rumToken = { rum_token: "org-b-token" };

      answerOld({ data: { data: { new_key: "org-a-token" } } });
      await flushPromises();

      expect(store.state.organizationData.rumToken.rum_token).toBe("org-b-token");
    } finally {
      store.state.selectedOrganization = before;
      create.mockRestore();
    }
  });

  // the RUM page keys its card by platform, so a tab switch mounts a new status that starts waiting
  it("drops the old status's result when the page swaps in a new one", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/onboarding/:path*", name: "onboarding", component: Chrome },
        { path: "/ingestion/keyed", name: "keyedStatus", component: KeyedStatusPage },
      ],
    });
    await router.push("/onboarding/frontend/browser");
    const step = resolvePath(buildChoices(gt), ["frontend", "browser"]);
    if (step.step !== "guide") throw new Error("expected a guide");
    const wrapper = mount(OnboardingStepGuide, {
      props: { choice: step.choice, row: step.row, guide: { ...step.guide, route: "keyedStatus" } },
      global: { plugins: [store, router] },
    });
    await flushPromises();
    const explore = () => wrapper.find('[data-test="onboarding-step-guide-explore"]').exists();

    const browser = watches[watches.length - 1];
    browser.result.value = {
      streamName: "_rumdata",
      streamType: "logs",
      count: 1,
      rangeStart: 1,
      rangeEnd: 2,
    };
    browser.state.value = "received";
    await flushPromises();
    expect(explore()).toBe(true);

    statusKey.value = "android";
    await flushPromises();
    expect(watches[watches.length - 1]).not.toBe(browser);
    expect(explore()).toBe(false);
    wrapper.unmount();
  });

  it("passes the org and email only to a page that declares them", async () => {
    const { wrapper } = await mountGuide("ai-plain");
    const root = wrapper.find('[data-test="plain-page"]');
    expect(root.attributes("curr-user-email")).toBeUndefined();
    expect(root.attributes("curr-org-identifier")).toBeUndefined();
  });

  it("says a page that fails to load, links its app page, and still checks for data", async () => {
    const { wrapper, router } = await mountGuide("broken");
    const banner = wrapper.find('[data-test="onboarding-embedded-guide-failed"]');
    expect(banner.text()).toContain("This guide did not load.");
    expect(
      wrapper.find('[data-test="onboarding-embedded-guide-open-app"]').attributes("href"),
    ).toBe(router.resolve({ name: "broken", query: { org_identifier: "default" } }).href);
    expect(wrapper.emitted("status")).toEqual([[false]]);
  });
});

describe("a RUM row inside onboarding", () => {
  const Renderer = defineComponent({
    name: "SetupCardRenderer",
    props: ["content", "subs"],
    setup:
      (_, { slots }) =>
      () =>
        h("div", slots["hero-under-title"]?.()),
  });

  afterEach(() => {
    store.state.organizationData.rumToken = { rum_token: "" };
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it.each([
    ["android", "rumAndroid"],
    ["ios", "rumIOS"],
    ["react-native", "rumReactNative"],
    ["browser", "rum"],
  ])("opens the RUM guide on the %s tab", async (rowId, providerId) => {
    vi.spyOn(queryClient, "fetchQuery").mockResolvedValue({ data: { rum_token: "rum-key" } });
    const step = resolvePath(buildChoices(gt), ["frontend", rowId]);
    if (step.step !== "guide") throw new Error("expected a guide");
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/onboarding/:path*", name: "onboarding", component: Chrome },
        { path: "/ingestion/rum", name: "frontendMonitoring", component: FrontendRumConfig },
      ],
    });
    await router.push(`/onboarding/frontend/${rowId}`);
    const wrapper = mount(OnboardingStepGuide, {
      props: { choice: step.choice, row: step.row, guide: step.guide },
      global: { plugins: [store, router], stubs: { SetupCardRenderer: Renderer } },
    });
    await flushPromises();

    expect(wrapper.findComponent(Renderer).props("content").provider.id).toBe(providerId);
    wrapper.unmount();
  });
});
