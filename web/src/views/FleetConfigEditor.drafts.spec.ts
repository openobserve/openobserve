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
import { setPendingImport } from "@/components/fleet/useFleetApi";
import { toast } from "@/lib/feedback/Toast/useToast";
import { resumeDraftSession } from "@/utils/drafts/draftSession";
import {
  EDITOR_DRAFT_PREFIX,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { signOutThroughLeaveGuards } from "@/utils/drafts/signOutFlow";
import { stopSessionServices } from "@/utils/sessionServices";
import { fillField } from "@/test/unit/helpers/fillField";
import {
  byTest,
  click,
  clickLeave,
  clickRestore,
  leaveButton,
  pressEscape,
} from "@/test/unit/helpers/draftDom";
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

interface FleetDraft {
  yamlText: string;
  mode: "visual" | "yaml";
  selectedPipeline: string | null;
  selection: { nodeId: string; pipelineId: string | null; key: string } | null;
}

interface EditorVm {
  yamlText: string;
  mode: "visual" | "yaml";
  setMode: (mode: "visual" | "yaml") => void;
  deleteConfig: () => Promise<void>;
}

const EMAIL = "example@gmail.com";
const VALID = graphToYaml(SEEDS["edge-minimal"]());
const SECRET = "Basic c2VjcmV0";
const SECRET_YAML = [
  "exporters:",
  "  otlphttp:",
  "    headers:",
  `      Authorization: ${SECRET}`,
  "      X-Env-Token: ${env:O2_TOKEN}",
  "",
].join("\n");
const EXPORTER = "exporter:otlphttp/openobserve";

const scope = (entityId: string | null, userEmail = EMAIL): EditorDraftScope => ({
  kind: "fleet_config",
  org: "default",
  entityId,
  userEmail,
});

const draftOf = (yamlText: string, over: Partial<FleetDraft> = {}): FleetDraft => ({
  yamlText,
  mode: "yaml",
  selectedPipeline: null,
  selection: null,
  ...over,
});

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

const CanvasStub = {
  name: "FleetEditorCanvas",
  props: ["graph", "selectedNode", "selectedPipeline", "issues", "dirty"],
  emits: ["select-node", "select-pipeline", "drop", "add-pipeline", "clear"],
  methods: { reveal: () => undefined },
  template: '<div data-test="canvas-stub" />',
};

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
          FleetEditorCanvas: CanvasStub,
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

const unmount = () => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
};

const editor = () => wrapper!.findComponent(FleetConfigEditor).vm as unknown as EditorVm;

const editYaml = async (text: string) => {
  window.dispatchEvent(new Event("pointerdown"));
  editor().setMode("yaml");
  await flushPromises();
  wrapper!.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", text);
  await flushPromises();
};

/** Opens the OpenObserve exporter's properties, as a click on its canvas node does. */
const selectExporter = async () => {
  wrapper!
    .findComponent({ name: "FleetEditorCanvas" })
    .vm.$emit("select-node", "n1", "metrics", EXPORTER);
  await flushPromises();
};

const storedDraft = (id: string | null) => readEditorDraft<FleetDraft>(scope(id));

/** Starts a move to another config and waits for its leave guard, without awaiting the move itself. */
const goToOtherConfig = async () => {
  const navigation = router.push({ name: "fleetConfigEditor", params: { id: "other" } });
  await flushPromises();
  return { navigation };
};

