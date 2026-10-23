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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { watch } from "vue";
import { load } from "js-yaml";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import OForm from "@/lib/forms/Form/OForm.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { CATALOG, graphToYaml, seedGraph } from "@/components/fleet/editor/editorGraph";
import { SEEDS } from "@/components/fleet/editor/editorGraph.fixtures";
import { setPendingImport } from "@/components/fleet/useFleetApi";
import FleetConfigEditor from "./FleetConfigEditor.vue";

const { toastMock, focusMock, revealMock, canvasMounts, confirmMock, routeGuards } = vi.hoisted(
  () => ({
    toastMock: vi.fn(),
    focusMock: vi.fn(),
    revealMock: vi.fn(),
    canvasMounts: vi.fn(),
    confirmMock: vi.fn(),
    routeGuards: { leave: [] as any[], update: [] as any[] },
  }),
);

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

// The editor is mounted outside a router-view, so the guards are captured and called directly.
vi.mock("vue-router", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    onBeforeRouteLeave: (guard: unknown) => routeGuards.leave.push(guard),
    onBeforeRouteUpdate: (guard: unknown) => routeGuards.update.push(guard),
  };
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

const mockViewport = vi.hoisted(() => ({ mdUp: true }));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => !mockViewport.mdUp),
      isTablet: computed(() => false),
      isDesktop: computed(() => mockViewport.mdUp),
      mdUp: computed(() => mockViewport.mdUp),
      lgUp: computed(() => mockViewport.mdUp),
    }),
  };
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
// Connectors have no place on the canvas, so this YAML stays in YAML mode.
const LOSSY = "connectors:\n  count: {}\n";

const detail = (over: Record<string, unknown> = {}) => ({
  id: "edge",
  description: "Edge devices",
  latest_version: 0,
  live_version: null,
  collectors: 0,
  fleets: [],
  updated_at: Date.now(),
  updated_by: "ana@acme.io",
  draft: null,
  versions: [],
  ...over,
});

const draft = (yaml: string) => ({ yaml, by: "ana@acme.io", at: Date.now() });
const published = (version: number) => ({
  version,
  author: "ana@acme.io",
  at: Date.now(),
  message: "",
  live: false,
  state: "published",
});

const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "formId", "primaryButtonLabel", "secondaryButtonLabel"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `<div v-if="open" :data-test="$attrs['data-test']">
      <span data-test="dialog-title">{{ title }}</span>
      <slot />
      <button data-test="dialog-primary" :type="formId ? 'submit' : 'button'" :form="formId || undefined" @click="!formId && $emit('click:primary')">{{ primaryButtonLabel }}</button>
    </div>`,
};

const CanvasStub = {
  name: "FleetEditorCanvas",
  props: ["graph", "selectedNode", "selectedPipeline", "issues", "dirty"],
  setup(_: unknown, { expose }: { expose: (e: Record<string, unknown>) => void }) {
    canvasMounts();
    expose({ focusPipeline: focusMock, reveal: revealMock });
    return {};
  },
  template: '<div data-test="canvas-stub" />',
};

const CodeEditorStub = {
  name: "FleetCodeEditor",
  props: ["code", "language", "filename", "dataTest", "editable"],
  emits: ["update:code"],
  template: '<pre data-test="code-stub">{{ code }}</pre>',
};

const DropdownStub = { template: "<div><slot name='trigger' /><slot /></div>" };
const DropdownItemStub = {
  inheritAttrs: false,
  props: ["variant", "iconLeft", "disabled"],
  emits: ["select"],
  template: `<button :data-test="$attrs['data-test']" :disabled="disabled" @click="$emit('select')"><slot /></button>`,
};

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "fleet", component: { template: "<div />" } },
    { path: "/fleet/configs/:id", name: "fleetConfigEditor", component: { template: "<div />" } },
  ],
});

