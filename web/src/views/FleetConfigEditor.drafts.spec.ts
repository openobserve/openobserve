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
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { setPendingImport } from "@/components/fleet/useFleetApi";
import { toast } from "@/lib/feedback/Toast/useToast";
import FleetConfigEditor from "./FleetConfigEditor.vue";

vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>();
  return { ...actual, toast: vi.fn(() => () => {}) };
});

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

const VALID = graphToYaml(SEEDS["edge-minimal"]());
const SECRET_YAML = [
  "exporters:",
  "  otlphttp:",
  "    headers:",
  "      Authorization: Basic c2VjcmV0",
  "      X-Env-Token: ${env:O2_TOKEN}",
  "",
].join("\n");

const yamlPointer = (...path: (string | { l: string } | { i: number })[]) =>
  `/yamlText/${encodeURIComponent(JSON.stringify(path))}`;
const AUTH_POINTER = yamlPointer("exporters", "otlphttp", "headers", "Authorization");

const scope = (entityId: string | null): EditorDraftScope => ({
  kind: "fleet_config",
  org: "default",
  entityId,
  userEmail: "example@gmail.com",
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

const CodeEditorStub = {
  name: "FleetCodeEditor",
  props: ["code", "language", "filename", "editable"],
  emits: ["update:code"],
  template: '<pre data-test="code-stub">{{ code }}</pre>',
};

let router: Router;
let wrapper: VueWrapper | null = null;

const mountEditor = async (id: string) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/fleet", name: "fleet", component: { render: () => h("div") } },
      { path: "/fleet/configs/:id", name: "fleetConfigEditor", component: FleetConfigEditor },
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

const code = () => wrapper!.findComponent({ name: "FleetCodeEditor" });

const editYaml = async (text: string) => {
  window.dispatchEvent(new Event("pointerdown"));
  const editor = wrapper!.findComponent(FleetConfigEditor);
  (editor.vm as unknown as { setMode: (m: "yaml") => void }).setMode("yaml");
  await flushPromises();
  code().vm.$emit("update:code", text);
  await flushPromises();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );

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
    wrapper?.unmount();
    wrapper = null;
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("writes the YAML with literal secrets blanked and env references kept", async () => {
    await mountEditor("edge");
    await editYaml(SECRET_YAML);
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<{ yamlText: string; mode: string }>(scope("edge"));
    expect(draft?.data.yamlText).toContain('Authorization: ""');
    expect(draft?.data.yamlText).toContain("X-Env-Token: ${env:O2_TOKEN}");
    expect(draft?.data.yamlText).not.toContain("c2VjcmV0");
    expect(draft?.data.mode).toBe("yaml");
    expect(draft?.redactedPaths).toEqual([AUTH_POINTER]);
  });

  it("offers local changes under their own title and continues them", async () => {
    writeEditorDraft(scope("edge"), {
      data: {
        yamlText: "receivers:\n  otlp: {}\n",
        mode: "yaml",
        selectedPipeline: null,
        selection: null,
      },
      redactedPaths: ["/yamlText/3"],
    });
    await mountEditor("edge");

    const dialog = byTest("editor-draft-restore-dialog");
    expect(dialog?.textContent).toContain("Unsaved local changes");
    expect(byTest("editor-draft-credentials-not-saved")).not.toBeNull();
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    expect(code().props("code")).toBe("receivers:\n  otlp: {}\n");
  });

  it("continuing an edit draft refills a blanked credential from the saved YAML by key path", async () => {
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_org: string, id: string) => ({ data: detail(id, SECRET_YAML) }) as never,
    );
    await mountEditor("edge");
    const edited = `receivers:\n  otlp: {}\n${SECRET_YAML}`;
    await editYaml(edited);
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(scope("edge"))?.redactedPaths).toEqual([AUTH_POINTER]);
    wrapper!.unmount();

    await mountEditor("edge");
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(code().props("code")).toBe(edited);
  });

  it("continuing an edit draft leaves a changed credential blank instead of refilling the old one", async () => {
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_org: string, id: string) => ({ data: detail(id, SECRET_YAML) }) as never,
    );
    await mountEditor("edge");
    await editYaml(SECRET_YAML.replace("Basic c2VjcmV0", "Basic bmV3"));
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(scope("edge"))?.changedRedactedPaths).toEqual([AUTH_POINTER]);
    wrapper!.unmount();

    await mountEditor("edge");
    expect(byTest("editor-draft-credentials-not-saved")).not.toBeNull();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(code().props("code")).toContain('Authorization: ""');
    expect(code().props("code")).not.toContain("c2VjcmV0");

    vi.mocked(toast).mockClear();
    vi.mocked(fleet.saveConfigDraft).mockClear();
    const editor = wrapper!.findComponent(FleetConfigEditor).vm as unknown as {
      save: () => Promise<boolean>;
    };
    expect(await editor.save()).toBe(false);
    expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: expect.stringContaining("exporters.otlphttp.headers.Authorization"),
      }),
    );

    await editYaml(SECRET_YAML.replace("Basic c2VjcmV0", "Basic dHlwZWQ="));
    expect(await editor.save()).toBe(true);
    expect(fleet.saveConfigDraft).toHaveBeenCalledTimes(1);
  });

  it("blocks Save on a changed secret even when a kept multi-line secret above it is refilled", async () => {
    const saved = [
      "tls:",
      "  private_key: |",
      "    -----BEGIN KEY-----",
      "    abc",
      "headers:",
      '  authorization: "Bearer old"',
      "",
    ].join("\n");
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_org: string, id: string) => ({ data: detail(id, saved) }) as never,
    );
    await mountEditor("edge");
    await editYaml(saved.replace("Bearer old", "Bearer new"));
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();

    await mountEditor("edge");
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(code().props("code")).toContain("-----BEGIN KEY-----");
    expect(code().props("code")).toContain('authorization: ""');

    vi.mocked(toast).mockClear();
    vi.mocked(fleet.saveConfigDraft).mockClear();
    const editor = wrapper!.findComponent(FleetConfigEditor).vm as unknown as {
      save: () => Promise<boolean>;
    };
    expect(await editor.save()).toBe(false);
    expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("headers.authorization") }),
    );
  });

  it("a block list of keys is stored blank, named on restore and blocks Save and Publish until retyped", async () => {
    const saved = [
      "extensions:",
      "  auth:",
      "    api_keys:",
      "      - key-one",
      "      - key-two",
      "    tokens:",
      "      - name: prod",
      "        value: t-prod",
      "",
    ].join("\n");
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_org: string, id: string) => ({ data: detail(id, saved) }) as never,
    );
    await mountEditor("edge");
    await editYaml(`receivers:\n  otlp: {}\n${saved}`);
    window.dispatchEvent(new Event("pagehide"));
    const stored = readEditorDraft<{ yamlText: string }>(scope("edge"))!;
    expect(stored.data.yamlText).not.toMatch(/key-one|key-two|t-prod/);
    expect(stored.data.yamlText).toContain("- name: prod");
    wrapper!.unmount();

    await mountEditor("edge");
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
      "extensions.auth.api_keys[1]",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    const text = String(code().props("code"));
    expect(text).toContain("value: t-prod");
    expect(text).toContain('- ""');
    expect(text).not.toContain(": \n");

    vi.mocked(toast).mockClear();
    const editor = wrapper!.findComponent(FleetConfigEditor).vm as unknown as {
      save: () => Promise<boolean>;
      onPublish: () => void;
      publishOpen: boolean;
    };
    expect(await editor.save()).toBe(false);
    editor.onPublish();
    expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
    expect(editor.publishOpen).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: expect.stringContaining("extensions.auth.api_keys[2]"),
      }),
    );

    await editYaml(text.replace('      - ""\n      - ""', "      - key-one\n      - key-new"));
    expect(await editor.save()).toBe(true);
    expect(fleet.saveConfigDraft).toHaveBeenCalledWith(
      expect.any(String),
      "edge",
      expect.objectContaining({ yaml: expect.stringContaining("value: t-prod") }),
    );
  });

  it("keeps a not-kept secret blocking Save after Continue, another edit, a reload and a second Continue", async () => {
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_org: string, id: string) => ({ data: detail(id, SECRET_YAML) }) as never,
    );
    await mountEditor("edge");
    await editYaml(SECRET_YAML.replace("Basic c2VjcmV0", "Basic bmV3"));
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();

    await mountEditor("edge");
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    const continued = String(code().props("code"));
    expect(continued).toContain('Authorization: ""');
    await editYaml(`receivers:\n  otlp: {}\n${continued}`);
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(scope("edge"))?.changedRedactedPaths).toEqual([AUTH_POINTER]);
    wrapper!.unmount();

    await mountEditor("edge");
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
      "exporters.otlphttp.headers.Authorization",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(code().props("code")).toContain("receivers:\n  otlp: {}");
    expect(code().props("code")).toContain('Authorization: ""');

    vi.mocked(fleet.saveConfigDraft).mockClear();
    const editor = wrapper!.findComponent(FleetConfigEditor).vm as unknown as {
      save: () => Promise<boolean>;
    };
    expect(await editor.save()).toBe(false);
    expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
  });

  it("stores no header_setter value named like a secret, refills it by key and blocks a changed one", async () => {
    const saved = [
      "extensions:",
      "  headers_setter:",
      "    headers:",
      "      - key: Authorization",
      "        value: Bearer abc",
      "      - {key: X-Api-Key, value: k-flow}",
      "",
    ].join("\n");
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_org: string, id: string) => ({ data: detail(id, saved) }) as never,
    );
    await mountEditor("edge");
    await editYaml(saved.replace("k-flow", "k-new"));
    window.dispatchEvent(new Event("pagehide"));
    const stored = readEditorDraft<{ yamlText: string }>(scope("edge"))!;
    expect(stored.data.yamlText).not.toMatch(/Bearer abc|k-flow|k-new/);
    wrapper!.unmount();

    await mountEditor("edge");
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
      "extensions.headers_setter.headers[X-Api-Key].value",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(code().props("code")).toContain("value: Bearer abc");
    expect(code().props("code")).toContain('{key: X-Api-Key, value: ""}');

    vi.mocked(toast).mockClear();
    const editor = wrapper!.findComponent(FleetConfigEditor).vm as unknown as {
      save: () => Promise<boolean>;
    };
    expect(await editor.save()).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("extensions.headers_setter.headers[X-Api-Key].value"),
      }),
    );
  });

  it("redacts CRLF YAML and commented-out secrets, and gives the CRLF text back on Continue", async () => {
    const saved = [
      "exporters:",
      "  otlphttp:",
      "    headers:",
      "      Authorization: Basic c2VjcmV0",
      "",
    ].join("\r\n");
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_org: string, id: string) => ({ data: detail(id, saved) }) as never,
    );
    await mountEditor("edge");
    const edited = `${saved}# password: oldSecret\r\n`;
    await editYaml(edited);
    window.dispatchEvent(new Event("pagehide"));
    const stored = readEditorDraft<{ yamlText: string }>(scope("edge"))!;
    expect(stored.data.yamlText).not.toMatch(/c2VjcmV0|oldSecret/);
    expect(stored.data.yamlText).toContain('Authorization: ""\r\n# password: ""\r\n');
    wrapper!.unmount();

    await mountEditor("edge");
    expect(byTest("editor-draft-credentials-not-saved")).toBeNull();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(code().props("code")).toBe(edited.replace("oldSecret", '""'));
  });

  it("stores no YAML that does not parse when it may hold a secret, and continues from the saved YAML", async () => {
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_org: string, id: string) => ({ data: detail(id, SECRET_YAML) }) as never,
    );
    await mountEditor("edge");
    await editYaml("exporters:\n  otlphttp:\n    headers: [Authorization: Basic bmV3\n");
    window.dispatchEvent(new Event("pagehide"));
    const stored = readEditorDraft<{ yamlText: string }>(scope("edge"))!;
    expect(stored.data.yamlText).toBe("");
    wrapper!.unmount();

    await mountEditor("edge");
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain("YAML");
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(code().props("code")).toBe(SECRET_YAML);
  });

  it("tells the user an import was not applied when they continue an earlier new-config draft", async () => {
    writeEditorDraft(scope(null), {
      data: {
        yamlText: "receivers:\n  earlier: {}\n",
        mode: "yaml",
        selectedPipeline: null,
        selection: null,
      },
    });
    setPendingImport("receivers:\n  imported: {}\n");
    vi.mocked(toast).mockClear();
    await mountEditor("new");
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    expect(code().props("code")).toBe("receivers:\n  earlier: {}\n");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "info",
        message: expect.stringContaining("imported file was not applied"),
      }),
    );
  });

  it("save from the leave dialog saves the server draft, then moves to the other config", async () => {
    await mountEditor("edge");
    await editYaml("receivers:\n  otlp: {}\n");

    const navigation = router.push({ name: "fleetConfigEditor", params: { id: "other" } });
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();

    expect(fleet.saveConfigDraft).toHaveBeenCalledWith(
      expect.any(String),
      "edge",
      expect.objectContaining({ yaml: "receivers:\n  otlp: {}\n" }),
    );
    expect(router.currentRoute.value.params.id).toBe("other");
    expect(readEditorDraft(scope("edge"))).toBeNull();
  });

  it("keep draft on an id change keeps the first config's work", async () => {
    await mountEditor("edge");
    await editYaml("receivers:\n  kept: {}\n");

    const navigation = router.push({ name: "fleetConfigEditor", params: { id: "other" } });
    await flushPromises();
    leaveButton("o-dialog-secondary-btn")?.click();
    await navigation;
    await flushPromises();

    expect(router.currentRoute.value.params.id).toBe("other");
    expect(readEditorDraft<{ yamlText: string }>(scope("edge"))?.data.yamlText).toContain("kept");
  });

  it("deleting the config drops its drafts and leaves without asking", async () => {
    writeEditorDraft(
      { ...scope("edge"), userEmail: "someone@else.io" },
      { data: { yamlText: "x: 1\n", mode: "yaml", selectedPipeline: null, selection: null } },
    );
    await mountEditor("edge");
    await editYaml("receivers:\n  gone: {}\n");
    window.dispatchEvent(new Event("pagehide"));

    await (
      wrapper!.findComponent(FleetConfigEditor).vm as unknown as {
        deleteConfig: () => Promise<void>;
      }
    ).deleteConfig();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("fleet");
    expect(readEditorDraft(scope("edge"))).toBeNull();
    expect(readEditorDraft({ ...scope("edge"), userEmail: "someone@else.io" })).toBeNull();
  });
});