describe("FleetConfigEditor drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_org: string, id: string) => ({ data: detail(id, VALID) }) as never,
    );
    vi.mocked(fleet.saveConfigDraft).mockResolvedValue({ data: { at: 2 } } as never);
    vi.mocked(fleet.deleteConfig).mockResolvedValue({ status: 204 } as never);
  });

  afterEach(() => {
    unmount();
    queryClient.clear();
    vi.clearAllMocks();
    resumeDraftSession();
    localStorage.clear();
  });

  describe("storing", () => {
    it("keeps a setting filled with no key or pointer event, credentials included, verbatim", async () => {
      await mountEditor("edge");
      await selectExporter();
      await fillField("fleet-component-properties-field-headers.Authorization", SECRET);
      window.dispatchEvent(new Event("pagehide"));

      const draft = storedDraft("edge");
      expect(draft?.data.yamlText).toBe(editor().yamlText);
      expect(draft?.data.yamlText).toContain(SECRET);
      expect(draft?.data.selection).toMatchObject({ key: EXPORTER, pipelineId: "metrics" });
      expect(draft?.redactedPaths ?? []).toEqual([]);
    });

    it("stores YAML typed in the code editor exactly as typed", async () => {
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      window.dispatchEvent(new Event("pagehide"));

      const draft = storedDraft("edge");
      expect(draft?.data).toEqual(draftOf(SECRET_YAML));
      expect(draft?.redactedPaths ?? []).toEqual([]);
    });

    it("keys a new configuration's draft apart from saved ones", async () => {
      await mountEditor("new");
      await editYaml("receivers:\n  otlp: {}\n");
      window.dispatchEvent(new Event("pagehide"));

      expect(storedDraft(null)?.data.yamlText).toBe("receivers:\n  otlp: {}\n");
      expect(storedDraft("edge")).toBeNull();
    });
  });

  describe("restore", () => {
    it("offers the browser copy apart from the server draft, and Escape keeps it for later", async () => {
      writeEditorDraft(scope("edge"), { data: draftOf(SECRET_YAML) });
      await mountEditor("edge");

      const dialog = byTest("editor-draft-restore-dialog");
      expect(dialog?.textContent).toContain("Unsaved local changes");
      expect(dialog?.textContent).not.toContain("Unsaved draft");
      expect(byTest("editor-draft-restore-message")?.textContent).toContain(
        "unsaved changes to this collector configuration",
      );
      expect(byTest("editor-draft-credentials-not-saved")).toBeNull();

      pressEscape();
      await flushPromises();
      expect(byTest("editor-draft-restore-dialog")).toBeNull();
      expect(editor().yamlText).toBe(VALID);
      expect(storedDraft("edge")?.data.yamlText).toBe(SECRET_YAML);
    });

    it("Continue brings back the YAML, its credentials and the open component", async () => {
      writeEditorDraft(scope("edge"), {
        data: draftOf(VALID.replace("${env:O2_TOKEN}", SECRET), {
          mode: "visual",
          selectedPipeline: "metrics",
          selection: { nodeId: "n1", pipelineId: "metrics", key: EXPORTER },
        }),
      });
      await mountEditor("edge");
      click("editor-draft-continue");
      await flushPromises();

      expect(editor().yamlText).toContain(SECRET);
      expect(editor().mode).toBe("visual");
      const field = document.querySelector<HTMLInputElement>(
        '[data-test="fleet-component-properties-field-headers.Authorization"] input',
      );
      expect(field?.value).toBe(SECRET);
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
    });

    it("Start fresh drops the draft and keeps the saved YAML", async () => {
      writeEditorDraft(scope("edge"), { data: draftOf(SECRET_YAML) });
      await mountEditor("edge");
      clickRestore("o-dialog-secondary-btn");
      await flushPromises();

      expect(storedDraft("edge")).toBeNull();
      expect(editor().yamlText).toBe(VALID);
      unmount();

      await mountEditor("edge");
      expect(byTest("editor-draft-restore-dialog")).toBeNull();
    });

    it("applies an imported file to a new configuration once no draft is continued", async () => {
      setPendingImport("receivers:\n  imported: {}\n");
      await mountEditor("new");

      expect(byTest("editor-draft-restore-dialog")).toBeNull();
      expect(editor().yamlText).toBe("receivers:\n  imported: {}\n");
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
    });

    it("tells the user an import was not applied when they continue an earlier new-config draft", async () => {
      writeEditorDraft(scope(null), { data: draftOf("receivers:\n  earlier: {}\n") });
      setPendingImport("receivers:\n  imported: {}\n");
      await mountEditor("new");
      click("editor-draft-continue");
      await flushPromises();

      expect(editor().yamlText).toBe("receivers:\n  earlier: {}\n");
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "info",
          message: expect.stringContaining("imported file was not applied"),
        }),
      );
    });
  });

  describe("leave", () => {
    it("Save saves the server draft without the browser one, then goes to the other config", async () => {
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      window.dispatchEvent(new Event("pagehide"));
      expect(storedDraft("edge")).not.toBeNull();

      const { navigation } = await goToOtherConfig();
      expect(leaveButton("editor-draft-leave-save")?.textContent?.trim()).toBe("Save draft");
      expect(leaveButton("o-dialog-secondary-btn")?.textContent?.trim()).toBe(
        "Keep in this browser",
      );
      expect(byTest("editor-draft-leave-message")?.textContent).not.toContain("as a draft");
      clickLeave("editor-draft-leave-save");
      await navigation;
      await flushPromises();

      expect(fleet.saveConfigDraft).toHaveBeenCalledWith(
        expect.any(String),
        "edge",
        expect.objectContaining({ yaml: SECRET_YAML }),
      );
      expect(router.currentRoute.value.params.id).toBe("other");
      expect(storedDraft("edge")).toBeNull();
    });

    it("stays with the edits and the browser draft when the server save fails", async () => {
      vi.mocked(fleet.saveConfigDraft).mockRejectedValue(new Error("down"));
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      const { navigation } = await goToOtherConfig();
      clickLeave("editor-draft-leave-save");
      await navigation;
      await flushPromises();

      expect(router.currentRoute.value.params.id).toBe("edge");
      expect(editor().yamlText).toBe(SECRET_YAML);
      window.dispatchEvent(new Event("pagehide"));
      expect(storedDraft("edge")?.data.yamlText).toBe(SECRET_YAML);
    });

    it("Keep in this browser leaves with the YAML kept and offers it on return", async () => {
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      const { navigation } = await goToOtherConfig();
      clickLeave("o-dialog-secondary-btn");
      await navigation;
      await flushPromises();

      expect(router.currentRoute.value.params.id).toBe("other");
      expect(storedDraft("edge")?.data.yamlText).toBe(SECRET_YAML);
      expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
      unmount();

      await mountEditor("edge");
      expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    });

    it("Discard leaves and drops the draft", async () => {
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      window.dispatchEvent(new Event("pagehide"));
      const navigation = router.push({ name: "fleet" });
      await flushPromises();
      clickLeave("o-dialog-neutral-btn");
      await navigation;
      await flushPromises();

      expect(router.currentRoute.value.name).toBe("fleet");
      expect(storedDraft("edge")).toBeNull();
      expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
    });

    it("a new configuration offers no Save, so leaving never opens the create dialog", async () => {
      await mountEditor("new");
      await editYaml("receivers:\n  otlp: {}\n");
      const navigation = router.push({ name: "fleet" });
      await flushPromises();

      expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
      expect(leaveButton("editor-draft-leave-save")).toBeNull();
      expect(byTest("editor-draft-leave-message")?.textContent).toContain("not created yet");
      clickLeave("o-dialog-secondary-btn");
      await navigation;
      await flushPromises();

      expect(router.currentRoute.value.name).toBe("fleet");
      expect(byTest("fleet-create-config-dialog")).toBeNull();
      expect(fleet.createConfig).not.toHaveBeenCalled();
      expect(storedDraft(null)?.data.yamlText).toBe("receivers:\n  otlp: {}\n");
    });

    it("Discard on a new configuration leaves and drops its draft", async () => {
      await mountEditor("new");
      await editYaml("receivers:\n  otlp: {}\n");
      window.dispatchEvent(new Event("pagehide"));
      const navigation = router.push({ name: "fleet" });
      await flushPromises();
      clickLeave("o-dialog-neutral-btn");
      await navigation;
      await flushPromises();

      expect(router.currentRoute.value.name).toBe("fleet");
      expect(storedDraft(null)).toBeNull();
      expect(fleet.createConfig).not.toHaveBeenCalled();
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
      expect(editor().yamlText).toBe(SECRET_YAML);
    });

    it("a route update on the same config never asks", async () => {
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      await router.push({ name: "fleetConfigEditor", params: { id: "edge" }, query: { tab: "x" } });
      await flushPromises();

      expect(byTest("editor-draft-leave-dialog")).toBeNull();
      expect(router.currentRoute.value.query.tab).toBe("x");
    });

    it("deleting the config drops every user's draft of it and leaves without asking", async () => {
      writeEditorDraft(scope("edge", "someone@else.io"), { data: draftOf("x: 1\n") });
      writeEditorDraft(scope("other"), { data: draftOf("y: 1\n") });
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      window.dispatchEvent(new Event("pagehide"));

      await editor().deleteConfig();
      await flushPromises();

      expect(router.currentRoute.value.name).toBe("fleet");
      expect(byTest("editor-draft-leave-dialog")).toBeNull();
      expect(storedDraft("edge")).toBeNull();
      expect(readEditorDraft(scope("edge", "someone@else.io"))).toBeNull();
      expect(storedDraft("other")).not.toBeNull();
    });
  });

  describe("sign-out", () => {
    const signOutStore = () => ({
      state: { userInfo: { email: EMAIL }, zoConfig: { rum: { enabled: true } } },
      dispatch: vi.fn(),
    });
    const fleetKeys = () =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith(`${EDITOR_DRAFT_PREFIX}fleet_config`),
      );

    const realLocation = window.location;

    // unstubAllGlobals would also drop the ResizeObserver the test setup stubs, which the properties panel needs.
    beforeEach(() => {
      vi.stubGlobal("location", { ...realLocation, assign: vi.fn() });
    });

    afterEach(() => {
      vi.stubGlobal("location", realLocation);
    });

    it("names the other drafts in the dialog, then discards every collector configuration draft of the user", async () => {
      writeEditorDraft(scope("other"), { data: draftOf("y: 1\n") });
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      window.dispatchEvent(new Event("pagehide"));
      expect(fleetKeys()).toHaveLength(2);

      const signingOut = signOutThroughLeaveGuards(router, signOutStore());
      await flushPromises();
      expect(leaveButton("o-dialog-secondary-btn")).toBeNull();
      expect(byTest("editor-draft-leave-sign-out-others")?.textContent?.trim()).toBe(
        "Signing out also discards 1 other unsaved draft in this browser.",
      );
      clickLeave("o-dialog-neutral-btn");

      expect(await signingOut).toBe(true);
      expect(stopSessionServices).toHaveBeenCalled();
      expect(fleetKeys()).toEqual([]);
      expect(JSON.stringify({ ...localStorage })).not.toContain(SECRET);
    });

    it("Escape cancels the sign-out and keeps the draft", async () => {
      await mountEditor("edge");
      await editYaml(SECRET_YAML);
      window.dispatchEvent(new Event("pagehide"));
      const signingOut = signOutThroughLeaveGuards(router, signOutStore());
      await flushPromises();
      pressEscape();

      expect(await signingOut).toBe(false);
      expect(stopSessionServices).not.toHaveBeenCalled();
      expect(storedDraft("edge")?.data.yamlText).toBe(SECRET_YAML);
    });
  });
});
