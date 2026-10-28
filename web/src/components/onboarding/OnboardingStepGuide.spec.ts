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
import { defineComponent, h, inject, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import FirstEventStatus from "@/components/ingestion/FirstEventStatus.vue";
import { markHeardFromPending } from "@/components/login/heardFrom";
import { getDataSourceCard } from "@/components/ingestion/setupCard/registry";
import { SETUP_STEPS_HOST, type SetupStepInfo } from "@/components/ingestion/setupCard/stepsHost";
import type {
  FirstEventDiagnosis,
  FirstEventResult,
  FirstEventState,
} from "@/composables/firstEvent/useFirstEventWatch";
import i18n from "@/locales";
import { useOrgCredential } from "@/composables/useOrgCredential";
import store from "@/test/unit/helpers/store";
import type { TranslateFn } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { downloadFile } from "@/utils/dom";

import {
  buildChoices,
  type OnboardingChoice,
  type OnboardingGuide,
  type OnboardingRow,
} from "./onboardingChoices";
import OnboardingPreview from "./OnboardingPreview.vue";
import OnboardingStepGuide from "./OnboardingStepGuide.vue";

vi.mock("@/composables/useOrgCredential", () => ({
  useOrgCredential: vi.fn(() => ({
    ready: { value: true },
    pickedName: { value: "default" },
    pickToken: vi.fn(),
  })),
}));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn(async () => true) }));
vi.mock("@/utils/dom", () => ({ downloadFile: vi.fn(() => true) }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

// The real status runs on this watch where a test mounts it; the rest stub the status.
const watch = {
  state: ref<FirstEventState>("waiting"),
  result: ref<FirstEventResult>(),
  diagnosis: ref<FirstEventDiagnosis>(),
  startedAtMs: ref<number>(),
  scope: ref("new-data"),
  troubleshooting: ref(false),
  sinceUs: ref<number>(),
  start: vi.fn(),
  stop: vi.fn(),
  probeNow: vi.fn(),
  troubleshoot: vi.fn(),
};
vi.mock("@/composables/firstEvent/useFirstEventWatch", () => ({
  useFirstEventWatch: () => watch,
}));

// A real snippet with the org token in it, for the token picker tests.
const withSnippet = ref(false);
const snippet = () =>
  withSnippet.value
    ? h(CredentialCodeBlock, { slug: "snippet", content: "token [PASSCODE]" })
    : null;

// A first-event status that reports up through its host, as the card's and a page's do.
const status = (emit: (event: "state" | "received", value: unknown) => void) =>
  h(FirstEventStatus, {
    org: "default",
    onState: (s: FirstEventState) => emit("state", s),
    onDetected: (r: FirstEventResult) => emit("received", r),
  });

// The real card is covered by its own specs; here it only reports its state, its detection and,
// when a test sets them, its steps and its stream to the page.
const cardSteps = ref<SetupStepInfo[]>();
const cardStream = ref<string>();
const CardStub = defineComponent({
  name: "DataSourceSetupCard",
  props: ["slug"],
  emits: ["received", "state"],
  setup(_, { slots, emit }) {
    const host = inject(SETUP_STEPS_HOST, null);
    if (cardSteps.value) host?.setSteps(cardSteps.value);
    if (cardStream.value) host?.setStream(cardStream.value);
    return () => h("div", [slots["hero-under-title"]?.(), snippet(), status(emit)]);
  },
});

// The real page host is covered by its own spec; here it only reports what its page checks.
const pageChecks = ref(false);
const EmbeddedStub = defineComponent({
  name: "OnboardingEmbeddedGuide",
  props: ["route"],
  emits: ["received", "state", "status"],
  setup:
    (_, { emit }) =>
    () =>
      h("div", { "data-test": "embedded-page" }, [snippet(), pageChecks.value && status(emit)]),
});
const focus = vi.fn();
const SelectStub = defineComponent({
  name: "OSelect",
  props: ["modelValue", "options", "label"],
  setup(_, { expose }) {
    expose({ focus });
    return () => h("div", { "data-test": "onboarding-step-guide-token" });
  },
});
const OrgStatusStub = defineComponent({
  name: "FirstEventStatus",
  props: ["org", "signal", "targetStream"],
  emits: ["detected", "state", "copy-command"],
  setup: () => () => h("div", { "data-test": "first-event-status" }),
});

const choices = buildChoices(i18n.global.t as unknown as TranslateFn);
const infra = choices.find((c) => c.id === "infrastructure")!;
const hostRow = infra.rows.find((r) => r.id === "linux-windows-or-macos-host")!;
const linux = hostRow.groups![0].guides.find((g) => g.id === "linux")!;

const backend = choices.find((c) => c.id === "backend")!;
const libraryRow = backend.rows.find((r) => r.id === "add-a-library-to-your-code")!;
const tile = (id: string) => libraryRow.groups![0].guides.find((g) => g.id === id)!;

const logs = choices.find((c) => c.id === "logs")!;
const curlRow = logs.rows.find((r) => r.id === "over-http-with-curl")!;
const curl = {
  choice: logs,
  row: curlRow,
  guide: { id: curlRow.id, name: curlRow.name, route: curlRow.route! },
};

async function mountGuide(
  canInvite = false,
  attachTo?: HTMLElement,
  at: { choice: OnboardingChoice; row: OnboardingRow; guide: OnboardingGuide } = {
    choice: infra,
    row: hostRow,
    guide: linux,
  },
  /** Mounts the real first-event status, on the stubbed watch. */
  realStatus = false,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:any(.*)*", name: "onboarding", component: { render: () => null } }],
  });
  await router.push("/onboarding/infrastructure/linux-windows-or-macos-host/linux");
  return mount(OnboardingStepGuide, {
    props: { ...at, canInvite },
    global: {
      plugins: [store, router],
      stubs: {
        DataSourceSetupCard: CardStub,
        OnboardingEmbeddedGuide: EmbeddedStub,
        ...(realStatus ? {} : { FirstEventStatus: OrgStatusStub }),
        OSelect: SelectStub,
      },
    },
    attachTo,
  });
}

