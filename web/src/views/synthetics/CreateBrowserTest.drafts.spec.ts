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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import syntheticsService from "@/services/synthetics";
import { queryClient } from "@/composables/query/queryClient";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import type { BrowserCheck, BrowserStep } from "@/types/synthetics";
import { byTest, click, clickLeave, clickRestore, pressEscape } from "@/test/unit/helpers/draftDom";
import { fillField } from "@/test/unit/helpers/fillField";
import CreateBrowserTest from "./CreateBrowserTest.vue";

vi.mock("@/composables/useSyntheticsRecorder", () => ({
  default: () => ({
    detectExtension: vi.fn(() => Promise.resolve(false)),
    replayPhase: { value: "idle" },
    stepResults: new Map(),
    activeStepId: { value: null },
    replayResult: { value: null },
    error: { value: null },
    replay: vi.fn(() => Promise.resolve({})),
    stopReplay: vi.fn(() => Promise.resolve()),
    stopReplayAndForget: vi.fn(),
    registerAutoDetect: vi.fn(),
    cleanup: vi.fn(),
    isReplaying: { value: false },
    hasCapability: () => false,
    extVersion: { value: null },
    capabilities: { value: null },
  }),
}));
vi.mock("@/services/synthetics", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getLocations: vi.fn(() =>
        Promise.resolve({ data: { locations: [], browsers: [], devices: [] } }),
      ),
      create: vi.fn(() => Promise.resolve({ data: { id: "created-1" } })),
      update: vi.fn(() => Promise.resolve({})),
      get: vi.fn(),
      listEnvironments: vi.fn(() => Promise.resolve({ data: [] })),
      listGlobalVariables: vi.fn(() => Promise.resolve({ data: [] })),
      referencedBy: vi.fn(() =>
        Promise.resolve({ data: { references: [], hidden_reference_count: 0 } }),
      ),
    },
  });
});
vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(() => Promise.resolve({ data: [] })) },
  });
});
vi.mock("@/utils/commons", () => ({ getFoldersListByType: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/utils/synthetics/buildPayload", () => ({
  buildCreateBrowserTestPayload: vi.fn((data: unknown) => data),
  mapResponseToBrowserCheck: vi.fn((data: unknown) => data),
}));

const newScope: EditorDraftScope = {
  kind: "synthetic_browser",
  org: "default",
  entityId: null,
  userEmail: "example@gmail.com",
};
const editScope: EditorDraftScope = { ...newScope, entityId: "chk-1" };

const steps: BrowserStep[] = [
  { id: "s1", action: "navigate", name: "Open the shop", value: "https://shop.test" },
] as BrowserStep[];

const savedCheck = (): BrowserCheck =>
  ({
    id: "chk-1",
    name: "Checkout journey",
    url: "https://shop.test",
    enabled: true,
    folder: "default",
    tags: [],
    journey: steps,
    schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
    locations: ["loc-1"],
    notifications: { destinations: [] },
    rum: { collect: false, sessionReplay: false },
    capture: { screenshot: "on-fail", trace: "on-fail" },
    variables: [{ name: "API_KEY", value: "saved-key", secure: true }],
    cookies: [{ name: "sid", value: "saved-cookie", domain: "shop.test" }],
  }) as BrowserCheck;

interface BrowserDraft {
  check: BrowserCheck;
  currentStep: number;
  journeyStepDone: boolean;
}

let router: Router;
let wrapper: VueWrapper | null = null;

const EditorRoute = defineComponent({
  setup: () => () =>
    h(CreateBrowserTest, {
      editId: router.currentRoute.value.params.id
        ? String(router.currentRoute.value.params.id)
        : null,
    }),
});

const stubs = {
  BrowserJourney: {
    name: "BrowserJourney",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: '<div data-test="browser-journey-stub" />',
    methods: {
      stopActiveRecording: () => undefined,
      revealCapNotice: () => undefined,
      deleteSelectedSteps: () => undefined,
      replayUpTo: () => undefined,
      requestReplay: () => undefined,
    },
  },
  CheckVariablesPanel: true,
  AgentSetupDrawer: true,
  JourneyStartPill: true,
  ReplayEnvironmentMenu: true,
  JourneyUsedByPopover: true,
  ExtensionSetupChecklist: true,
};

const mountEditor = async (path = "/synthetics/add", overrides: Record<string, unknown> = {}) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/synthetics", name: "synthetics", component: { render: () => h("div") } },
      { path: "/synthetics/add", name: "synthetics-add", component: EditorRoute },
      { path: "/synthetics/edit/:id", name: "synthetics-edit", component: EditorRoute },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push(path);
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: { plugins: [i18n, router, store], stubs: { ...stubs, ...overrides } },
    },
  );
  await flushPromises();
  return wrapper;
};
const mountEdit = (overrides: Record<string, unknown> = {}) =>
  mountEditor("/synthetics/edit/chk-1?folder=default", overrides);
