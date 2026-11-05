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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const { built, onChord } = vi.hoisted(() => ({
  built: {
    count: 0,
    visible: true,
    pending: null as unknown,
    opts: null as null | { enabled?: () => boolean; query?: () => string | undefined },
  },
  onChord: vi.fn(() => true),
}));

vi.mock("@/composables/assistant/flags", () => ({ isAssistantV2: () => true }));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/components/ai-assistant/helper/useQueryEditorHelper", async () => {
  const { computed: c, ref: r, reactive: re } = await import("vue");
  const live = re(built);
  return {
    useQueryEditorHelper: (opts: typeof built.opts) => {
      built.count += 1;
      built.opts = opts;
      return {
        visible: c(() => live.visible),
        usable: c(() => true),
        host: { id: "logs", language: "sql" },
        proposal: null,
        pending: c(() => live.pending),
        label: c(() => null),
        open: r(false),
        entryKind: r("editor_button"),
        prefill: r(undefined),
        blocked: c(() => null),
        dockOpen: c(() => false),
        status: r(""),
        editTick: r(0),
        focused: r(false),
        openFrom: vi.fn(),
        onChord,
        onUserEdit: vi.fn(),
      };
    },
  };
});

const stub = (name: string, test: string) => ({
  __esModule: true,
  default: defineComponent({
    name,
    inheritAttrs: false,
    setup:
      (_, { attrs }) =>
      () =>
        h("div", { "data-test": attrs["data-test"] ?? test }),
  }),
});
vi.mock("@/components/ai-assistant/entry/AiEntryButton.vue", () => stub("AiEntryButton", "door"));
vi.mock("@/components/ai-assistant/entry/AiLabel.vue", () => stub("AiLabel", "label"));
vi.mock("@/components/ai-assistant/evidence/AssistantDiffBlock.vue", () =>
  stub("AssistantDiffBlock", "diff"),
);
vi.mock("@/components/ai-assistant/helper/InlineQueryHelper.vue", () =>
  stub("InlineQueryHelper", "inline-helper"),
);
vi.mock("@/components/ai-assistant/helper/InlineHelperHint.vue", () =>
  stub("InlineHelperHint", "inline-helper-hint-host"),
);

import QueryEditor from "./QueryEditor.vue";

const chordProp = ref<unknown>(null);
const CodeQueryEditorStub = defineComponent({
  name: "CodeQueryEditor",
  props: { assistantChord: { type: Function, default: null } },
  emits: ["nlpModeDetected", "user-edit", "update:query", "focus", "blur"],
  setup(props) {
    return () => {
      chordProp.value = props.assistantChord;
      return h("div", { "data-test": "code-query-editor" });
    };
  },
});

async function settle() {
  await vi.dynamicImportSettled();
  await flushPromises();
}

function mountEditor(props: Record<string, unknown> = {}) {
  return mount(QueryEditor, {
    props: {
      query: "",
      editorHeight: "12.5rem",
      dataTestPrefix: "query-editor",
      assistant: { id: "logs", stream: "default" },
      ...props,
    },
    global: { plugins: [store, i18n], stubs: { CodeQueryEditor: CodeQueryEditorStub } },
  });
}

afterEach(() => {
  built.count = 0;
  built.visible = true;
  built.pending = null;
  chordProp.value = null;
  vi.clearAllMocks();
});

describe("QueryEditor on the v2 path", () => {
  it("shows one Ask AI door in the toolbar row and no legacy bar or floating toggle", async () => {
    const wrapper = mountEditor();
    await settle();
    expect(wrapper.find('[data-test="inline-helper-toolbar"]').attributes("data-host")).toBe(
      "logs",
    );
    expect(wrapper.find('[data-test="ai-entry-query-generate"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="query-editor-ai-toggle-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="query-editor-ai-input-bar"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("binds the chord in Monaco and never auto-opens on detected plain language", async () => {
    const wrapper = mountEditor();
    await settle();
    expect(typeof chordProp.value).toBe("function");
    (chordProp.value as () => boolean)();
    expect(onChord).toHaveBeenCalled();
    wrapper.findComponent({ name: "CodeQueryEditor" }).vm.$emit("nlpModeDetected", true);
    await settle();
    expect(wrapper.find('[data-test="query-editor-ai-input-bar"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("builds no helper for a host without an adapter", async () => {
    mountEditor({ assistant: null }).unmount();
    expect(built.count).toBe(0);
  });

  it("follows helper=off, read-only and the query prop live instead of freezing them at mount", async () => {
    const wrapper = mountEditor({ helper: "off" });
    expect(built.opts?.enabled?.()).toBe(false);
    await wrapper.setProps({ helper: "on" });
    expect(built.opts?.enabled?.()).toBe(true);
    await wrapper.setProps({ readOnly: true });
    expect(built.opts?.enabled?.()).toBe(false);
    await wrapper.setProps({ query: "SELECT 2" });
    expect(built.opts?.query?.()).toBe("SELECT 2");
    wrapper.unmount();
  });

  it("grows the host instead of covering the editor", async () => {
    const wrapper = mountEditor();
    await settle();
    expect(wrapper.attributes("style") ?? "").not.toContain("height");
    const area = wrapper.get('[data-test="code-query-editor"]').element.parentElement!;
    expect(area.getAttribute("style")).toContain("height: 12.5rem");
    wrapper.unmount();
  });

  it("puts the door beside a fill-height editor and asks the host for room for a diff", async () => {
    const wrapper = mountEditor({ editorHeight: "100%", helperLayout: "inline" });
    await settle();
    const toolbar = wrapper.get('[data-test="inline-helper-toolbar"]');
    expect(toolbar.attributes("data-layout")).toBe("inline");
    expect(
      toolbar.element.previousElementSibling?.contains(
        wrapper.get('[data-test="code-query-editor"]').element,
      ),
    ).toBe(true);
    expect(wrapper.emitted("helper-space")).toBeUndefined();
    const vm = wrapper.vm as unknown as { $forceUpdate(): void };
    (await import("vue")).reactive(built).pending = { id: "p1" };
    vm.$forceUpdate();
    await settle();
    expect(wrapper.emitted("helper-space")?.at(-1)).toEqual([160]);
    wrapper.unmount();
    expect(wrapper.emitted("helper-space")?.at(-1)).toEqual([0]);
  });

  it("draws the host's placeholder inside the editor area while empty and unfocused", async () => {
    const wrapper = mountEditor({ placeholder: "Write a VRL function" });
    await settle();
    expect(wrapper.get('[data-test="query-editor-placeholder"]').text()).toBe(
      "Write a VRL function",
    );
    wrapper.findComponent({ name: "CodeQueryEditor" }).vm.$emit("focus");
    await settle();
    expect(wrapper.find('[data-test="query-editor-placeholder"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
