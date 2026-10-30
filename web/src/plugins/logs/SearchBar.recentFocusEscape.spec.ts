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

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import SearchBar from "@/plugins/logs/SearchBar.vue";

interface FocusDropdownVm {
  recentFocusOpen: boolean;
  onQueryEditorFocus: () => void;
  queryEditorBoxRef: HTMLElement | null;
}

describe("logs recent-searches focus dropdown and the editor's Escape", () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.clearAllMocks();
  });

  it("closes the dropdown on Escape and still lets the editor handle it", async () => {
    wrapper = mount(SearchBar, {
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true, RecentSearchesFocusDropdown: true },
      },
    });
    const vm = wrapper.vm as unknown as FocusDropdownVm;
    expect(vm.queryEditorBoxRef).not.toBeNull();
    // Stands in for Monaco, whose Escape binding moves focus out of the editor and stops the event.
    const editorEscape = vi.fn();
    const editor = document.createElement("textarea");
    editor.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      editorEscape(e.defaultPrevented);
      e.stopPropagation();
    });
    const monaco = document.createElement("div");
    monaco.className = "monaco-editor";
    monaco.appendChild(editor);
    vm.queryEditorBoxRef!.appendChild(monaco);
    vm.recentFocusOpen = true;
    await nextTick();

    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );

    expect(vm.recentFocusOpen).toBe(false);
    expect(editorEscape).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("hides the typing placeholder while the dropdown is open, so only one list changes", async () => {
    wrapper = mount(SearchBar, {
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true, RecentSearchesFocusDropdown: true },
      },
    });
    const vm = wrapper.vm as unknown as FocusDropdownVm & {
      searchObj: { data: { editorValue: string }; meta: Record<string, unknown> };
    };
    vm.searchObj.data.editorValue = "";
    vm.searchObj.meta.queryEditorPlaceholderFlag = true;
    vm.searchObj.meta.nlpMode = false;
    vm.recentFocusOpen = false;
    await nextTick();
    expect(wrapper.find(".query-editor-placeholder-overlay").exists()).toBe(true);

    vm.recentFocusOpen = true;
    await nextTick();
    expect(wrapper.find(".query-editor-placeholder-overlay").exists()).toBe(false);

    vm.recentFocusOpen = false;
    await nextTick();
    expect(wrapper.find(".query-editor-placeholder-overlay").exists()).toBe(true);
  });

  it("opens when an edit clears the focused editor and closes on the next character", async () => {
    store.state.zoConfig.query_history_enabled = true;
    wrapper = mount(SearchBar, {
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true, RecentSearchesFocusDropdown: true },
      },
    });
    const vm = wrapper.vm as unknown as FocusDropdownVm & {
      onEditorUserEdit: (isBlank: boolean, wasBlank: boolean) => void;
      searchObj: { data: { editorValue: string; query: string } };
    };
    vm.searchObj.data.editorValue = "code=200";
    vm.onQueryEditorFocus();
    expect(vm.recentFocusOpen).toBe(false);

    vm.onEditorUserEdit(true, false);
    expect(vm.recentFocusOpen).toBe(true);
    vm.onEditorUserEdit(false, true);
    expect(vm.recentFocusOpen).toBe(false);

    vm.searchObj.data.editorValue = "";
    vm.onQueryEditorFocus();
    expect(vm.recentFocusOpen).toBe(true);
    vm.recentFocusOpen = false;
    vm.onEditorUserEdit(true, false);
    expect(vm.recentFocusOpen).toBe(true);
    delete store.state.zoConfig.query_history_enabled;
  });

  it("stays closed when Escape in the list hands focus back to the editor, until the next real focus", async () => {
    store.state.zoConfig.query_history_enabled = true;
    const route = router.currentRoute.value;
    router.currentRoute.value = router.resolve({ name: "logs" });
    // Monaco fires its focus event inside focus(), in the same tick as the dismissal.
    const EditorStub = defineComponent({
      emits: ["focus"],
      setup(_, { emit, expose }) {
        expose({ focus: () => emit("focus") });
        return () => h("div");
      },
    });
    wrapper = mount(SearchBar, {
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: EditorStub, RecentSearchesFocusDropdown: true },
      },
    });
    await vi.dynamicImportSettled();
    await flushPromises();
    const vm = wrapper.vm as unknown as FocusDropdownVm & {
      onEditorUserEdit: (isBlank: boolean, wasBlank: boolean) => void;
      searchObj: { data: { editorValue: string; query: string } };
    };
    vm.searchObj.data.editorValue = "";
    vm.searchObj.data.query = "";
    vm.onQueryEditorFocus();
    expect(vm.recentFocusOpen).toBe(true);

    const dropdown = wrapper.findComponent({ name: "RecentSearchesFocusDropdown" });
    dropdown.vm.$emit("update:open", false);
    dropdown.vm.$emit("dismiss");
    await nextTick();
    expect(vm.recentFocusOpen).toBe(false);

    vm.onQueryEditorFocus();
    expect(vm.recentFocusOpen).toBe(true);
    vm.recentFocusOpen = false;

    dropdown.vm.$emit("dismiss");
    vm.onEditorUserEdit(false, true);
    vm.onEditorUserEdit(true, false);
    expect(vm.recentFocusOpen).toBe(true);
    delete store.state.zoConfig.query_history_enabled;
    router.currentRoute.value = route;
  });

  describe("in the full-screen editor", () => {
    type FullScreenVm = FocusDropdownVm & {
      isFocused: boolean;
      noteEditorPointer: () => void;
      handleEscKey: (event: KeyboardEvent) => void;
      searchObj: { data: { editorValue: string } };
    };
    const mountFullScreen = async () => {
      store.state.zoConfig.query_history_enabled = true;
      wrapper = mount(SearchBar, {
        attachTo: document.body,
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: { QueryEditor: true, RecentSearchesFocusDropdown: true },
        },
      });
      const vm = wrapper.vm as unknown as FullScreenVm;
      vm.searchObj.data.editorValue = "";
      vm.isFocused = true;
      await nextTick();
      return vm;
    };
    afterEach(() => {
      delete store.state.zoConfig.query_history_enabled;
    });

    it("opens for a click into the editor, not for a scripted focus", async () => {
      const vm = await mountFullScreen();
      vm.onQueryEditorFocus();
      expect(vm.recentFocusOpen).toBe(false);
      vm.noteEditorPointer();
      vm.onQueryEditorFocus();
      expect(vm.recentFocusOpen).toBe(true);
    });

    it("closes only the list on the first Esc and keeps the editor's Esc from running", async () => {
      const vm = await mountFullScreen();
      const editorEscape = vi.fn();
      const monaco = document.createElement("div");
      monaco.className = "monaco-editor";
      const editor = document.createElement("textarea");
      editor.addEventListener("keydown", editorEscape);
      monaco.appendChild(editor);
      vm.queryEditorBoxRef!.appendChild(monaco);
      vm.recentFocusOpen = true;
      await nextTick();

      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      editor.dispatchEvent(escape);

      expect(vm.recentFocusOpen).toBe(false);
      expect(escape.defaultPrevented).toBe(true);
      expect(editorEscape).not.toHaveBeenCalled();
      expect(vm.isFocused).toBe(true);
    });

    it("keeps full-screen while a recent-searches list or drawer takes the Esc", async () => {
      const vm = await mountFullScreen();
      const layer = document.createElement("div");
      layer.setAttribute("data-test", "recent-searches-drawer");
      document.body.appendChild(layer);
      vm.handleEscKey(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(vm.isFocused).toBe(true);
      layer.remove();
      vm.handleEscKey(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(vm.isFocused).toBe(false);
    });
  });
});
