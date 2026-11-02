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
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import {
  routeEditorKeyToRecents,
  type RecentsKeyTarget,
} from "@/utils/queryHistory/recentSearches";

const api = vi.hoisted(() => ({ list: vi.fn(), record: vi.fn(), star: vi.fn(), remove: vi.fn() }));
vi.mock("@/services/query_history", () => ({ default: api }));
vi.mock("@/composables/useChatHistory", () => ({
  useChatHistory: vi.fn(() => ({
    saveToHistory: vi.fn().mockResolvedValue(1),
    loadHistory: vi.fn().mockResolvedValue([]),
    loadChat: vi.fn().mockResolvedValue(null),
    deleteChatById: vi.fn().mockResolvedValue(true),
    clearAllHistory: vi.fn().mockResolvedValue(true),
    updateChatTitle: vi.fn().mockResolvedValue(true),
  })),
}));

import QueryEditor from "@/components/QueryEditor.vue";
import RecentSearchesFocusDropdown from "./RecentSearchesFocusDropdown.vue";
import { placeCaret } from "@/test/unit/helpers/monacoCaret";

enableAutoUnmount(afterEach);

const NOW_US = Date.now() * 1000;
const generateSql = vi.fn().mockResolvedValue(undefined);

// Stands in for Monaco: the same `.monaco-editor` surface and caret element the real editor renders.
const MonacoStub = defineComponent({
  setup(_, { expose }) {
    expose({ handleGenerateSQL: generateSql, getValue: () => "" });
    return () =>
      h("div", { class: "monaco-editor" }, [
        h("textarea", { class: "inputarea", "data-test": "monaco-input" }),
        h("div", { class: "cursors-layer" }, [
          h("div", { class: "cursor", ref: (el) => placeCaret(el as Element | null) }),
        ]),
      ]);
  },
});

const mountEditorBox = async () => {
  const open = ref(false);
  const box = ref<HTMLElement | null>(null);
  const dropdown = ref<RecentsKeyTarget | null>(null);
  const emitted: string[] = [];
  const Host = defineComponent({
    setup() {
      return () =>
        h("div", [
          h(
            "div",
            {
              ref: box,
              onKeydownCapture: (e: KeyboardEvent) =>
                open.value &&
                routeEditorKeyToRecents(e, dropdown.value, () => (open.value = false)),
            },
            [
              h(QueryEditor, {
                query: "",
                nlpMode: true,
                editorHeight: "200px",
                dataTestPrefix: "logs-search-bar",
              }),
            ],
          ),
          h(RecentSearchesFocusDropdown, {
            ref: dropdown,
            source: "logs",
            anchor: box.value,
            open: open.value,
            "onUpdate:open": (value: boolean) => (open.value = value),
            onRun: () => emitted.push("run"),
            onLoad: () => emitted.push("load"),
          }),
        ]);
    },
  });
  mount(Host, {
    attachTo: document.body,
    global: { plugins: [store, i18n], stubs: { CodeQueryEditor: MonacoStub, OTimeCell: true } },
  });
  await flushPromises();
  open.value = true;
  await vi.waitFor(() =>
    expect(document.querySelector('[data-test="recent-searches-row-e0"]')).not.toBeNull(),
  );
  const aiInput = document.querySelector<HTMLInputElement>(
    '[data-test^="logs-search-bar-ai-input-field"] input',
  )!;
  const monacoInput = document.querySelector<HTMLElement>('[data-test="monaco-input"]')!;
  return { open, emitted, aiInput, monacoInput };
};

const keydown = (target: Element, key: string, shiftKey = false) => {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe("recent-searches dropdown and the controls that share the editor box", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.zoConfig.query_history_enabled = true;
    api.list.mockResolvedValue({
      data: [
        {
          id: "e0",
          source: "logs",
          query: "level='error'",
          query_key: "k",
          streams: ["k8s"],
          context: {},
          status: "ok",
          starred: false,
          run_count: 1,
          created_at: NOW_US,
          updated_at: NOW_US,
        },
      ],
    });
  });
  afterEach(() => {
    delete store.state.zoConfig.query_history_enabled;
    document.body.innerHTML = "";
  });

  it("leaves Enter, Shift+Enter and ArrowDown in the AI prompt to the prompt while the dropdown is open", async () => {
    const { open, emitted, aiInput } = await mountEditorBox();
    expect(aiInput).not.toBeNull();
    aiInput.value = "show errors";
    aiInput.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();

    const arrow = keydown(aiInput, "ArrowDown");
    const shiftEnter = keydown(aiInput, "Enter", true);
    const enter = keydown(aiInput, "Enter");
    await flushPromises();

    expect(arrow.defaultPrevented).toBe(false);
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    expect(document.activeElement?.getAttribute("data-test") ?? "").not.toMatch(
      /^recent-searches-row/,
    );
    expect(emitted).toEqual([]);
    expect(generateSql).toHaveBeenCalledWith("show errors", expect.anything(), expect.anything());
    expect(open.value).toBe(true);
  });

  it("leaves Enter to the editor's newline until a row is hovered, then runs that row", async () => {
    const { emitted, monacoInput } = await mountEditorBox();
    const plain = keydown(monacoInput, "Enter");
    await flushPromises();
    expect(plain.defaultPrevented).toBe(false);
    expect(emitted).toEqual([]);

    document
      .querySelector('[data-test="recent-searches-row-e0"]')!
      .dispatchEvent(new PointerEvent("pointerenter"));
    await flushPromises();
    const enter = keydown(monacoInput, "Enter");
    await flushPromises();
    expect(enter.defaultPrevented).toBe(true);
    expect(emitted).toEqual(["run"]);
  });

  it("closes when focus or a click moves to the AI prompt or a button in the same box", async () => {
    const first = await mountEditorBox();
    first.aiInput.focus();
    await nextTick();
    expect(first.open.value).toBe(false);

    document.body.innerHTML = "";
    const second = await mountEditorBox();
    const send = document.querySelector('[data-test="logs-search-bar-ai-send-btn"]')!;
    send.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await nextTick();
    expect(second.open.value).toBe(false);
  });

  it("stays open on a click or focus inside the editor's own surface", async () => {
    const { open, monacoInput } = await mountEditorBox();
    monacoInput.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    monacoInput.focus();
    await nextTick();
    expect(open.value).toBe(true);
  });
});
