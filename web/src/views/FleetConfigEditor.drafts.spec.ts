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
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import { graphToYaml } from "@/components/fleet/editor/editorGraph";
import { SEEDS } from "@/components/fleet/editor/editorGraph.fixtures";
import {
  DRAFT_SIGNED_OUT_KEY,
  draftSessionEnded,
  resumeDraftSession,
} from "@/utils/drafts/draftSession";
import { writeEditorDraft } from "@/utils/drafts/editorDraftStore";
import { signOutThroughLeaveGuards } from "@/utils/drafts/signOutFlow";
import { stopSessionServices } from "@/utils/sessionServices";
import { byTest, leaveButton, clickLeave } from "@/test/unit/helpers/draftDom";
import FleetConfigEditor from "./FleetConfigEditor.vue";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});
vi.mock("@/services/fleet", () => ({
  default: {
    getConfig: vi.fn(),
    getConfigVersion: vi.fn(),
    createConfig: vi.fn(),
    saveConfigDraft: vi.fn(),
    publishConfigVersion: vi.fn(),
    validateConfig: vi.fn(),
    deleteConfig: vi.fn(),
  },
}));
vi.mock("@/utils/sessionServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/sessionServices")>()),
  stopSessionServices: vi.fn(),
}));
vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  invalidateLoginData: vi.fn(),
}));

const VALID = graphToYaml(SEEDS["edge-minimal"]());
const SECRET = "c2VjcmV0";
const SECRET_YAML = [
  "exporters:",
  "  otlphttp:",
  "    headers:",
  `      Authorization: Basic ${SECRET}`,
  "",
].join("\n");

const detail = (id: string, yaml: string) => ({
  id,
  description: "",
  latest_version: 0,
  live_version: null,
  collectors: 0,
  fleets: [],
  updated_at: 1,
  updated_by: "ana@acme.io",
  draft: { yaml, by: "ana@acme.io", at: 1 },
  versions: [],
});

const CodeEditorStub = {
  name: "FleetCodeEditor",
  props: ["code", "language", "filename", "editable"],
  emits: ["update:code"],
  template: '<pre data-test="code-stub">{{ code }}</pre>',
};

const Blank = { render: () => h("div") };

let router: Router;
let wrapper: VueWrapper | null = null;

const mountEditor = async (id: string) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/fleet", name: "fleet", component: Blank },
      { path: "/fleet/configs/:id", name: "fleetConfigEditor", component: FleetConfigEditor },
      { path: "/login", component: Blank },
      { path: "/logout", component: Blank },
    ],
  });
  await router.push({ name: "fleetConfigEditor", params: { id } });
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [i18n, router, store],
        stubs: {
          FleetEditorCanvas: { template: "<div />" },
          FleetCodeEditor: CodeEditorStub,
          FleetComponentPalette: { template: "<div />" },
          FleetNewRolloutDialog: { template: "<div />" },
        },
      },
    },
  );
  await flushPromises();
  return wrapper;
};

const editYaml = async (text: string) => {
  window.dispatchEvent(new Event("pointerdown"));
  const editor = wrapper!.findComponent(FleetConfigEditor);
  (editor.vm as unknown as { setMode: (m: "yaml") => void }).setMode("yaml");
  await flushPromises();
  wrapper!.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", text);
  await flushPromises();
};

const pressEscape = () =>
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );

const traces = (storage: Storage, fleetRelated: (key: string, value: string) => boolean) =>
  Object.keys(storage).filter((key) => fleetRelated(key, storage.getItem(key) ?? ""));

/** Every key the draft store could have written, or that holds the YAML secret; in sessionStorage, anything Fleet's. */
const storedYamlTraces = () => [
  ...traces(
    localStorage,
    (key, value) =>
      (key.startsWith("o2_draft") && key !== DRAFT_SIGNED_OUT_KEY) || value.includes(SECRET),
  ),
  ...traces(
    sessionStorage,
    (key, value) =>
      /draft|fleet/i.test(key) || /fleet|otlphttp/i.test(value) || value.includes(SECRET),
  ),
];

/** Starts a move to another config and waits for its leave guard, without awaiting the move itself. */
const goToOtherConfig = async () => {
  const navigation = router.push({ name: "fleetConfigEditor", params: { id: "other" } });
  await flushPromises();
  return { navigation };
};