const remount = async (path?: string) => {
  wrapper?.unmount();
  wrapper = null;
  await mountEditor(path);
};

const journey = () => wrapper!.findComponent({ name: "BrowserJourney" });

/** A recorded or hand-built journey, as the journey editor reports it after the author's input. */
const recordSteps = async (value: BrowserStep[] = steps) => {
  window.dispatchEvent(new Event("pointerdown"));
  journey().vm.$emit("update:modelValue", value);
  await flushPromises();
};

/** Leaves the gate for the journey step, as Build manually does. */
const openJourney = async () => {
  await fillField("synthetics-create-url-input", "https://shop.test");
  await fillField("synthetics-create-name-input", "Checkout journey");
  click("synthetics-create-build-btn");
  await flushPromises();
};

describe("CreateBrowserTest drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
    vi.mocked(syntheticsService.get).mockImplementation(() =>
      Promise.resolve({ data: savedCheck() } as never),
    );
    vi.mocked(syntheticsService.create).mockClear();
    vi.mocked(syntheticsService.update).mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("writes a new journey's draft on pagehide", async () => {
    await mountEditor();
    await openJourney();
    await recordSteps();
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<BrowserDraft>(newScope);
    expect(draft?.data.check).toMatchObject({ name: "Checkout journey", journey: steps });
    expect(draft?.data.currentStep).toBe(1);
  });

  it("an edit never stores a secure variable or a cookie value, and refills them on Continue", async () => {
    await mountEdit();
    await recordSteps([...steps, { ...steps[0], id: "s2", name: "Open again" }]);
    window.dispatchEvent(new Event("pagehide"));

    const stored = JSON.stringify(localStorage);
    expect(stored).not.toContain("saved-key");
    expect(stored).not.toContain("saved-cookie");
    expect(readEditorDraft(editScope)?.redactedPaths).toEqual(
      expect.arrayContaining(["/check/variables/0/value", "/check/cookies/0/value"]),
    );
    wrapper!.unmount();

    await mountEdit();
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
    clickRestore("editor-draft-continue");
    await flushPromises();
    expect(journey().props("modelValue")).toHaveLength(2);
    const restored = (
      wrapper!.findComponent(CreateBrowserTest).vm as unknown as {
        check: BrowserCheck;
      }
    ).check;
    expect(restored.variables?.[0].value).toBe("saved-key");
    expect(restored.cookies?.[0].value).toBe("saved-cookie");
  });

  it("a starting URL carrying a token is never stored and comes back from the saved check", async () => {
    vi.mocked(syntheticsService.get).mockImplementation(() =>
      Promise.resolve({
        data: { ...savedCheck(), url: "https://shop.test/?token=t0k-secret" },
      } as never),
    );
    await mountEdit();
    await recordSteps([...steps, { ...steps[0], id: "s2", name: "Open again" }]);
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.stringify(localStorage)).not.toContain("t0k-secret");
    wrapper!.unmount();

    await mountEdit();
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    clickRestore("editor-draft-continue");
    await flushPromises();
    const restored = (
      wrapper!.findComponent(CreateBrowserTest).vm as unknown as {
        check: BrowserCheck;
      }
    ).check;
    expect(restored.url).toBe("https://shop.test/?token=t0k-secret");
  });

  describe("a journey step that types a password", () => {
    const passwordStep = (value: string): BrowserStep =>
      ({
        id: "s2",
        action: "type",
        name: "Fill in",
        selector: 'input[type="password"]',
        value,
        wire: { id: "s2", action: "fill", selector: 'input[type="password"]', value },
      }) as BrowserStep;

    const editor = () =>
      wrapper!.findComponent(CreateBrowserTest).vm as unknown as {
        check: BrowserCheck;
        journeyFieldIssues: { path: PropertyKey[] }[];
        persist: (after: "stay") => Promise<boolean>;
      };

    it("is never stored, and an unchanged one comes back from the saved check by its step", async () => {
      vi.mocked(syntheticsService.get).mockImplementation(() =>
        Promise.resolve({
          data: { ...savedCheck(), journey: [...steps, passwordStep("saved-pass")] },
        } as never),
      );
      await mountEdit();
      await recordSteps([
        ...steps,
        passwordStep("saved-pass"),
        { ...steps[0], id: "s3", name: "Open again" },
      ]);
      window.dispatchEvent(new Event("pagehide"));
      expect(JSON.stringify(localStorage)).not.toContain("saved-pass");
      expect(readEditorDraft(editScope)?.redactedPaths).toContain("/check/journey/1/value");
      wrapper!.unmount();

      await mountEdit();
      clickRestore("editor-draft-continue");
      await flushPromises();

      expect(editor().check.journey[1].value).toBe("saved-pass");
      expect(editor().check.journey[1].wire?.value).toBe("saved-pass");
    });

    it("a typed one comes back blank and flagged on its step, and blocks Save until re-entered", async () => {
      await mountEditor();
      await openJourney();
      await recordSteps([...steps, passwordStep("hunter2")]);
      window.dispatchEvent(new Event("pagehide"));
      expect(JSON.stringify(localStorage)).not.toContain("hunter2");

      await remount();
      expect(byTest("editor-draft-restore-notices")?.textContent).toContain(
        "Your change to the value typed in step Fill in was not kept.",
      );
      clickRestore("editor-draft-continue");
      await flushPromises();
      expect(editor().check.journey[1].value).toBe("");

      expect(await editor().persist("stay")).toBe(false);
      expect(syntheticsService.create).not.toHaveBeenCalled();
      expect(editor().journeyFieldIssues.map((issue) => issue.path)).toEqual([
        ["journey", 1, "value"],
      ]);
    });
  });

  describe("the setup checklist's reload", () => {
    /** Record with no extension installed: the gate fields go into the query and the setup checklist opens. */
    const leaveForSetup = async () => {
      await mountEditor();
      await fillField("synthetics-create-url-input", "https://shop.test");
      await fillField("synthetics-create-name-input", "Checkout journey");
      click("synthetics-create-record-btn");
      await flushPromises();
      window.dispatchEvent(new Event("pagehide"));
      expect(router.currentRoute.value.query.setup).toBe("1");
      return router.currentRoute.value.fullPath;
    };

    it("drops a draft holding only the gate fields the query carries", async () => {
      const setupPath = await leaveForSetup();
      expect(readEditorDraft(newScope)).not.toBeNull();

      await remount(setupPath);

      expect(byTest("editor-draft-restore-dialog")).toBeNull();
      expect(readEditorDraft(newScope)).toBeNull();
    });

    it("keeps and offers a draft that holds more than the gate fields", async () => {
      const setupPath = await leaveForSetup();
      const draft = readEditorDraft<BrowserDraft>(newScope)!;
      writeEditorDraft(newScope, {
        data: { ...draft.data, check: { ...draft.data.check, tags: ["checkout"] } },
      });

      await remount(setupPath);

      expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
      expect(readEditorDraft<BrowserDraft>(newScope)?.data.check.tags).toEqual(["checkout"]);
    });
  });

  it("Continue reopens the journey a new draft was left on", async () => {
    await mountEditor();
    await openJourney();
    await recordSteps();
    window.dispatchEvent(new Event("pagehide"));

    await remount();
    expect(byTest("editor-draft-restore-message")?.textContent).toContain(
      "unsaved changes to this browser test",
    );
    clickRestore("editor-draft-continue");
    await flushPromises();

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(journey().exists()).toBe(true);
    expect(journey().props("modelValue")).toEqual(steps);
  });

  it("Escape on the restore dialog keeps the draft and the empty gate", async () => {
    writeEditorDraft(newScope, {
      data: { check: { ...savedCheck(), id: undefined }, currentStep: 1, journeyStepDone: true },
    });
    await mountEditor();
    pressEscape();
    await flushPromises();

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(byTest("synthetics-create-url-input")).not.toBeNull();
    expect(journey().exists()).toBe(false);
    expect(readEditorDraft(newScope)).not.toBeNull();
  });

  it("Start fresh drops the draft and stays on the empty gate", async () => {
    writeEditorDraft(newScope, {
      data: { check: { ...savedCheck(), id: undefined }, currentStep: 1, journeyStepDone: true },
    });
    await mountEditor();
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(byTest("synthetics-create-url-input")).not.toBeNull();
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("drafts a name filled with no key or pointer event, and leaving asks", async () => {
    await mountEditor("/synthetics/add", { CheckConfigure: false });
    await openJourney();
    click("synthetics-create-continue-btn");
    await flushPromises();
    await fillField("synthetics-check-details-name-input", "Autofilled journey");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<BrowserDraft>(newScope)?.data).toMatchObject({
      check: { name: "Autofilled journey" },
      currentStep: 2,
    });

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-close-btn");
    await navigation;
    expect(router.currentRoute.value.name).toBe("synthetics-add");
  });

  it("Cancel asks; Keep draft leaves and offers the work on the next visit", async () => {
    await mountEditor();
    await openJourney();
    await recordSteps();

    click("synthetics-create-cancel-btn");
    await flushPromises();
    clickLeave("o-dialog-secondary-btn");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("synthetics"));
    expect(readEditorDraft<BrowserDraft>(newScope)?.data.check.journey).toEqual(steps);
    await remount();
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
  });

  it("Cancel asks; Discard leaves and drops the draft", async () => {
    await mountEditor();
    await openJourney();
    await recordSteps();
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).not.toBeNull();

    click("synthetics-create-cancel-btn");
    await flushPromises();
    clickLeave("o-dialog-neutral-btn");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("synthetics"));
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Save in the leave dialog updates the check, then the leave goes on", async () => {
    await mountEdit();
    await recordSteps([...steps, { ...steps[0], id: "s2", name: "Open again" }]);
    window.dispatchEvent(new Event("pagehide"));

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(syntheticsService.update).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(editScope)).toBeNull();
  });
});
