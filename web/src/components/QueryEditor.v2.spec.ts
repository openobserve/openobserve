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

const { focusCard, focusDock } = vi.hoisted(() => ({
  focusCard: vi.fn(() => false),
  focusDock: vi.fn((_id: string) => false),
}));

vi.mock("@/composables/assistant/flags", () => ({ isAssistantV2: () => true }));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/composables/assistant", () => ({
  assistantFocusCard: focusCard,
  focusDockComposer: focusDock,
}));

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

function mountEditor(props: Record<string, unknown> = {}) {
  return mount(QueryEditor, {
    props: { query: "", dataTestPrefix: "query-editor", ...props },
    global: { plugins: [store, i18n], stubs: { CodeQueryEditor: CodeQueryEditorStub } },
  });
}

afterEach(() => {
  chordProp.value = null;
  vi.clearAllMocks();
  store.commit("setConfig", { ...store.state.zoConfig, ai_enabled: false });
});

describe("QueryEditor with the assistant redesign on", () => {
  it("keeps the original natural-language toggle and bar", async () => {
    store.commit("setConfig", { ...store.state.zoConfig, ai_enabled: true });
    const wrapper = mountEditor({ assistant: { id: "alert_query" } });
    await flushPromises();
    const toggle = wrapper.find('[data-test="query-editor-ai-toggle-btn"]');
    expect(toggle.exists()).toBe(true);
    await toggle.trigger("click");
    expect(wrapper.find('[data-test="query-editor-ai-input-bar"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="inline-helper"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("binds no chord for a host without an assistant adapter", () => {
    mountEditor().unmount();
    expect(chordProp.value).toBeNull();
  });

  it("routes the chord to the pending card, then the host's dock, and otherwise leaves it to Monaco", () => {
    const wrapper = mountEditor({ assistant: { id: "alert_query" } });
    const chord = chordProp.value as () => boolean;
    expect(chord()).toBe(false);
    expect(focusDock).toHaveBeenCalledWith("alert_query");
    focusDock.mockReturnValueOnce(true);
    expect(chord()).toBe(true);
    focusCard.mockReturnValueOnce(true);
    focusDock.mockClear();
    expect(chord()).toBe(true);
    expect(focusDock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("draws the placeholder only while the editor is empty and unfocused", async () => {
    const wrapper = mountEditor({ placeholder: "Search logs" });
    const overlay = () => wrapper.find('[data-test="query-editor-placeholder"]');
    expect(overlay().text()).toBe("Search logs");
    const editor = wrapper.findComponent({ name: "CodeQueryEditor" });
    editor.vm.$emit("focus");
    await flushPromises();
    expect(overlay().exists()).toBe(false);
    editor.vm.$emit("blur");
    await wrapper.setProps({ query: "SELECT 1" });
    expect(overlay().exists()).toBe(false);
    wrapper.unmount();
  });
});