describe("FleetConfigEditor leave guard", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_org: string, id: string) => ({ data: detail(id, VALID) }) as never,
    );
    vi.mocked(fleet.saveConfigDraft).mockResolvedValue({ data: { at: 2 } } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    queryClient.clear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    resumeDraftSession();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("never writes the YAML to browser storage while editing, on reload or after leaving", async () => {
    await mountEditor("edge");
    await editYaml(SECRET_YAML);
    window.dispatchEvent(new Event("pagehide"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(storedYamlTraces()).toEqual([]);

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    wrapper!.unmount();
    wrapper = null;
    expect(storedYamlTraces()).toEqual([]);

    await mountEditor("edge");
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(
      (wrapper!.findComponent(FleetConfigEditor).vm as unknown as { yamlText: string }).yamlText,
    ).toBe(VALID);
    await editYaml(SECRET_YAML);
    const { navigation } = await goToOtherConfig();
    clickLeave("o-dialog-neutral-btn");
    await navigation;
    await flushPromises();
    expect(storedYamlTraces()).toEqual([]);
  });

  it("offers Save draft and Discard only, with no browser-kept option", async () => {
    await mountEditor("edge");
    await editYaml(SECRET_YAML);
    const { navigation } = await goToOtherConfig();

    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(leaveButton("editor-draft-leave-save")?.textContent).toContain("Save draft");
    expect(leaveButton("o-dialog-neutral-btn")?.textContent).toContain("Discard");
    expect(leaveButton("o-dialog-secondary-btn")).toBeNull();
    expect(byTest("editor-draft-leave-message")?.textContent?.trim()).toBe(
      "Save your changes as a draft of this configuration, or discard them.",
    );
    pressEscape();
    await navigation;
  });

  it("a new configuration offers only Discard or Stay, and never opens the create dialog", async () => {
    await mountEditor("new");
    await editYaml(SECRET_YAML);
    const first = await goToOtherConfig();

    expect(leaveButton("editor-draft-leave-save")).toBeNull();
    expect(byTest("editor-draft-leave-message")?.textContent?.trim()).toBe(
      "This collector configuration is not created yet. Discard it to leave, or stay on this page.",
    );
    const stay = leaveButton("o-dialog-secondary-btn");
    expect(stay?.textContent?.trim()).toBe("Stay");
    stay!.click();
    await first.navigation;
    expect(router.currentRoute.value.params.id).toBe("new");
    expect(wrapper!.findComponent({ name: "FleetCreateConfigDialog" }).props("open")).toBe(false);

    const second = await goToOtherConfig();
    clickLeave("o-dialog-neutral-btn");
    await second.navigation;
    expect(router.currentRoute.value.params.id).toBe("other");
    expect(fleet.createConfig).not.toHaveBeenCalled();
  });

  it("Save draft saves the server draft, then continues the navigation", async () => {
    await mountEditor("edge");
    await editYaml(SECRET_YAML);
    const { navigation } = await goToOtherConfig();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(fleet.saveConfigDraft).toHaveBeenCalledWith(
      expect.any(String),
      "edge",
      expect.objectContaining({ yaml: SECRET_YAML }),
    );
    expect(router.currentRoute.value.params.id).toBe("other");
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(storedYamlTraces()).toEqual([]);
  });

  it("stays with the edits when the server save fails", async () => {
    vi.mocked(fleet.saveConfigDraft).mockRejectedValue(new Error("down"));
    await mountEditor("edge");
    await editYaml(SECRET_YAML);
    const { navigation } = await goToOtherConfig();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(router.currentRoute.value.params.id).toBe("edge");
    expect(wrapper!.findComponent({ name: "FleetCodeEditor" }).props("code")).toBe(SECRET_YAML);
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });

  it("Discard leaves without saving", async () => {
    await mountEditor("edge");
    await editYaml(SECRET_YAML);
    const navigation = router.push({ name: "fleet" });
    await flushPromises();
    clickLeave("o-dialog-neutral-btn");
    await navigation;
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("fleet");
    expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
    expect(storedYamlTraces()).toEqual([]);
  });

  it("Escape stays on the editor with the edits", async () => {
    await mountEditor("edge");
    await editYaml(SECRET_YAML);
    const navigation = router.push({ name: "fleet" });
    await flushPromises();
    pressEscape();
    await navigation;
    await flushPromises();

    expect(router.currentRoute.value.params.id).toBe("edge");
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(wrapper!.findComponent({ name: "FleetCodeEditor" }).props("code")).toBe(SECRET_YAML);
    expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
  });

  it("a second navigation while the dialog is open takes over the dialog", async () => {
    await mountEditor("edge");
    await editYaml(SECRET_YAML);
    const first = router.push({ name: "fleet" });
    await flushPromises();
    const { navigation: second } = await goToOtherConfig();

    expect(await first).toBeTruthy();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-neutral-btn");
    expect(await second).toBeUndefined();
    await flushPromises();

    expect(router.currentRoute.value.params.id).toBe("other");
    expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
  });

  it("a Discard holds only for its own target, and not past a navigation that throws", async () => {
    await mountEditor("edge");
    await editYaml(SECRET_YAML);
    let throwOnce = true;
    router.beforeEach((to) => {
      if (to.name === "fleet" && throwOnce) {
        throwOnce = false;
        throw new Error("chunk failed");
      }
    });
    const failed = router.push({ name: "fleet" }).catch((err: Error) => err);
    await flushPromises();
    clickLeave("o-dialog-neutral-btn");
    expect(await failed).toBeInstanceOf(Error);
    await flushPromises();
    expect(router.currentRoute.value.params.id).toBe("edge");

    const { navigation } = await goToOtherConfig();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    pressEscape();
    await navigation;
    await flushPromises();

    const again = router.push({ name: "fleet" });
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    pressEscape();
    await again;
    await flushPromises();
    expect(router.currentRoute.value.params.id).toBe("edge");
  });

  describe("sign-out", () => {
    const signOutStore = () => ({
      state: { userInfo: { email: "example@gmail.com" }, zoConfig: { rum: { enabled: true } } },
      dispatch: vi.fn(),
    });

    beforeEach(() => {
      vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    });

    it("asks before the session ends, and Save draft still has the session", async () => {
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      const signingOut = signOutThroughLeaveGuards(router, signOutStore());
      await flushPromises();

      expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
      expect(draftSessionEnded.value).toBe(false);
      expect(stopSessionServices).not.toHaveBeenCalled();
      clickLeave("editor-draft-leave-save");
      await vi.waitFor(() => expect(fleet.saveConfigDraft).toHaveBeenCalled());

      expect(await signingOut).toBe(true);
      expect(stopSessionServices).toHaveBeenCalled();
      expect(vi.mocked(fleet.saveConfigDraft).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(stopSessionServices).mock.invocationCallOrder[0],
      );
      expect(storedYamlTraces()).toEqual([]);
    });

    it("cancels the sign-out when the user stays", async () => {
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      const signingOut = signOutThroughLeaveGuards(router, signOutStore());
      await flushPromises();
      pressEscape();

      expect(await signingOut).toBe(false);
      expect(stopSessionServices).not.toHaveBeenCalled();
      expect(router.currentRoute.value.params.id).toBe("edge");
    });

    it("names the other drafts the sign-out discards behind the info icon", async () => {
      writeEditorDraft(
        { kind: "slo", org: "o1", entityId: null, userEmail: "example@gmail.com" },
        { data: {} },
      );
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      const signingOut = signOutThroughLeaveGuards(router, signOutStore());
      await flushPromises();

      expect(byTest("editor-draft-leave-sign-out")?.getAttribute("aria-label")).toBe(
        "Signing out also discards 1 other unsaved draft in this browser.",
      );
      clickLeave("o-dialog-neutral-btn");
      expect(await signingOut).toBe(true);
    });

    it("a forced sign-out offers Discard only, and the dialog cannot be closed", async () => {
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      const signingOut = signOutThroughLeaveGuards(router, signOutStore(), { forced: true });
      await flushPromises();

      expect(leaveButton("editor-draft-leave-save")).toBeNull();
      expect(leaveButton("o-dialog-secondary-btn")).toBeNull();
      expect(leaveButton("o-dialog-close-btn")).toBeNull();
      pressEscape();
      await flushPromises();
      expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
      clickLeave("o-dialog-neutral-btn");

      expect(await signingOut).toBe(true);
      expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
      expect(stopSessionServices).toHaveBeenCalled();
      expect(storedYamlTraces()).toEqual([]);
    });
  });
});