async function mountEditor(id: string, query: Record<string, string> = {}) {
  await router.push({ name: "fleetConfigEditor", params: { id }, query });
  const wrapper = mount(FleetConfigEditor, {
    attachTo: document.body,
    global: {
      plugins: [i18n, router, store],
      stubs: {
        ODialog: ODialogStub,
        FleetEditorCanvas: CanvasStub,
        FleetCodeEditor: CodeEditorStub,
        FleetComponentPalette: { template: '<div data-test="palette-stub" />' },
        ODropdown: DropdownStub,
        ODropdownItem: DropdownItemStub,
        FleetNewRolloutDialog: {
          name: "FleetNewRolloutDialog",
          props: ["open", "config", "toVersion", "fleetId"],
          template: "<div />",
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const chip = (w: VueWrapper) => w.find('[data-test="fleet-config-editor-mode-chip"]').text();
const code = (w: VueWrapper) => w.findComponent({ name: "FleetCodeEditor" }).props("code");
const toYaml = async (w: VueWrapper) => {
  w.findComponent(OToggleGroup).vm.$emit("update:modelValue", "yaml");
  await flushPromises();
};
const toasts = () => toastMock.mock.calls.map((c) => c[0]);

// The real form submits asynchronously, so wait for the attempt to settle before asserting.
async function submitForm(w: VueWrapper) {
  const f = (w.findComponent(OForm).vm as any).form;
  const attempts = f.state.submissionAttempts;
  await w.find("form").trigger("submit");
  await vi.waitFor(() => {
    expect(f.state.submissionAttempts).toBeGreaterThan(attempts);
    expect(f.state.isSubmitting).toBe(false);
  });
  await flushPromises();
}

async function publish(w: VueWrapper) {
  await w.find('[data-test="fleet-config-editor-publish"]').trigger("click");
  await flushPromises();
  await w
    .find('[data-test="fleet-config-editor-publish-dialog"] [data-test="dialog-primary"]')
    .trigger("click");
  await flushPromises();
}

describe("FleetConfigEditor", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.getConfig).mockResolvedValue({ data: detail({ draft: draft(VALID) }) } as any);
    vi.mocked(fleet.getConfigVersion).mockImplementation(
      async (_o: string, _id: string, v: number) =>
        ({ data: { version: v, yaml: LOSSY, hash: "ab" } }) as any,
    );
    vi.mocked(fleet.saveConfigDraft).mockResolvedValue({ data: { at: 1 } } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  describe("loading", () => {
    it("loads the draft when there is one", async () => {
      vi.mocked(fleet.getConfig).mockResolvedValue({
        data: detail({ draft: draft(LOSSY), latest_version: 2, versions: [published(2)] }),
      } as any);
      wrapper = await mountEditor("edge");
      expect(code(wrapper)).toBe(LOSSY);
      expect(fleet.getConfigVersion).not.toHaveBeenCalled();
    });

    it("loads the latest version's YAML when there is no draft", async () => {
      vi.mocked(fleet.getConfig).mockResolvedValue({
        data: detail({ latest_version: 2, versions: [published(2), published(1)] }),
      } as any);
      wrapper = await mountEditor("edge");
      expect(fleet.getConfigVersion).toHaveBeenCalledWith(expect.any(String), "edge", 2);
      expect(code(wrapper)).toBe(LOSSY);
    });

    it("loads a pending import once on a new config, then the seed", async () => {
      const imported = "receivers:\r\n  otlp: {} # mine\r\n";
      setPendingImport(imported);
      wrapper = await mountEditor("new");
      await toYaml(wrapper);
      expect(code(wrapper)).toBe(imported);
      expect(fleet.getConfig).not.toHaveBeenCalled();
      wrapper.unmount();
      wrapper = await mountEditor("new");
      await toYaml(wrapper);
      expect(code(wrapper)).toBe(graphToYaml(seedGraph()));
    });
  });

  describe("lossy YAML", () => {
    beforeEach(() => {
      vi.mocked(fleet.getConfig).mockResolvedValue({
        data: detail({ draft: draft(LOSSY) }),
      } as any);
    });

    it("opens in YAML mode with Visual disabled and no graph controls", async () => {
      wrapper = await mountEditor("edge");
      expect(wrapper.find('[data-test="code-stub"]').exists()).toBe(true);
      const visual = wrapper
        .findAllComponents(OToggleGroupItem)
        .find((c) => c.props("value") === "visual");
      expect(visual?.props("disabled")).toBe(true);
      expect(wrapper.find('[data-test="palette-stub"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="canvas-stub"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="fleet-config-editor-undo"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="fleet-config-editor-redo"]').exists()).toBe(false);
      await wrapper.find('[data-test="fleet-config-editor-history"]').trigger("click");
      expect(wrapper.find('[data-test="fleet-config-editor-tab-properties"]').exists()).toBe(false);
    });

    it("ignores a palette add while there is no graph", async () => {
      wrapper = await mountEditor("edge");
      expect(() => (wrapper.vm as any).onPaletteAdd(CATALOG[0])).not.toThrow();
      await flushPromises();
      expect(code(wrapper)).toBe(LOSSY);
      expect(chip(wrapper)).toBe("Editing draft");
      expect((wrapper.vm as any).dirty).toBe(false);
      expect(toastMock).not.toHaveBeenCalled();
    });
  });

  it("gives a palette add its own definition instead of reusing a base config reference", async () => {
    const yaml =
      "exporters:\n  debug: {}\nservice:\n  extensions: [health_check]\n  pipelines:\n" +
      "    logs:\n      receivers: [otlp]\n      exporters: [debug]\n" +
      "    metrics:\n      exporters: [debug]\n";
    vi.mocked(fleet.getConfig).mockResolvedValue({ data: detail({ draft: draft(yaml) }) } as any);
    wrapper = await mountEditor("edge");
    (wrapper.vm as any).onDrop("receiver|otlp", "metrics");
    (wrapper.vm as any).onDrop("extension|health_check", null);
    await flushPromises();
    await toYaml(wrapper);
    const doc = load(code(wrapper)) as any;
    expect(doc.receivers).toEqual({ "otlp/2": expect.any(Object) });
    expect(doc.service.pipelines.metrics.receivers).toEqual(["otlp/2"]);
    expect(doc.service.pipelines.logs.receivers).toEqual(["otlp"]);
    expect(doc.extensions).toEqual({ "health_check/2": expect.any(Object) });
    expect(doc.service.extensions).toEqual(["health_check", "health_check/2"]);
  });

  it("saves the loaded YAML unchanged when nothing was edited", async () => {
    const text = "receivers:\n  otlp: {}   \n# trailing comment\n\n";
    vi.mocked(fleet.getConfig).mockResolvedValue({ data: detail({ draft: draft(text) }) } as any);
    wrapper = await mountEditor("edge");
    await wrapper.find('[data-test="fleet-config-editor-save"]').trigger("click");
    await flushPromises();
    expect(fleet.saveConfigDraft).toHaveBeenCalledWith(expect.any(String), "edge", { yaml: text });
  });

  it("creates a new config from the dialog and replaces the route", async () => {
    vi.mocked(fleet.createConfig).mockResolvedValue({ data: detail({ id: "fresh" }) } as any);
    wrapper = await mountEditor("new");
    const replace = vi.spyOn(router, "replace");
    await wrapper.find('[data-test="fleet-config-editor-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-create-config-dialog"]').exists()).toBe(true);
    (wrapper.findComponent(OForm).vm as any).form.setFieldValue("id", "fresh");
    await submitForm(wrapper);
    expect(fleet.createConfig).toHaveBeenCalledWith(expect.any(String), {
      id: "fresh",
      description: "",
      yaml: graphToYaml(seedGraph()),
    });
    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ name: "fleetConfigEditor", params: { id: "fresh" } }),
    );
    replace.mockRestore();
  });

  it("refuses a reserved id in the create dialog", async () => {
    wrapper = await mountEditor("new");
    await wrapper.find('[data-test="fleet-config-editor-save"]').trigger("click");
    await flushPromises();
    (wrapper.findComponent(OForm).vm as any).form.setFieldValue("id", "validate");
    await submitForm(wrapper);
    expect(fleet.createConfig).not.toHaveBeenCalled();
  });

  describe("publish", () => {
    it("toasts the new version and leaves draft mode", async () => {
      vi.mocked(fleet.publishConfigVersion).mockResolvedValue({
        data: { version: 1, warnings: {} },
      } as any);
      vi.mocked(fleet.getConfig)
        .mockResolvedValueOnce({ data: detail({ draft: draft(VALID) }) } as any)
        .mockResolvedValue({
          data: detail({ latest_version: 1, versions: [published(1)] }),
        } as any);
      wrapper = await mountEditor("edge");
      expect(chip(wrapper)).toBe("Editing draft");
      await publish(wrapper);
      expect(fleet.publishConfigVersion).toHaveBeenCalledWith(expect.any(String), "edge", {
        yaml: VALID,
        message: "",
      });
      expect(toasts()).toContainEqual(
        expect.objectContaining({
          variant: "success",
          message: "Published v1. Change a fleet's version when you are ready to send it out.",
        }),
      );
      expect(chip(wrapper)).toBe("Viewing published v1 · not rolled out");
    });

    it("shows the returned warnings in a toast and the issue chip", async () => {
      vi.mocked(fleet.publishConfigVersion).mockResolvedValue({
        data: {
          version: 2,
          warnings: { logs: [{ severity: "warning", text: "debug exporter in use" }] },
        },
      } as any);
      wrapper = await mountEditor("edge");
      await publish(wrapper);
      expect(toasts()).toContainEqual(
        expect.objectContaining({ message: "Published v2 with 1 warning" }),
      );
      expect(wrapper.find('[data-test="fleet-config-editor-validation"]').text()).toContain(
        "1 issue",
      );
    });

    it("awaits the detail refetch, so the chip never reads draft once the edit is clean", async () => {
      vi.mocked(fleet.publishConfigVersion).mockResolvedValue({
        data: { version: 1, warnings: {} },
      } as any);
      let release!: (v: unknown) => void;
      vi.mocked(fleet.getConfig)
        .mockResolvedValueOnce({ data: detail({ draft: draft(LOSSY) }) } as any)
        .mockImplementation(() => new Promise((r) => (release = r)) as any);
      wrapper = await mountEditor("edge");
      wrapper
        .findComponent({ name: "FleetCodeEditor" })
        .vm.$emit("update:code", LOSSY + "# edited\n");
      await flushPromises();
      expect((wrapper.vm as any).dirty).toBe(true);
      const seen: string[] = [];
      const stop = watch(
        () => (wrapper.vm as any).dirty,
        (d) => !d && seen.push((wrapper.vm as any).modeChip.label),
        { flush: "sync" },
      );
      await publish(wrapper);
      expect((wrapper.vm as any).dirty).toBe(true);
      release({ data: detail({ latest_version: 1, versions: [published(1)] }) });
      await flushPromises();
      stop();
      expect(seen).toEqual(["Viewing published v1 · not rolled out"]);
    });

    it("shows 422 issues and focuses the first failing pipeline", async () => {
      vi.mocked(fleet.publishConfigVersion).mockRejectedValue({
        response: {
          status: 422,
          data: {
            code: 422,
            message: "invalid",
            issues: { metrics: [{ severity: "error", text: "no exporter" }] },
          },
        },
      });
      wrapper = await mountEditor("edge");
      await publish(wrapper);
      expect(wrapper.find('[data-test="fleet-config-editor-validation"]').text()).toContain(
        "1 error",
      );
      expect(focusMock).toHaveBeenCalledWith("metrics");
    });

    it("stays in YAML mode and toasts 422 issues for YAML the canvas cannot show", async () => {
      vi.mocked(fleet.getConfig).mockResolvedValue({
        data: detail({ draft: draft(LOSSY) }),
      } as any);
      vi.mocked(fleet.publishConfigVersion).mockRejectedValue({
        response: {
          status: 422,
          data: { issues: { logs: [{ severity: "error", text: "no exporter" }] } },
        },
      });
      wrapper = await mountEditor("edge");
      await publish(wrapper);
      expect(wrapper.find('[data-test="code-stub"]').exists()).toBe(true);
      expect(focusMock).not.toHaveBeenCalled();
      expect(toasts()).toContainEqual({ variant: "error", message: "logs: no exporter" });
    });

    it("toasts the server message on a 422 without issues and keeps the issues", async () => {
      vi.mocked(fleet.publishConfigVersion).mockRejectedValue({
        response: { status: 422, data: { code: 422, message: "Failed to deserialize" } },
      });
      wrapper = await mountEditor("edge");
      await publish(wrapper);
      expect(toasts()).toContainEqual({ variant: "error", message: "Failed to deserialize" });
      expect((wrapper.vm as any).issues).toBeNull();
    });
  });

  describe("unsaved changes", () => {
    const leave = () => routeGuards.leave.at(-1)();
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const edit = async (w: VueWrapper, text: string) => {
      await toYaml(w);
      w.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", text);
      await flushPromises();
    };

    beforeEach(() => {
      routeGuards.leave.length = 0;
      routeGuards.update.length = 0;
      confirmMock.mockResolvedValue(false);
    });

    it("lets the user leave without a prompt when nothing changed", async () => {
      wrapper = await mountEditor("edge");
      expect(await leave()).toBe(true);
      expect(unload()).toBe(false);
      expect(confirmMock).not.toHaveBeenCalled();
    });

    it("asks before leaving or closing with an unsaved edit, and stays on cancel", async () => {
      wrapper = await mountEditor("edge");
      await edit(wrapper, "first: 1\n");
      expect(await leave()).toBe(false);
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unsaved changes", confirmLabel: "Discard changes" }),
      );
      expect(unload()).toBe(true);
      confirmMock.mockResolvedValue(true);
      expect(await leave()).toBe(true);
    });

    it("does not prompt once an edit is undone back to the loaded text", async () => {
      wrapper = await mountEditor("edge");
      await edit(wrapper, "first: 1\n");
      wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", VALID);
      await flushPromises();
      expect(await leave()).toBe(true);
      expect(unload()).toBe(false);
    });

    it("clears the warning once the draft is saved", async () => {
      wrapper = await mountEditor("edge");
      await edit(wrapper, "first: 1\n");
      await wrapper.find('[data-test="fleet-config-editor-save"]').trigger("click");
      await flushPromises();
      expect(fleet.saveConfigDraft).toHaveBeenCalled();
      expect(await leave()).toBe(true);
      expect(unload()).toBe(false);
    });

    it("clears the warning once the edit is published", async () => {
      vi.mocked(fleet.publishConfigVersion).mockResolvedValue({
        data: { version: 2, warnings: {} },
      } as any);
      wrapper = await mountEditor("edge");
      await edit(wrapper, VALID + "# edited\n");
      await publish(wrapper);
      expect(fleet.publishConfigVersion).toHaveBeenCalled();
      expect(await leave()).toBe(true);
    });

    it("leaves without a prompt after deleting the config", async () => {
      vi.mocked(fleet.deleteConfig).mockResolvedValue({ status: 204 } as any);
      wrapper = await mountEditor("edge");
      await edit(wrapper, "first: 1\n");
      let allowed: unknown;
      const push = vi.spyOn(router, "push").mockImplementation(async () => {
        allowed = await leave();
      });
      await wrapper.find('[data-test="fleet-config-editor-delete"]').trigger("click");
      await flushPromises();
      await wrapper
        .find('[data-test="fleet-config-editor-delete-dialog"] [data-test="dialog-primary"]')
        .trigger("click");
      await flushPromises();
      expect(push).toHaveBeenCalled();
      expect(allowed).toBe(true);
      expect(confirmMock).not.toHaveBeenCalled();
      push.mockRestore();
    });

    it("moves to a newly saved config without a prompt", async () => {
      vi.mocked(fleet.createConfig).mockResolvedValue({ data: detail({ id: "fresh" }) } as any);
      wrapper = await mountEditor("new");
      await edit(wrapper, "first: 1\n");
      let allowed: unknown;
      const replace = vi.spyOn(router, "replace").mockImplementation(async () => {
        allowed = await routeGuards.update.at(-1)(
          { params: { id: "fresh" } },
          { params: { id: "new" } },
        );
      });
      await wrapper.find('[data-test="fleet-config-editor-save"]').trigger("click");
      await flushPromises();
      (wrapper.findComponent(OForm).vm as any).form.setFieldValue("id", "fresh");
      await submitForm(wrapper);
      expect(replace).toHaveBeenCalled();
      expect(allowed).toBe(true);
      expect(confirmMock).not.toHaveBeenCalled();
      replace.mockRestore();
    });

    it("removes its beforeunload listener on unmount", async () => {
      const add = vi.spyOn(window, "addEventListener");
      const remove = vi.spyOn(window, "removeEventListener");
      wrapper = await mountEditor("edge");
      const handler = add.mock.calls.find(([type]) => type === "beforeunload")?.[1];
      expect(handler).toBeTypeOf("function");
      wrapper.unmount();
      expect(remove).toHaveBeenCalledWith("beforeunload", handler);
      add.mockRestore();
      remove.mockRestore();
    });

    it("does not mark another config saved when an earlier save replies late", async () => {
      vi.mocked(fleet.getConfig).mockImplementation(
        async (_o: string, cid: string) =>
          ({ data: detail({ id: cid, draft: draft(VALID) }) }) as any,
      );
      let release!: (v: unknown) => void;
      vi.mocked(fleet.saveConfigDraft).mockReturnValue(new Promise((r) => (release = r)) as any);
      wrapper = await mountEditor("edge");
      await edit(wrapper, "first: 1\n");
      await wrapper.find('[data-test="fleet-config-editor-save"]').trigger("click");
      await flushPromises();
      await router.push({ name: "fleetConfigEditor", params: { id: "other" } });
      await flushPromises();
      await edit(wrapper, "first: 1\n");
      release({ data: { at: 1 } });
      await flushPromises();
      expect(await leave()).toBe(false);
      expect(confirmMock).toHaveBeenCalled();
    });

    it("does not mark another config saved when an earlier publish replies late", async () => {
      vi.mocked(fleet.getConfig).mockImplementation(
        async (_o: string, cid: string) =>
          ({ data: detail({ id: cid, draft: draft(VALID) }) }) as any,
      );
      let release!: (v: unknown) => void;
      vi.mocked(fleet.publishConfigVersion).mockReturnValue(
        new Promise((r) => (release = r)) as any,
      );
      wrapper = await mountEditor("edge");
      await edit(wrapper, "first: 1\n");
      await publish(wrapper);
      await router.push({ name: "fleetConfigEditor", params: { id: "other" } });
      await flushPromises();
      await edit(wrapper, "first: 1\n");
      release({ data: { version: 2, warnings: {} } });
      await flushPromises();
      expect(await leave()).toBe(false);
      expect(confirmMock).toHaveBeenCalled();
    });

    it("ignores a trailing newline the code editor trims", async () => {
      expect(VALID.endsWith("\n")).toBe(true);
      wrapper = await mountEditor("edge");
      await edit(wrapper, "first: 1\n");
      wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", VALID.trimEnd());
      await flushPromises();
      expect(await leave()).toBe(true);
      expect(confirmMock).not.toHaveBeenCalled();
    });

    it("counts an imported file as unsaved", async () => {
      setPendingImport("receivers:\n  otlp: {}\n");
      wrapper = await mountEditor("new");
      expect(await leave()).toBe(false);
      expect(confirmMock).toHaveBeenCalled();
      expect(unload()).toBe(true);
    });

    it("asks only when the route moves to another config", async () => {
      wrapper = await mountEditor("edge");
      await edit(wrapper, "first: 1\n");
      const update = routeGuards.update.at(-1);
      expect(update({ params: { id: "edge" } }, { params: { id: "edge" } })).toBe(true);
      expect(confirmMock).not.toHaveBeenCalled();
      expect(await update({ params: { id: "other" } }, { params: { id: "edge" } })).toBe(false);
      expect(confirmMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("before the config has loaded", () => {
    it("neither saves nor publishes", async () => {
      vi.mocked(fleet.getConfig).mockReturnValue(new Promise(() => {}) as any);
      wrapper = await mountEditor("edge");
      const save = wrapper.find('[data-test="fleet-config-editor-save"]');
      const publishBtn = wrapper.find('[data-test="fleet-config-editor-publish"]');
      expect(save.attributes("disabled")).toBeDefined();
      expect(publishBtn.attributes("disabled")).toBeDefined();
      await (wrapper.vm as any).save();
      (wrapper.vm as any).onPublish();
      await (wrapper.vm as any).confirmPublish();
      await (wrapper.vm as any).validate();
      await flushPromises();
      expect(fleet.saveConfigDraft).not.toHaveBeenCalled();
      expect(fleet.publishConfigVersion).not.toHaveBeenCalled();
      expect(fleet.validateConfig).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="fleet-config-editor-publish-dialog"]').exists()).toBe(false);
    });

    it("toasts a failed version load instead of showing an empty editor", async () => {
      vi.mocked(fleet.getConfig).mockResolvedValue({
        data: detail({ latest_version: 2, versions: [published(2)] }),
      } as any);
      vi.mocked(fleet.getConfigVersion).mockRejectedValue({
        response: { status: 500, data: { code: 500, message: "storage down" } },
      });
      wrapper = await mountEditor("edge");
      expect(toasts()).toContainEqual({ variant: "error", message: "storage down" });
      expect(
        wrapper.find('[data-test="fleet-config-editor-save"]').attributes("disabled"),
      ).toBeDefined();
    });
  });

  it("toasts and goes back to the list when the config does not exist", async () => {
    vi.mocked(fleet.getConfig).mockRejectedValue({
      response: { status: 404, data: { code: 404, message: "not found" } },
    });
    const push = vi.spyOn(router, "push");
    wrapper = await mountEditor("ghost");
    expect(toasts()).toContainEqual({
      variant: "error",
      message: "Configuration ghost was not found",
    });
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "fleet" }));
    push.mockRestore();
  });

  it("keeps edits typed while a draft save is in flight", async () => {
    let release!: (v: unknown) => void;
    vi.mocked(fleet.saveConfigDraft).mockReturnValue(new Promise((r) => (release = r)) as any);
    wrapper = await mountEditor("edge");
    await toYaml(wrapper);
    const editor = wrapper.findComponent({ name: "FleetCodeEditor" });
    editor.vm.$emit("update:code", "first: 1\n");
    await flushPromises();
    await wrapper.find('[data-test="fleet-config-editor-save"]').trigger("click");
    editor.vm.$emit("update:code", "second: 2\n");
    await flushPromises();
    release({ data: { at: 1 } });
    await flushPromises();
    expect(fleet.saveConfigDraft).toHaveBeenCalledWith(expect.any(String), "edge", {
      yaml: "first: 1\n",
    });
    expect((wrapper.vm as any).dirty).toBe(true);
    expect(chip(wrapper)).toBe("Editing draft");
  });

  it("keeps edits typed while a publish refetch is in flight", async () => {
    vi.mocked(fleet.publishConfigVersion).mockResolvedValue({
      data: { version: 1, warnings: {} },
    } as any);
    let release!: (v: unknown) => void;
    vi.mocked(fleet.getConfig)
      .mockResolvedValueOnce({ data: detail({ draft: draft(LOSSY) }) } as any)
      .mockImplementation(() => new Promise((r) => (release = r)) as any);
    wrapper = await mountEditor("edge");
    await publish(wrapper);
    wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", "later: 1\n");
    await flushPromises();
    release({ data: detail({ latest_version: 1, versions: [published(1)] }) });
    await flushPromises();
    expect((wrapper.vm as any).dirty).toBe(true);
    expect(chip(wrapper)).toBe("Editing draft");
  });

  it("leaves the Properties tab when a YAML edit makes the graph unavailable", async () => {
    wrapper = await mountEditor("edge");
    (wrapper.vm as any).openPanel("properties");
    await flushPromises();
    expect((wrapper.vm as any).panelTab).toBe("properties");
    await toYaml(wrapper);
    wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", LOSSY);
    await flushPromises();
    expect((wrapper.vm as any).panelTab).toBe("history");
    expect(wrapper.find('[data-test="fleet-config-history"]').exists()).toBe(true);
  });

  it("disables Save while a draft save is in flight", async () => {
    let release!: (v: unknown) => void;
    vi.mocked(fleet.saveConfigDraft).mockReturnValue(new Promise((r) => (release = r)) as any);
    wrapper = await mountEditor("edge");
    const btn = wrapper.find('[data-test="fleet-config-editor-save"]');
    await btn.trigger("click");
    await flushPromises();
    expect(btn.attributes("disabled")).toBeDefined();
    await (wrapper.vm as any).save();
    expect(fleet.saveConfigDraft).toHaveBeenCalledTimes(1);
    release({ data: { at: 1 } });
    await flushPromises();
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("keeps the draft chip after saving a published config until the fresh detail lands", async () => {
    let release!: (v: unknown) => void;
    vi.mocked(fleet.getConfig)
      .mockResolvedValueOnce({
        data: detail({ latest_version: 1, versions: [published(1)] }),
      } as any)
      .mockImplementation(() => new Promise((r) => (release = r)) as any);
    wrapper = await mountEditor("edge");
    await toYaml(wrapper);
    wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", "edited: 1\n");
    await flushPromises();
    const seen: string[] = [];
    const stop = watch(
      () => (wrapper.vm as any).modeChip.label,
      (label) => seen.push(label),
      { flush: "sync" },
    );
    await wrapper.find('[data-test="fleet-config-editor-save"]').trigger("click");
    await flushPromises();
    release({
      data: detail({ draft: draft("edited: 1\n"), latest_version: 1, versions: [published(1)] }),
    });
    await flushPromises();
    stop();
    expect(seen.every((l) => l === "Editing draft")).toBe(true);
    expect(chip(wrapper)).toBe("Editing draft");
    expect((wrapper.vm as any).dirty).toBe(false);
  });

  it("drops Validate results for text that was edited meanwhile", async () => {
    let release!: (v: unknown) => void;
    vi.mocked(fleet.validateConfig).mockReturnValue(new Promise((r) => (release = r)) as any);
    wrapper = await mountEditor("edge");
    await toYaml(wrapper);
    await wrapper.find('[data-test="fleet-config-editor-validate"]').trigger("click");
    wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", "edited: 1\n");
    await flushPromises();
    release({ data: { issues: { logs: [{ severity: "error", text: "no receiver" }] } } });
    await flushPromises();
    expect((wrapper.vm as any).issues).toBeNull();
  });

  it("drops publish warnings for text that was edited meanwhile", async () => {
    let release!: (v: unknown) => void;
    vi.mocked(fleet.publishConfigVersion).mockReturnValue(new Promise((r) => (release = r)) as any);
    wrapper = await mountEditor("edge");
    await toYaml(wrapper);
    await publish(wrapper);
    wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", "edited: 1\n");
    await flushPromises();
    release({
      data: { version: 1, warnings: { logs: [{ severity: "warning", text: "debug exporter" }] } },
    });
    await flushPromises();
    expect((wrapper.vm as any).issues).toBeNull();
  });

  it("shows a loading state and takes no edits while another id loads", async () => {
    wrapper = await mountEditor("edge");
    await toYaml(wrapper);
    vi.mocked(fleet.getConfig).mockReturnValue(new Promise(() => {}) as any);
    await router.replace({ name: "fleetConfigEditor", params: { id: "edge-copy" } });
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-config-editor-loading"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "FleetCodeEditor" }).exists()).toBe(false);
    (wrapper.vm as any).onYamlEdit("edited: 1\n");
    (wrapper.vm as any).onPaletteAdd(CATALOG[0]);
    (wrapper.vm as any).addPipeline("traces");
    await flushPromises();
    expect((wrapper.vm as any).yamlText).toBe(VALID);
    expect((wrapper.vm as any).dirty).toBe(false);
  });

  it.each([
    [{ response: { status: 500 } }, "fleet-config-editor-load-error"],
    [{ response: { status: 403 } }, "fleet-config-editor-forbidden"],
  ])("shows why a config cannot load (%j), with a retry for errors", async (err, shown) => {
    vi.mocked(fleet.getConfig).mockRejectedValue(err);
    wrapper = await mountEditor("edge");
    await flushPromises();
    expect(wrapper.find(`[data-test="${shown}"]`).exists()).toBe(true);
    if (shown.endsWith("load-error")) {
      vi.mocked(fleet.getConfig).mockResolvedValue({
        data: detail({ draft: draft(VALID) }),
      } as any);
      wrapper.findComponent(`[data-test="${shown}"]`).vm.$emit("action", "retry");
      await flushPromises();
      expect(wrapper.find('[data-test="fleet-config-editor-loading"]').exists()).toBe(false);
      expect(wrapper.find(`[data-test="${shown}"]`).exists()).toBe(false);
    }
  });

  it("keeps dirty after a successful save when the detail refetch fails", async () => {
    vi.mocked(fleet.getConfig)
      .mockResolvedValueOnce({
        data: detail({ latest_version: 1, versions: [published(1)] }),
      } as any)
      .mockRejectedValue({ response: { status: 400, data: { message: "bad" } } });
    wrapper = await mountEditor("edge");
    await toYaml(wrapper);
    wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", "edited: 1\n");
    await flushPromises();
    await wrapper.find('[data-test="fleet-config-editor-save"]').trigger("click");
    await flushPromises();
    expect(fleet.saveConfigDraft).toHaveBeenCalled();
    expect((wrapper.vm as any).dirty).toBe(true);
  });

  it("keeps dirty after a successful publish when the detail refetch fails", async () => {
    vi.mocked(fleet.publishConfigVersion).mockResolvedValue({
      data: { version: 1, warnings: {} },
    } as any);
    vi.mocked(fleet.getConfig)
      .mockResolvedValueOnce({ data: detail({ draft: draft(VALID) }) } as any)
      .mockRejectedValue({ response: { status: 400, data: { message: "bad" } } });
    wrapper = await mountEditor("edge");
    await toYaml(wrapper);
    wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", "edited: 1\n");
    await flushPromises();
    await publish(wrapper);
    expect(fleet.publishConfigVersion).toHaveBeenCalled();
    expect((wrapper.vm as any).dirty).toBe(true);
  });

  it("only toasts a 422 for text that was edited while publishing", async () => {
    let fail!: (e: unknown) => void;
    vi.mocked(fleet.publishConfigVersion).mockReturnValue(
      new Promise((_r, j) => (fail = j)) as any,
    );
    wrapper = await mountEditor("edge");
    await toYaml(wrapper);
    await publish(wrapper);
    wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", "edited: 1\n");
    await flushPromises();
    fail({
      response: {
        status: 422,
        data: { issues: { metrics: [{ severity: "error", text: "no exporter" }] } },
      },
    });
    await flushPromises();
    expect((wrapper.vm as any).issues).toBeNull();
    expect(focusMock).not.toHaveBeenCalled();
    expect(toasts()).toContainEqual({
      variant: "error",
      message: "Publish blocked: fix 1 validation error first",
    });
  });

  it("shows why Visual is unavailable when the disabled control is hovered", async () => {
    vi.mocked(fleet.getConfig).mockResolvedValue({ data: detail({ draft: draft(LOSSY) }) } as any);
    wrapper = await mountEditor("edge");
    const button = wrapper.find('[data-test="fleet-config-editor-mode-visual"]').element;
    // The disabled button has pointer-events: none, so the hover lands on its wrapper.
    button.parentElement!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.waitFor(
      () =>
        expect(document.body.textContent).toContain(
          "The visual editor cannot show this YAML without losing parts of it",
        ),
      { timeout: 2000 },
    );
  });

  it("returns to the list in the same org after Delete", async () => {
    vi.mocked(fleet.deleteConfig).mockResolvedValue({ status: 204 } as any);
    wrapper = await mountEditor("edge", { org_identifier: "acme" });
    const push = vi.spyOn(router, "push");
    await wrapper.find('[data-test="fleet-config-editor-delete"]').trigger("click");
    await flushPromises();
    await wrapper
      .find('[data-test="fleet-config-editor-delete-dialog"] [data-test="dialog-primary"]')
      .trigger("click");
    await flushPromises();
    expect(push).toHaveBeenCalledWith({
      name: "fleet",
      query: { org_identifier: "acme", tab: "configurations" },
    });
    push.mockRestore();
  });

  it("has no version picker", async () => {
    wrapper = await mountEditor("edge");
    expect(wrapper.find('[data-test="fleet-config-editor-config-version"]').exists()).toBe(false);
  });

  it("sets the issues from Validate", async () => {
    vi.mocked(fleet.validateConfig).mockResolvedValue({
      data: {
        issues: {
          "": [{ severity: "warning", text: "health_check is not defined here" }],
          logs: [{ severity: "error", text: "no receiver" }],
        },
      },
    } as any);
    wrapper = await mountEditor("edge");
    await wrapper.find('[data-test="fleet-config-editor-validate"]').trigger("click");
    await flushPromises();
    expect(fleet.validateConfig).toHaveBeenCalledWith(expect.any(String), { yaml: VALID });
    expect(wrapper.find('[data-test="fleet-config-editor-validation"]').text()).toContain(
      "1 error",
    );
    expect(toasts()).toContainEqual({
      variant: "warning",
      message: "health_check is not defined here",
    });
  });

  it("deletes from the confirm dialog and goes back to the list", async () => {
    vi.mocked(fleet.deleteConfig).mockResolvedValue({ status: 204 } as any);
    wrapper = await mountEditor("edge");
    const push = vi.spyOn(router, "push");
    await wrapper.find('[data-test="fleet-config-editor-delete"]').trigger("click");
    await flushPromises();
    await wrapper
      .find('[data-test="fleet-config-editor-delete-dialog"] [data-test="dialog-primary"]')
      .trigger("click");
    await flushPromises();
    expect(fleet.deleteConfig).toHaveBeenCalledWith(expect.any(String), "edge");
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "fleet" }));
    push.mockRestore();
  });

  it("keeps the dialog open and names the references when the delete is refused with 409", async () => {
    vi.mocked(fleet.deleteConfig).mockRejectedValue({
      response: {
        status: 409,
        data: { message: "in use", references: { fleets: 2, collectors: 14, rollouts: 1 } },
      },
    });
    wrapper = await mountEditor("edge");
    await wrapper.find('[data-test="fleet-config-editor-delete"]').trigger("click");
    await flushPromises();
    await wrapper
      .find('[data-test="fleet-config-editor-delete-dialog"] [data-test="dialog-primary"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-config-editor-delete-in-use"]').text()).toContain(
      "fleets: 2, collectors: 14, active rollouts: 1",
    );
  });

  it("duplicates the saved YAML, not unsaved edits, under {id}-copy", async () => {
    vi.mocked(fleet.createConfig).mockResolvedValue({ data: detail({ id: "edge-copy" }) } as any);
    wrapper = await mountEditor("edge");
    await toYaml(wrapper);
    wrapper.findComponent({ name: "FleetCodeEditor" }).vm.$emit("update:code", "unsaved: 1\n");
    await flushPromises();
    const push = vi.spyOn(router, "push");
    await wrapper.find('[data-test="fleet-config-editor-duplicate"]').trigger("click");
    await flushPromises();
    const form = (wrapper.findComponent(OForm).vm as any).form;
    expect(form.state.values).toEqual({ id: "edge-copy", description: "Edge devices" });
    await submitForm(wrapper);
    expect(fleet.createConfig).toHaveBeenCalledWith(expect.any(String), {
      id: "edge-copy",
      description: "Edge devices",
      yaml: VALID,
    });
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "fleetConfigEditor", params: { id: "edge-copy" } }),
    );
    push.mockRestore();
  });

  it("reveals a selected node in the canvas once the panel opens", async () => {
    wrapper = await mountEditor("edge");
    const canvas = wrapper.findComponent({ name: "FleetEditorCanvas" });
    canvas.vm.$emit("select-node", "logs|receiver:filelog", "logs", "receiver:filelog");
    await flushPromises();
    expect((wrapper.vm as any).panelOpen).toBe(true);
    expect(revealMock).toHaveBeenCalledWith("logs|receiver:filelog");
  });

  it("reveals the selection only when the panel opens or the palette expands, never on a close", async () => {
    wrapper = await mountEditor("edge");
    const vm = wrapper.vm as any;
    vm.paletteCollapsed = !vm.paletteCollapsed;
    await flushPromises();
    expect(revealMock).not.toHaveBeenCalled();
    wrapper
      .findComponent({ name: "FleetEditorCanvas" })
      .vm.$emit("select-node", "logs|receiver:filelog", "logs", "receiver:filelog");
    await flushPromises();
    vm.paletteCollapsed = true;
    await flushPromises();
    revealMock.mockClear();
    vm.panelOpen = false;
    await flushPromises();
    expect(revealMock).not.toHaveBeenCalled();
    vm.paletteCollapsed = false;
    await flushPromises();
    expect(revealMock).toHaveBeenCalledWith("logs|receiver:filelog");
    revealMock.mockClear();
    vm.paletteCollapsed = true;
    await flushPromises();
    expect(revealMock).not.toHaveBeenCalled();
    vm.panelOpen = true;
    await flushPromises();
    expect(revealMock).toHaveBeenCalledWith("logs|receiver:filelog");
  });

  it("remounts the canvas for each loaded document, so a new graph fits afresh", async () => {
    vi.mocked(fleet.getConfig).mockImplementation(
      async (_o: string, cid: string) =>
        ({ data: detail({ id: cid, draft: draft(VALID) }) }) as any,
    );
    wrapper = await mountEditor("other");
    await router.push({ name: "fleetConfigEditor", params: { id: "edge" } });
    await flushPromises();
    const before = canvasMounts.mock.calls.length;
    await router.push({ name: "fleetConfigEditor", params: { id: "other" } });
    await flushPromises();
    expect(canvasMounts.mock.calls.length).toBe(before + 1);
    await router.push({ name: "fleetConfigEditor", params: { id: "new" } });
    await flushPromises();
    expect(canvasMounts.mock.calls.length).toBe(before + 2);
  });

  it("opens the rollout dialog for the config's latest version from Deploy", async () => {
    vi.mocked(fleet.getConfig).mockResolvedValue({
      data: detail({ latest_version: 2, versions: [published(2), published(1)] }),
    } as any);
    wrapper = await mountEditor("edge");
    const dialog = wrapper.findComponent({ name: "FleetNewRolloutDialog" });
    expect(dialog.props("open")).toBe(false);
    await wrapper.find('[data-test="fleet-config-editor-start-rollout"]').trigger("click");
    await flushPromises();
    expect(dialog.props()).toMatchObject({ open: true, config: "edge", toVersion: 2 });
  });

  it("keeps the desktop header order: Save draft, Publish version, Deploy", async () => {
    vi.mocked(fleet.getConfig).mockResolvedValue({
      data: detail({ latest_version: 1, versions: [published(1)] }),
    } as any);
    wrapper = await mountEditor("edge");
    const ids = wrapper
      .findAll("[data-test^='fleet-config-editor-']")
      .map((b) => b.attributes("data-test"))
      .filter((id) =>
        ["save", "publish", "start-rollout"].some((x) => id === `fleet-config-editor-${x}`),
      );
    expect(ids).toEqual([
      "fleet-config-editor-save",
      "fleet-config-editor-publish",
      "fleet-config-editor-start-rollout",
    ]);
    expect(wrapper.find('[data-test="app-page-header-more-btn"]').exists()).toBe(false);
  });

  it("keeps a loaded config when a background refetch fails", async () => {
    wrapper = await mountEditor("edge");
    vi.mocked(fleet.getConfig).mockRejectedValue({ response: { status: 500 } });
    await queryClient.refetchQueries({ type: "active" });
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-config-editor-load-error"]').exists()).toBe(false);
    expect((wrapper.vm as any).loaded).toBe(true);
    expect((wrapper.vm as any).loadFailed).toBe(false);
  });

  it("retries the version read that failed, not only the config", async () => {
    vi.mocked(fleet.getConfig).mockResolvedValue({
      data: detail({ latest_version: 2, versions: [published(2), published(1)] }),
    } as any);
    vi.mocked(fleet.getConfigVersion).mockRejectedValueOnce({ response: { status: 500 } });
    wrapper = await mountEditor("edge");
    await flushPromises();
    const error = '[data-test="fleet-config-editor-load-error"]';
    expect(wrapper.find(error).exists()).toBe(true);
    const calls = vi.mocked(fleet.getConfigVersion).mock.calls.length;
    wrapper.findComponent(error).vm.$emit("action", "retry");
    await flushPromises();
    expect(vi.mocked(fleet.getConfigVersion).mock.calls.length).toBe(calls + 1);
    expect(wrapper.find(error).exists()).toBe(false);
  });

  it("moves the secondaries behind More on a phone and folds the palette", async () => {
    mockViewport.mdUp = false;
    try {
      vi.mocked(fleet.getConfig).mockResolvedValue({
        data: detail({ latest_version: 1, versions: [published(1)] }),
      } as any);
      wrapper = await mountEditor("edge");
      expect(wrapper.find('[data-test="fleet-config-editor-start-rollout"]').exists()).toBe(true);
      const menu = wrapper
        .findAllComponents(DropdownStub)
        .find((d) => d.find('[data-test="app-page-header-more-btn"]').exists());
      expect(menu).toBeDefined();
      expect(menu!.find('[data-test="fleet-config-editor-save"]').exists()).toBe(true);
      expect(menu!.find('[data-test="fleet-config-editor-publish"]').exists()).toBe(true);
      expect(wrapper.findAll('[data-test="fleet-config-editor-save"]')).toHaveLength(1);
      expect((wrapper.vm as any).paletteCollapsed).toBe(true);
    } finally {
      mockViewport.mdUp = true;
    }
  });

  it("offers Deploy to everyone, leaving the fleet to pick in the dialog", async () => {
    vi.mocked(fleet.getConfig).mockResolvedValue({
      data: detail({ latest_version: 1, versions: [published(1)] }),
    } as any);
    wrapper = await mountEditor("edge");
    const btn = wrapper.find('[data-test="fleet-config-editor-start-rollout"]');
    expect(btn.attributes("aria-disabled")).toBeUndefined();
    await btn.trigger("click");
    await flushPromises();
    const dialog = wrapper.findComponent({ name: "FleetNewRolloutDialog" });
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("fleetId")).toBeUndefined();
  });

  it("shows the rolling-out mode chip while the latest version rolls out", async () => {
    vi.mocked(fleet.getConfig).mockResolvedValue({
      data: detail({
        latest_version: 2,
        live_version: 1,
        versions: [
          { ...published(2), state: "rolling_out" },
          { ...published(1), live: true, state: null },
        ],
      }),
    } as any);
    wrapper = await mountEditor("edge");
    expect(chip(wrapper)).toBe("v2 rolling out");
  });
});
