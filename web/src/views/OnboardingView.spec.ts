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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { http, HttpResponse } from "msw";
import { defineComponent, h, inject } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";

import { SETUP_CARD_ONBOARDING } from "@/components/ingestion/setupCard/types";
import { markStartPending } from "@/components/onboarding/onboardingFlow";
import { queryClient } from "@/composables/query/queryClient";
import store from "@/test/unit/helpers/store";
import billings from "@/services/billings";
import analytics from "@/services/product_analytics";
import OnboardingView from "./OnboardingView.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/billings", () => ({
  default: { submit_new_user_info: vi.fn().mockResolvedValue({ status: 200 }) },
}));

const empty = { render: () => null };

// Serves the stream lists: `logs` for the logs type, none for the others.
const serveLogStreams = (logs: string[]) =>
  global.server.use(
    http.get(`${store.state.API_ENDPOINT}/api/:org/streams`, ({ request }) => {
      const type = new URL(request.url).searchParams.get("type");
      return HttpResponse.json({ list: type === "logs" ? logs.map((name) => ({ name })) : [] });
    }),
  );

// The guide and the invite dialog have their own specs; here the view only routes to them.
// The stub shows the tracing answer the page provides to a guide's setup card.
const GuideStub = defineComponent({
  name: "OnboardingStepGuide",
  props: ["choice", "row", "guide", "canInvite"],
  emits: ["back", "invite", "agent"],
  setup: () => {
    const presets = inject(SETUP_CARD_ONBOARDING, null);
    return () =>
      h("div", { "data-test": "guide-stub", "data-presets": JSON.stringify(presets?.value) });
  },
});
const AgentStub = defineComponent({
  name: "OnboardingAgentSetup",
  emits: ["back"],
  setup: () => () => h("div", { "data-test": "agent-stub" }),
});
const InviteStub = defineComponent({
  name: "InviteMembersDialog",
  props: ["open"],
  emits: ["update:open", "inviteSent"],
  setup: () => () => h("div", { "data-test": "invite-stub" }),
});

// `inRouterView` renders the page as the route's component, as the app does; route guards need that.
async function mountAt(path: string, { inRouterView = false } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: empty },
      {
        path: "/onboarding/:path*",
        name: "onboarding",
        component: inRouterView ? OnboardingView : empty,
      },
      { path: "/ingest/linux", name: "ingestFromLinux", component: empty },
      { path: "/ingest/k8s", name: "ingestFromKubernetes", component: empty },
      { path: "/ingest/kafka", name: "kafka", component: empty },
      { path: "/ingest/curl", name: "curl", component: empty },
      { path: "/synthetics/add", name: "synthetics-add", component: empty },
      { path: "/iam/users", name: "users", component: empty },
    ],
  });
  await router.push(path);
  const wrapper = mount(inRouterView ? { render: () => h(RouterView) } : OnboardingView, {
    global: {
      plugins: [store, router],
      stubs: {
        OnboardingStepGuide: GuideStub,
        OnboardingAgentSetup: AgentStub,
        InviteMembersDialog: InviteStub,
        // Skip goes into the app header; no header here, so it renders in place.
        teleport: true,
      },
    },
  });
  await flushPromises();
  return { wrapper, router };
}