type Guide = Awaited<ReturnType<typeof mountGuide>>;
const card = (w: Guide) => w.findComponent(CardStub);
const navTitles = (w: Guide) =>
  w
    .findAll('[data-test$="-link"]')
    .filter((b) => b.attributes("data-test")!.startsWith("onboarding-guide-rail-"))
    .map((b) => b.text().replace("(done)", "").trim());
const navStatus = (w: Guide, id: string) =>
  w.find(`[data-test="onboarding-guide-rail-${id}-status"]`);
const metrics: FirstEventResult = {
  streamName: "system_cpu_time",
  streamType: "metrics",
  count: 42,
  rangeStart: 1,
  rangeEnd: 2,
};

describe("OnboardingStepGuide", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    watch.state.value = "waiting";
    watch.diagnosis.value = undefined;
    watch.troubleshooting.value = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    pageChecks.value = false;
  });

  it("renders the guide's setup card by its slug and loads the org credential", async () => {
    const w = await mountGuide();
    expect(card(w).props("slug")).toBe("linux");
    expect(useOrgCredential).toHaveBeenCalled();
  });

  it("puts Back at the top of the left column, with no breadcrumb", async () => {
    const w = await mountGuide();
    const aside = w.find("aside");
    expect(aside.find('[data-test="onboarding-step-guide-back"]').exists()).toBe(true);
    expect(w.text()).not.toContain("Infrastructure / Linux, Windows or macOS host");
    await aside.find('[data-test="onboarding-step-guide-back"]').trigger("click");
    expect(w.emitted("back")).toHaveLength(1);
  });

  it("has no side panel: once a source is picked, the page only helps set it up", async () => {
    const card = await mountGuide();
    expect(card.findComponent(OnboardingPreview).exists()).toBe(false);
    const page = await mountGuide(false, undefined, curl);
    expect(page.findComponent(OnboardingPreview).exists()).toBe(false);
  });

  it.each([
    ["java", "Java", "https://opentelemetry.io/docs/languages/java/getting-started/", "Java"],
    [
      "node-js",
      "Node.js",
      "https://opentelemetry.io/docs/languages/js/getting-started/",
      "Node.js",
    ],
    [
      "fastapi",
      "FastAPI",
      "https://opentelemetry.io/docs/languages/python/getting-started/",
      "Python",
    ],
  ])(
    "tells a %s tile what to add and links its OpenTelemetry guide",
    async (id, name, url, docs) => {
      const w = await mountGuide(false, undefined, {
        choice: backend,
        row: libraryRow,
        guide: tile(id),
      });
      expect(card(w).props("slug")).toBe("otlpTraces");
      expect(w.find('[data-test="onboarding-step-guide-language"]').text()).toBe(
        `For ${name}, add the OpenTelemetry SDK, with automatic instrumentation where ${name} has it, then point it at OpenObserve with the settings below.`,
      );
      const link = w.find('[data-test="onboarding-step-guide-language-docs"]');
      expect(link.attributes("href")).toBe(url);
      expect(link.attributes("target")).toBe("_blank");
      expect(link.text()).toBe(`OpenTelemetry ${docs} guide`);
    },
  );

  it("adds no language line to a guide that is not a language tile", async () => {
    const w = await mountGuide();
    expect(w.find('[data-test="onboarding-step-guide-language"]').exists()).toBe(false);
  });

  describe("the step nav", () => {
    afterEach(() => {
      cardSteps.value = undefined;
    });

    it("lists the default steps when the guide reports none, with Explore last", async () => {
      const w = await mountGuide();
      expect(w.find('[data-test="onboarding-guide-rail"] h2').text()).toBe("Set Up Linux");
      expect(navTitles(w)).toEqual([
        "Run the Setup Command",
        "Check Your Data",
        "Explore Your Data",
      ]);
      expect(navStatus(w, "check").text()).toBe("Waiting for data");
    });

    it("mirrors the card's own steps, with the data check last and Explore after it", async () => {
      cardSteps.value = [
        { id: "install", title: "Quick install", done: false, active: true },
        { id: "verify", title: "Check Your Data", done: false, active: false },
      ];
      const w = await mountGuide();
      expect(navTitles(w)).toEqual(["Quick install", "Check Your Data", "Explore Your Data"]);
      expect(navStatus(w, "verify").text()).toBe("Waiting for data");
    });

    it.each([
      ["rejected", "Needs attention"],
      ["no-requests", "Needs attention"],
      ["stopped", "Needs attention"],
      ["waiting", "Waiting for data"],
    ])("shows the %s state on the check step", async (state, label) => {
      const w = await mountGuide();
      card(w).vm.$emit("state", state);
      await flushPromises();
      expect(navStatus(w, "check").text()).toBe(label);
    });

    it("scrolls to a step's place in the guide on click", async () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const w = await mountGuide(false, host);
      await w.find('[data-test="onboarding-guide-rail-run-link"]').trigger("click");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      w.unmount();
      host.remove();
    });

    it("on success, marks the check done and shows Explore Your Data in the guide", async () => {
      const w = await mountGuide();
      card(w).vm.$emit("received", metrics);
      card(w).vm.$emit("state", "received");
      await flushPromises();
      expect(navStatus(w, "check").text()).toBe("Data received");
      const explore = w.find('[data-test="onboarding-step-guide-explore"]');
      expect(explore.text()).toContain("Your data is arriving");
      expect(explore.text()).toContain("42 records arrived in system_cpu_time");
      expect(w.find('[data-test="onboarding-first-data-open"]').text()).toBe(
        "Explore Your Metrics",
      );
    });

    it("asks how the user heard of us once, under Explore, not again in the card's status", async () => {
      markHeardFromPending(store.state.userInfo.email);
      const w = await mountGuide(false, undefined, undefined, true);
      watch.result.value = metrics;
      watch.state.value = "received";
      await flushPromises();
      expect(w.findAll('[data-test="heard-from-prompt"]')).toHaveLength(1);
      expect(
        w
          .find('[data-test="onboarding-step-guide-explore"] [data-test="heard-from-prompt"]')
          .exists(),
      ).toBe(true);
      localStorage.clear();
      watch.result.value = undefined;
    });

    it("leaves the tracing step open when the data check finds only the cluster's logs", async () => {
      cardSteps.value = [
        { id: "install", title: "Quick install", done: false, active: true },
        {
          id: "instrument",
          title: "Trace your apps",
          done: false,
          active: false,
          notProvenByDetect: true,
        },
        { id: "verify", title: "Check Your Data", done: false, active: false },
      ];
      const w = await mountGuide();
      card(w).vm.$emit("received", { ...metrics, streamName: "default", streamType: "logs" });
      card(w).vm.$emit("state", "received");
      await flushPromises();
      const done = (id: string) =>
        w.find(`[data-test="onboarding-guide-rail-${id}"]`).attributes("data-done");
      expect(done("install")).toBe("true");
      expect(done("instrument")).toBe("false");
      expect(done("verify")).toBe("true");
    });

    it("on PostgreSQL metrics, ticks the check and the steps before it, not the monitoring steps after it", async () => {
      const pg = getDataSourceCard(
        "postgres",
        { url: "", org: "", token: "" },
        i18n.global.t as unknown as TranslateFn,
      )!;
      // As the card reports them: the copy steps undone, the check at `verify` in the middle.
      cardSteps.value = pg.steps.map((s, i) => ({
        id: s.id,
        title: s.id,
        done: false,
        active: i === 0,
        notProvenByDetect: s.notProvenByDetect,
        detectionAnchor: s.detectionAnchor,
      }));
      const w = await mountGuide();
      card(w).vm.$emit("received", { ...metrics, streamName: "postgresql_commits" });
      card(w).vm.$emit("state", "received");
      await flushPromises();
      const done = (id: string) =>
        w.find(`[data-test="onboarding-guide-rail-${id}"]`).attributes("data-done");
      expect(navStatus(w, "verify").text()).toBe("Data received");
      expect(navStatus(w, "verify-dbm").exists()).toBe(false);
      const anchor = pg.steps.findIndex((s) => s.detectionAnchor);
      expect(pg.steps[anchor].id).toBe("verify");
      for (const s of pg.steps.slice(0, anchor + 1)) expect(done(s.id)).toBe("true");
      const after = pg.steps.slice(anchor + 1).map((s) => s.id);
      expect(after).toContain("dbm-grant");
      for (const id of after) expect(done(id)).toBe("false");
    });

    it("drops the old result when the card's check starts waiting again", async () => {
      const w = await mountGuide();
      card(w).vm.$emit("received", metrics);
      card(w).vm.$emit("state", "received");
      await flushPromises();
      card(w).vm.$emit("state", "waiting");
      await flushPromises();
      expect(navStatus(w, "check").text()).toBe("Waiting for data");
      expect(w.find('[data-test="onboarding-step-guide-explore"]').exists()).toBe(false);
    });
  });

  describe("the help box", () => {
    it("hides the invite row from a user who cannot invite", async () => {
      const w = await mountGuide(false);
      expect(w.find('[data-test="onboarding-step-guide-invite-row"]').exists()).toBe(false);
    });

    it("asks the view to invite, and offers no guide link to copy", async () => {
      const w = await mountGuide(true);
      await w.find('[data-test="onboarding-step-guide-invite"]').trigger("click");
      expect(w.emitted("invite")).toHaveLength(1);
      expect(w.find('[data-test="onboarding-step-guide-copy-link"]').exists()).toBe(false);
    });

    it("copies the coding agent prompt and downloads the setup file in place", async () => {
      const w = await mountGuide();
      await w.find('[data-test="onboarding-step-guide-agent-copy"]').trigger("click");
      await flushPromises();
      const prompt = vi.mocked(copyToClipboard).mock.calls[0][0] as string;
      expect(prompt).toContain("Set up OpenObserve");
      // The prompt names the key's variable, never the key.
      expect(prompt).toContain("O2_ACCESS_KEY");
      await w.find('[data-test="onboarding-step-guide-agent-download"]').trigger("click");
      expect(downloadFile).toHaveBeenCalledWith(
        "openobserve-setup.md",
        expect.stringContaining("# Set up OpenObserve for this project"),
        "text/markdown",
      );
      expect(w.emitted("agent")).toBeUndefined();
    });

    describe.each([
      ["the setup card's", undefined, undefined],
      ["the page's own", curl, true],
      ["the org-wide", curl, false],
    ])("restarts %s stopped check", (_, at, pageOwnCheck) => {
      afterEach(() => {
        pageChecks.value = false;
        store.state.organizationData.organizationPasscode = "";
      });

      const mountStopped = async () => {
        pageChecks.value = !!pageOwnCheck;
        const w = await mountGuide(false, undefined, at, true);
        if (pageOwnCheck !== undefined) {
          w.findComponent(EmbeddedStub).vm.$emit("status", pageOwnCheck);
          await flushPromises();
        }
        expect(w.findComponent(FirstEventStatus).exists()).toBe(true);
        watch.state.value = "stopped";
        watch.start.mockClear();
        return w;
      };

      it.each([
        ["copying the agent prompt", '[data-test="onboarding-step-guide-agent-copy"]'],
        ["downloading the setup file", '[data-test="onboarding-step-guide-agent-download"]'],
      ])("on %s", async (__, button) => {
        const w = await mountStopped();
        await w.find(button).trigger("click");
        await flushPromises();
        expect(watch.start).toHaveBeenCalledWith("copy");
      });

      it("on copying the agent key", async () => {
        // with no key the block shows a banner, which has nothing to copy
        store.state.organizationData.organizationPasscode = "tok";
        const w = await mountStopped();
        w.find("aside")
          .findComponent(CredentialCodeBlock)
          .findComponent({ name: "OCodeBlock" })
          .vm.$emit("copy", { partial: false });
        await flushPromises();
        expect(watch.start).toHaveBeenCalledWith("copy");
      });
    });

    it("sends the agent prompt and file to the stream the card's input names", async () => {
      cardStream.value = "checkout";
      try {
        const w = await mountGuide(false, undefined, {
          choice: backend,
          row: libraryRow,
          guide: tile("java"),
        });
        await w.find('[data-test="onboarding-step-guide-agent-copy"]').trigger("click");
        await flushPromises();
        expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toContain("stream-name=checkout");
        await w.find('[data-test="onboarding-step-guide-agent-download"]').trigger("click");
        expect(vi.mocked(downloadFile).mock.calls[0][1]).toContain("stream-name=checkout");
      } finally {
        cardStream.value = undefined;
      }
    });

    it.each([
      ["frontend", "react-native"],
      ["frontend", "android"],
      ["frontend", "ios"],
      ["backend", "continuous-profiling"],
    ])("offers no coding agent prompt on the %s %s guide", async (choiceId, rowId) => {
      // The frontend prompt installs the browser SDK and the backend one sets up traces only.
      const choice = buildChoices(i18n.global.t as unknown as TranslateFn, {
        profiling: true,
      }).find((c) => c.id === choiceId)!;
      const row = choice.rows.find((r) => r.id === rowId)!;
      const guide = { id: row.id, name: row.name, route: row.route! };
      const w = await mountGuide(true, undefined, { choice, row, guide });
      expect(w.find('[data-test="onboarding-step-guide-agent-copy"]').exists()).toBe(false);
      expect(w.find('[data-test="onboarding-step-guide-invite"]').exists()).toBe(true);
    });

    it("offers no coding agent prompt on a guide no prompt section covers", async () => {
      const row = infra.rows.find((r) => r.id === "cloud-account")!;
      const guide = row.groups!.flatMap((g) => g.guides).find((g) => g.id === "aws")!;
      const w = await mountGuide(true, undefined, { choice: infra, row, guide });
      expect(w.find('[data-test="onboarding-step-guide-agent-copy"]').exists()).toBe(false);
      expect(w.find('[data-test="onboarding-step-guide-invite"]').exists()).toBe(true);
    });
  });

  describe("a guide with no setup card", () => {
    const mountPage = (attachTo?: HTMLElement) => mountGuide(false, attachTo, curl);
    const page = (w: Awaited<ReturnType<typeof mountGuide>>) => w.findComponent(EmbeddedStub);
    const orgStatus = (w: Awaited<ReturnType<typeof mountGuide>>) => w.findComponent(OrgStatusStub);

    it("shows its Data sources page in the same frame, titled by the guide", async () => {
      const w = await mountPage();
      expect(card(w).exists()).toBe(false);
      expect(page(w).props()).toEqual({ route: "curl" });
      expect(w.find('[data-test="onboarding-step-guide-title"]').text()).toBe(curlRow.name);
      expect(w.find('[data-test="onboarding-step-guide-help"]').exists()).toBe(true);
    });

    it("follows the page's own check and runs no second one", async () => {
      const w = await mountPage();
      page(w).vm.$emit("status", true);
      page(w).vm.$emit("state", "rejected");
      await flushPromises();
      expect(orgStatus(w).exists()).toBe(false);
      expect(navStatus(w, "check").text()).toBe("Needs attention");
      page(w).vm.$emit("received", {
        streamName: "default",
        streamType: "logs",
        count: 3,
        rangeStart: 1,
        rangeEnd: 2,
      });
      await flushPromises();
      expect(w.find('[data-test="onboarding-first-data"]').text()).toContain(
        "3 records arrived in default",
      );
    });

    it("watches the org for any new stream when the page has no check of its own", async () => {
      const w = await mountPage();
      // Nothing runs until the page says whether it checks.
      expect(orgStatus(w).exists()).toBe(false);
      page(w).vm.$emit("status", false);
      await flushPromises();
      expect(orgStatus(w).props()).toEqual({
        org: "default",
        signal: undefined,
        targetStream: undefined,
      });
      orgStatus(w).vm.$emit("detected", {
        streamName: "app",
        streamType: "logs",
        count: 1,
        rangeStart: 1,
        rangeEnd: 2,
      });
      await flushPromises();
      expect(w.find('[data-test="onboarding-first-data"]').exists()).toBe(true);
      // The page's own check took over: the org-wide one stops.
      page(w).vm.$emit("status", true);
      await flushPromises();
      expect(orgStatus(w).exists()).toBe(false);
    });
  });

  describe("the token picker", () => {
    const frontend = choices.find((c) => c.id === "frontend")!;
    const browserRow = frontend.rows.find((r) => r.id === "browser")!;

    beforeEach(() => {
      store.state.organizationData.orgTokens = [{ name: "default", token: "tok", enabled: true }];
      store.state.organizationData.organizationPasscode = "tok";
      withSnippet.value = true;
    });
    afterEach(() => {
      store.state.organizationData.orgTokens = [];
      store.state.organizationData.organizationPasscode = "";
      withSnippet.value = false;
    });

    it.each([
      ["card", undefined],
      ["page", curl],
    ])("stays hidden until a snippet's token button asks for it, on a %s guide", async (_, at) => {
      store.state.organizationData.orgTokens.push({ name: "ci", token: "tok2", enabled: true });
      const w = await mountGuide(false, undefined, at);
      // The snippet already names its token, so a dropdown up front would only add noise.
      expect(w.findComponent(SelectStub).exists()).toBe(false);
      await w.find('[data-test="ingestion-snippet-code-block-token-link"]').trigger("click");
      await flushPromises();
      expect(w.findComponent(SelectStub).props("modelValue")).toBe("default");
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("shows no token button and no picker when the org has one token, as a new org does", async () => {
      const w = await mountGuide(false, undefined, curl);
      expect(w.find('[data-test="ingestion-snippet-code-block-token-link"]').exists()).toBe(false);
      expect(w.findComponent(SelectStub).exists()).toBe(false);
    });

    it("is not offered on the RUM guide, which uses its own token", async () => {
      const w = await mountGuide(false, undefined, {
        choice: frontend,
        row: browserRow,
        guide: { id: browserRow.id, name: browserRow.name, route: browserRow.route! },
      });
      expect(w.findComponent(SelectStub).exists()).toBe(false);
    });
  });

  describe("the title", () => {
    const title = (w: Awaited<ReturnType<typeof mountGuide>>) =>
      w.find('[data-test="onboarding-step-guide-title"]');
    const guideAt = (choiceId: string, rowId: string, guideId?: string) => {
      const choice = choices.find((c) => c.id === choiceId)!;
      const row = choice.rows.find((r) => r.id === rowId)!;
      const guide = guideId
        ? row.groups!.flatMap((g) => g.guides).find((g) => g.id === guideId)!
        : { id: row.id, name: row.name, route: row.route!, cardSlug: row.cardSlug };
      return { choice, row, guide };
    };

    afterEach(() => {
      store.state.organizationData.organizationPasscodeForbidden = false;
      store.state.organizationData.rumToken = { rum_token: "" };
    });

    it("is the setup card's hero, until a forbidden passcode puts a banner in its place", async () => {
      const w = await mountGuide();
      expect(title(w).exists()).toBe(false);
      store.state.organizationData.organizationPasscodeForbidden = true;
      await flushPromises();
      expect(title(w).text()).toBe("Linux");
    });

    it("is the AWS page's own", async () => {
      const w = await mountGuide(
        false,
        undefined,
        guideAt("infrastructure", "cloud-account", "aws"),
      );
      expect(title(w).exists()).toBe(false);
    });

    it("is the RUM card's once the org has a RUM token", async () => {
      const w = await mountGuide(false, undefined, guideAt("frontend", "browser"));
      expect(title(w).exists()).toBe(true);
      store.state.organizationData.rumToken = { rum_token: "rum-key" };
      await flushPromises();
      expect(title(w).exists()).toBe(false);
    });

    it("is an AI page's card hero, or the guide name while a forbidden passcode hides the card", async () => {
      const w = await mountGuide(false, undefined, guideAt("llm", "openai", "openai"));
      expect(title(w).exists()).toBe(false);
      store.state.organizationData.organizationPasscodeForbidden = true;
      await flushPromises();
      expect(title(w).text()).toBe("OpenAI");
    });
  });
});