describe("OnboardingView", () => {
  // A first login sets the marker; only then does leaving onboarding record the start.
  beforeEach(() => {
    markStartPending(store.state.userInfo.email);
    // An org with no streams, so the page stays open.
    global.server.use(
      http.get(`${store.state.API_ENDPOINT}/api/:org/streams`, () =>
        HttpResponse.json({ list: [] }),
      ),
    );
  });

  afterEach(() => {
    queryClient.clear();
    store.state.organizationData.isDataIngested = false;
    vi.mocked(analytics.track).mockClear();
    vi.mocked(billings.submit_new_user_info).mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("keeps an org whose only streams are synthetic checks on onboarding", async () => {
    // The store flag counts synthetic check results as data; the stream lists do not.
    store.state.organizationData.isDataIngested = true;
    serveLogStreams(["synthetics_results"]);
    const { router } = await mountAt("/onboarding");
    expect(router.currentRoute.value.name).toBe("onboarding");
  });

  it("stays on onboarding while the org has no data", async () => {
    const { router, wrapper } = await mountAt("/onboarding");
    expect(router.currentRoute.value.name).toBe("onboarding");
    expect(wrapper.find('[data-test="onboarding-step-choose"]').exists()).toBe(true);
  });

  it("routes Skip to app to home and tracks onboarding_skipped", async () => {
    const { router, wrapper } = await mountAt("/onboarding");
    await wrapper.find('[data-test="onboarding-view-skip"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(vi.mocked(analytics.track).mock.calls[0][0]).toBe("onboarding_skipped");
  });

  it("tracks onboarding_left, not a skip, for a user who came back from the app", async () => {
    localStorage.removeItem(`o2.onboarding.pendingStart.${store.state.userInfo.email}`);
    const { router, wrapper } = await mountAt("/onboarding");
    await wrapper.find('[data-test="onboarding-view-skip"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    expect(analytics.track).toHaveBeenCalledWith("onboarding_left", { step: "choose" });
    expect(analytics.track).not.toHaveBeenCalledWith("onboarding_skipped", expect.anything());
  });

  it("records the start once when the app header takes the user out", async () => {
    const { router } = await mountAt("/onboarding", { inRouterView: true });
    await router.push({ name: "home" });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    expect(billings.submit_new_user_info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(billings.submit_new_user_info).mock.calls[0][1]).toMatchObject({
      skipped: true,
    });
  });

  it("records nothing more on a header exit after Skip", async () => {
    const { router, wrapper } = await mountAt("/onboarding/infrastructure", { inRouterView: true });
    await wrapper.find('[data-test="onboarding-view-skip"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
    expect(billings.submit_new_user_info).toHaveBeenCalledTimes(1);
  });

  it("redirects a bad path to the nearest valid step", async () => {
    const { router } = await mountAt("/onboarding/nope");
    expect(router.currentRoute.value.path).toBe("/onboarding");
  });

  it("keeps a guide with no setup card inside onboarding and records the start once", async () => {
    const { router, wrapper } = await mountAt("/onboarding/logs");
    const push = vi.spyOn(router, "push");
    await wrapper
      .find('[data-test="onboarding-step-rows-row-over-http-with-curl"]')
      .trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding/logs/over-http-with-curl");
    expect(push).not.toHaveBeenCalledWith(expect.objectContaining({ name: "curl" }));
    const guide = wrapper.findComponent(GuideStub);
    expect(guide.props("guide")).toEqual(
      expect.objectContaining({ route: "curl", cardSlug: undefined }),
    );
    expect(billings.submit_new_user_info).toHaveBeenCalledTimes(1);
    expect(billings.submit_new_user_info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ first_source: "http", skipped: false }),
    );
    expect(analytics.track).toHaveBeenCalledWith(
      "onboarding_guide_opened",
      expect.objectContaining({ choice: "logs", route: "curl" }),
    );
    await router.push("/onboarding/logs/over-http-with-curl?x=1");
    await flushPromises();
    expect(billings.submit_new_user_info).toHaveBeenCalledTimes(1);
  });

  it("opens a which-one guide with no setup card in place", async () => {
    const { router, wrapper } = await mountAt("/onboarding/infrastructure/something-else");
    await wrapper.find('[data-test="onboarding-step-which-guide-kafka"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding/infrastructure/something-else/kafka");
    expect(wrapper.findComponent(GuideStub).props("guide").route).toBe("kafka");
  });

  it("does not send the user Home when data arrives while a page guide is open", async () => {
    const { router, wrapper } = await mountAt("/onboarding/logs/over-http-with-curl");
    serveLogStreams(["default"]);
    await queryClient.refetchQueries();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding/logs/over-http-with-curl");
    expect(wrapper.find('[data-test="guide-stub"]').exists()).toBe(true);
  });

  it("keeps a guide with a setup card inside onboarding and records the start once", async () => {
    const { router, wrapper } = await mountAt("/onboarding/infrastructure/databases");
    await wrapper.find('[data-test="onboarding-step-which-guide-postgresql"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding/infrastructure/databases/postgresql");
    const guide = wrapper.findComponent(GuideStub);
    expect(guide.props("guide").cardSlug).toBe("postgres");
    expect(guide.props("canInvite")).toBe(true);
    expect(billings.submit_new_user_info).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith(
      "onboarding_guide_opened",
      expect.objectContaining({ choice: "infrastructure", route: "postgres" }),
    );
    // Moving within the guide does not record again.
    await router.push("/onboarding/infrastructure/databases/postgresql?tab=x");
    await flushPromises();
    expect(billings.submit_new_user_info).toHaveBeenCalledTimes(1);
    guide.vm.$emit("back");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding/infrastructure/databases");
  });

  it("does not send the user Home when data arrives while a guide is open", async () => {
    const { router, wrapper } = await mountAt("/onboarding/infrastructure/kubernetes-cluster");
    serveLogStreams(["default"]);
    await queryClient.refetchQueries();
    await flushPromises();
    expect(store.state.organizationData.isDataIngested).toBe(true);
    expect(router.currentRoute.value.path).toBe("/onboarding/infrastructure/kubernetes-cluster");
    expect(wrapper.find('[data-test="guide-stub"]').exists()).toBe(true);
    // Leaving the guide for another onboarding step lands Home: onboarding is for orgs with no data.
    wrapper.findComponent(GuideStub).vm.$emit("back");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
  });

  it("opens the coding agent page from the guide", async () => {
    const { router, wrapper } = await mountAt("/onboarding/infrastructure/kubernetes-cluster");
    const push = vi.spyOn(router, "push");
    wrapper.findComponent(GuideStub).vm.$emit("agent");
    await flushPromises();
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "onboarding", params: { path: ["agent"] } }),
    );
  });

  it("renders the coding agent page, records the start once and goes back to step 1", async () => {
    const { router, wrapper } = await mountAt("/onboarding");
    await wrapper.find('[data-test="onboarding-step-choose-other-agent"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding/agent");
    expect(wrapper.find('[data-test="agent-stub"]').exists()).toBe(true);
    expect(billings.submit_new_user_info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(billings.submit_new_user_info).mock.calls[0][1]).toEqual({
      from: "",
      company: "",
      first_source: undefined,
      skipped: false,
    });
    expect(
      Object.keys(sessionStorage).some((k) => k.startsWith("connectDataSourcePromptShown")),
    ).toBe(true);
    await router.push("/onboarding/agent?x=1");
    await flushPromises();
    expect(billings.submit_new_user_info).toHaveBeenCalledTimes(1);
    wrapper.findComponent(AgentStub).vm.$emit("back");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding");
  });

  it("returns from the agent page to the page it opened from", async () => {
    const { router, wrapper } = await mountAt("/onboarding/agent");
    // The web history records the previous in-app page here; memory history keeps it empty.
    Object.assign(router.options.history.state, { back: "/traces" });
    const back = vi.spyOn(router, "back").mockImplementation(() => {});
    wrapper.findComponent(AgentStub).vm.$emit("back");
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("sends extra segments after agent back to the agent page", async () => {
    const { router } = await mountAt("/onboarding/agent/cursor");
    expect(router.currentRoute.value.path).toBe("/onboarding/agent");
  });

  it("keeps the agent page open when data arrives", async () => {
    const { router, wrapper } = await mountAt("/onboarding/agent");
    serveLogStreams(["default"]);
    await queryClient.refetchQueries();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding/agent");
    expect(wrapper.find('[data-test="agent-stub"]').exists()).toBe(true);
  });

  it.each([
    ["/onboarding/backend", "onboarding-step-rows-agent-add-a-library-to-your-code"],
    ["/onboarding/backend", "onboarding-step-rows-agent-any-language-with-opentelemetry"],
    ["/onboarding/backend/add-a-library-to-your-code", "onboarding-step-which-agent"],
  ])("opens the coding agent page from %s (%s)", async (path, testId) => {
    const { router, wrapper } = await mountAt(path);
    await wrapper.find(`[data-test="${testId}"]`).trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding/agent");
  });

  it("opens the which-one page for a row with groups and goes back", async () => {
    const { router, wrapper } = await mountAt("/onboarding/infrastructure");
    await wrapper.find('[data-test="onboarding-step-rows-row-databases"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding/infrastructure/databases");
    await wrapper.find('[data-test="onboarding-step-which-back"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/onboarding/infrastructure");
  });

  it("records the pick, mutes the popup and tracks when a guide opens", async () => {
    const { router, wrapper } = await mountAt("/onboarding/infrastructure");
    await wrapper
      .find('[data-test="onboarding-step-rows-row-kubernetes-cluster"]')
      .trigger("click");
    await flushPromises();
    // The Kubernetes row asks about traces first; the start is recorded once the guide opens.
    expect(router.currentRoute.value.path).toBe(
      "/onboarding/infrastructure/kubernetes-cluster/traces",
    );
    expect(billings.submit_new_user_info).not.toHaveBeenCalled();
    expect(analytics.track).not.toHaveBeenCalled();
    await wrapper.find('[data-test="onboarding-step-traces-off"]').trigger("click");
    await flushPromises();
    expect(billings.submit_new_user_info).toHaveBeenCalledTimes(1);
    expect(billings.submit_new_user_info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ first_source: "kubernetes", skipped: false }),
    );
    expect(
      Object.keys(sessionStorage).some((k) => k.startsWith("connectDataSourcePromptShown")),
    ).toBe(true);
    expect(analytics.track).toHaveBeenCalledWith(
      "onboarding_guide_opened",
      expect.objectContaining({ choice: "infrastructure", route: "ingestFromKubernetes" }),
    );
    expect(router.currentRoute.value.path).toBe("/onboarding/infrastructure/kubernetes-cluster");
  });

  it("records nothing for a row that only opens the which-one page", async () => {
    const { wrapper } = await mountAt("/onboarding/infrastructure");
    await wrapper.find('[data-test="onboarding-step-rows-row-databases"]').trigger("click");
    await flushPromises();
    expect(billings.submit_new_user_info).not.toHaveBeenCalled();
  });

  it("records a skip, and still routes home when the call fails", async () => {
    vi.mocked(billings.submit_new_user_info).mockRejectedValueOnce(new Error("down"));
    const { router, wrapper } = await mountAt("/onboarding");
    await wrapper.find('[data-test="onboarding-view-skip"]').trigger("click");
    await flushPromises();
    expect(billings.submit_new_user_info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ skipped: true }),
    );
    expect(router.currentRoute.value.name).toBe("home");
  });

  const noFirstSource = { from: "", company: "", first_source: undefined, skipped: false };

  it("records Synthetic checks with no first source", async () => {
    const zoConfig = store.state.zoConfig;
    store.state.zoConfig = { ...zoConfig, synthetics_enabled: true };
    try {
      const { router, wrapper } = await mountAt("/onboarding");
      await wrapper.find('[data-test="onboarding-step-choose-other-synthetics"]').trigger("click");
      await flushPromises();
      expect(billings.submit_new_user_info).toHaveBeenCalledTimes(1);
      expect(vi.mocked(billings.submit_new_user_info).mock.calls[0][1]).toEqual(noFirstSource);
      expect(router.currentRoute.value.name).toBe("synthetics-add");
    } finally {
      store.state.zoConfig = zoConfig;
    }
  });

  it("opens the invite dialog in place and records the start once an invite is sent", async () => {
    const { router, wrapper } = await mountAt("/onboarding");
    const dialog = wrapper.findComponent(InviteStub);
    expect(dialog.props("open")).toBe(false);
    await wrapper.find('[data-test="onboarding-step-choose-other-invite"]').trigger("click");
    expect(dialog.props("open")).toBe(true);
    expect(router.currentRoute.value.name).toBe("onboarding");
    expect(billings.submit_new_user_info).not.toHaveBeenCalled();
    dialog.vm.$emit("inviteSent");
    await flushPromises();
    expect(vi.mocked(billings.submit_new_user_info).mock.calls[0][1]).toEqual(noFirstSource);
  });

  it.each([true, false])(
    "reads the server's admin flag (%s) and asks for no member list",
    async (isOrgAdmin) => {
      const zoConfig = store.state.zoConfig;
      store.state.zoConfig = { ...zoConfig, is_org_admin: isOrgAdmin };
      const usersRead = vi.fn();
      global.server.use(
        http.get(`${store.state.API_ENDPOINT}/api/:org/users`, () => {
          usersRead();
          return HttpResponse.json({ data: [] });
        }),
      );
      try {
        const { wrapper } = await mountAt("/onboarding");
        const invite = wrapper.find('[data-test="onboarding-step-choose-other-invite"]');
        expect(invite.exists()).toBe(isOrgAdmin);
        expect(wrapper.findComponent(InviteStub).exists()).toBe(isOrgAdmin);
        expect(usersRead).not.toHaveBeenCalled();
      } finally {
        store.state.zoConfig = zoConfig;
      }
    },
  );

  it("offers no invite to a user who is not an admin", async () => {
    global.server.use(
      http.get(`${store.state.API_ENDPOINT}/api/:org/users`, () =>
        HttpResponse.json({ data: [{ email: store.state.userInfo.email, role: "member" }] }),
      ),
    );
    const { wrapper } = await mountAt("/onboarding");
    expect(wrapper.find('[data-test="onboarding-step-choose-other-invite"]').exists()).toBe(false);
    expect(wrapper.findComponent(InviteStub).exists()).toBe(false);
  });

  it("sends a user home when the org has a user stream", async () => {
    global.server.use(
      http.get(`${store.state.API_ENDPOINT}/api/:org/streams`, ({ request }) => {
        const type = new URL(request.url).searchParams.get("type");
        return HttpResponse.json({
          list: type === "logs" ? [{ name: "default" }, { name: "synthetics_results" }] : [],
        });
      }),
    );
    const { router } = await mountAt("/onboarding");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("home");
  });

  it("renders a guide with no setup card for its guide-level URL, and records nothing", async () => {
    const { router, wrapper } = await mountAt("/onboarding/logs/over-http-with-curl");
    expect(router.currentRoute.value.path).toBe("/onboarding/logs/over-http-with-curl");
    expect(wrapper.findComponent(GuideStub).props("guide").route).toBe("curl");
    expect(billings.submit_new_user_info).not.toHaveBeenCalled();
  });

  it("renders a guide with a setup card for its guide-level URL, and records nothing", async () => {
    const { router, wrapper } = await mountAt("/onboarding/infrastructure/kubernetes-cluster");
    expect(router.currentRoute.value.path).toBe("/onboarding/infrastructure/kubernetes-cluster");
    expect(wrapper.findComponent(GuideStub).props("guide").cardSlug).toBe("kubernetes");
    expect(billings.submit_new_user_info).not.toHaveBeenCalled();
  });

  it("tracks the hit's own choice for a match found in another choice", async () => {
    const { router, wrapper } = await mountAt("/onboarding/logs/something-else");
    await wrapper.find('[data-test="onboarding-step-which-search"] input').setValue("kafka");
    await wrapper.find('[data-test="onboarding-step-which-hit"]').trigger("click");
    await flushPromises();
    expect(analytics.track).toHaveBeenCalledWith(
      "onboarding_guide_opened",
      expect.objectContaining({ choice: "infrastructure", route: "kafka" }),
    );
    expect(router.currentRoute.value.path).toBe("/onboarding/infrastructure/something-else/kafka");
  });

  it("does not wait on a request that never answers", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(billings.submit_new_user_info).mockReturnValue(new Promise(() => {}));
      const { router, wrapper } = await mountAt("/onboarding");
      await wrapper.find('[data-test="onboarding-view-skip"]').trigger("click");
      await vi.advanceTimersByTimeAsync(3000);
      expect(router.currentRoute.value.name).toBe("home");

      // A guide opens inside onboarding, so it does not wait at all.
      await router.push("/onboarding/logs");
      await wrapper
        .find('[data-test="onboarding-step-rows-row-over-http-with-curl"]')
        .trigger("click");
      await vi.advanceTimersByTimeAsync(0);
      expect(router.currentRoute.value.path).toBe("/onboarding/logs/over-http-with-curl");
    } finally {
      vi.useRealTimers();
      vi.mocked(billings.submit_new_user_info).mockResolvedValue({ status: 200 } as never);
    }
  });

  describe("the Kubernetes traces step", () => {
    const k8s = "/onboarding/infrastructure/kubernetes-cluster";
    type W = Awaited<ReturnType<typeof mountAt>>["wrapper"];
    const presets = (wrapper: W) =>
      JSON.parse(wrapper.find('[data-test="guide-stub"]').attributes("data-presets")!);
    const click = async (wrapper: W, selector: string) => {
      await wrapper.find(selector).trigger("click");
      await flushPromises();
    };
    const row = (id: string) => `[data-test="onboarding-step-traces-${id}"]`;
    const language = (id: string) => `[data-test="onboarding-step-traces-language-${id}"] button`;
    const submit = (wrapper: W) =>
      wrapper.find('[data-test="onboarding-step-traces-form"]').trigger("submit");

    it.each([
      ["off", { traces: "off" }],
      ["ebpf", { traces: "ebpf" }],
    ])("opens the guide with traces=%s on one click", async (id, query) => {
      const { router, wrapper } = await mountAt(`${k8s}/traces`);
      await click(wrapper, row(id));
      expect(router.currentRoute.value.path).toBe(k8s);
      expect(router.currentRoute.value.query).toMatchObject(query);
      expect(router.currentRoute.value.query.langs).toBeUndefined();
      expect(presets(wrapper)).toEqual({ traces: id, languages: [] });
      expect(analytics.track).toHaveBeenCalledWith("onboarding_trace_choice", {
        traces: id,
        languages: [],
      });
      expect(analytics.track).toHaveBeenCalledWith(
        "onboarding_guide_opened",
        expect.objectContaining({ choice: "infrastructure", route: "ingestFromKubernetes" }),
      );
      expect(billings.submit_new_user_info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ first_source: "kubernetes", skipped: false }),
      );
    });

    it("needs a language for a library, then opens the guide with the ticked ones", async () => {
      const { router, wrapper } = await mountAt(`${k8s}/traces`);
      await click(wrapper, row("library"));
      expect(router.currentRoute.value.path).toBe(`${k8s}/traces`);
      await submit(wrapper);
      await vi.waitFor(() => expect(wrapper.text()).toContain("Pick at least one language."));
      expect(router.currentRoute.value.path).toBe(`${k8s}/traces`);
      expect(analytics.track).not.toHaveBeenCalled();

      await click(wrapper, language("nodejs"));
      await click(wrapper, language("java"));
      await submit(wrapper);
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(k8s));
      await flushPromises();
      expect(router.currentRoute.value.query).toMatchObject({
        traces: "library",
        langs: "java,nodejs",
      });
      expect(presets(wrapper)).toEqual({ traces: "library", languages: ["java", "nodejs"] });
      expect(analytics.track).toHaveBeenCalledWith("onboarding_trace_choice", {
        traces: "library",
        languages: ["java", "nodejs"],
      });
    });

    it("goes back from the guide to the traces step with the answer, then to the rows", async () => {
      const { router, wrapper } = await mountAt(`${k8s}?traces=library&langs=java`);
      wrapper.findComponent(GuideStub).vm.$emit("back");
      await flushPromises();
      expect(router.currentRoute.value.path).toBe(`${k8s}/traces`);
      expect(router.currentRoute.value.query).toMatchObject({ traces: "library", langs: "java" });
      expect(wrapper.find(language("java")).attributes("aria-checked")).toBe("true");
      await click(wrapper, '[data-test="onboarding-step-traces-back"]');
      expect(router.currentRoute.value.path).toBe("/onboarding/infrastructure");
    });

    it.each([
      [`${k8s}/traces`, "onboarding-step-traces"],
      [`${k8s}/traces?traces=library&langs=python`, "onboarding-step-traces-library-panel"],
      [`${k8s}?traces=ebpf`, "guide-stub"],
    ])("renders the same step on a reload of %s, and records nothing", async (url, testId) => {
      const { router, wrapper } = await mountAt(url);
      expect(router.currentRoute.value.fullPath).toBe(url);
      expect(wrapper.find(`[data-test="${testId}"]`).exists()).toBe(true);
      expect(billings.submit_new_user_info).not.toHaveBeenCalled();
    });

    it("gives the guide the answer in its URL, or none", async () => {
      expect(presets((await mountAt(`${k8s}?traces=library&langs=go,java`)).wrapper)).toEqual({
        traces: "library",
        languages: ["go", "java"],
      });
      expect(presets((await mountAt(k8s)).wrapper)).toEqual({ languages: [] });
    });

    it("sends a traces segment on a row that does not ask to its guide", async () => {
      const backend = "/onboarding/backend/kubernetes-workloads-no-code-changes";
      const { router } = await mountAt(`${backend}/traces`);
      expect(router.currentRoute.value.path).toBe(backend);
    });

    it("still opens a Linux host guide directly", async () => {
      const { router, wrapper } = await mountAt(
        "/onboarding/infrastructure/linux-windows-or-macos-host",
      );
      await click(wrapper, '[data-test="onboarding-step-which-guide-linux"]');
      expect(router.currentRoute.value.path).toBe(
        "/onboarding/infrastructure/linux-windows-or-macos-host/linux",
      );
      expect(wrapper.find('[data-test="guide-stub"]').exists()).toBe(true);
    });
  });
});
