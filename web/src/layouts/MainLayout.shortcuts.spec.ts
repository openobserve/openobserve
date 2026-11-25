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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import { getManager, resetManager } from "@/lib/vue-shortcut-manager";
import config from "@/aws-exports";

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));

vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { setUser: vi.fn(), startView: vi.fn() },
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });
// Any page but Home, where Ctrl+B switches Home's tab instead. The real Logs page is a lazy import
// heavy enough to outlast the test timeout on a busy machine.
router.addRoute({ path: "/not-home", name: "notHome", component: StubDiv });

function mountMainLayout() {
  return mount(MainLayout, {
    global: {
      plugins: [store, i18n, router],
      stubs: {
        AppHeader: StubDiv,
        ONavbar: StubDiv,
        O2AIChat: StubDiv,
        WebinarBanner: StubDiv,
        AnnouncementBanner: StubDiv,
        ShortcutCheatsheet: StubDiv,
        CommunitySlackInvite: StubDiv,
        ThemeSwitcher: StubDiv,
        PredefinedThemes: StubDiv,
        SlackIcon: StubDiv,
        ManagementIcon: StubDiv,
        ODialog: StubDiv,
        "router-view": StubDiv,
      },
    },
  });
}

describe("MainLayout — AI chat shortcut gate", () => {
  let wrapper: VueWrapper | undefined;
  const originalIsEnterprise = config.isEnterprise;

  beforeEach(() => {
    resetManager();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    config.isEnterprise = originalIsEnterprise;
    store.state.zoConfig.ai_enabled = false;
    store.state.isAiChatEnabled = false;
    resetManager();
  });

  const ctrlB = () => getManager()?.getById("aiChatToggle");

  it("should not register ctrl+b on OSS builds", async () => {
    config.isEnterprise = "false";
    store.state.zoConfig.ai_enabled = true;

    wrapper = mountMainLayout();
    await flushPromises();

    expect(ctrlB()).toBeUndefined();
  });

  it.each(["false", "true"])(
    "should bind t to the time range picker once on every build (isEnterprise=%s)",
    async (isEnterprise) => {
      config.isEnterprise = isEnterprise;

      wrapper = mountMainLayout();
      await flushPromises();

      const entries = getManager()!
        .getAll()
        .filter((s) => s.key === "t");
      expect(entries.map((s) => s.id)).toEqual(["timeRangeOpen"]);
    },
  );

  it("should register ctrl+b on enterprise builds", async () => {
    config.isEnterprise = "true";

    wrapper = mountMainLayout();
    await flushPromises();

    expect(ctrlB()?.key).toBe("ctrl+b");
  });

  it("should not open the chat while ai_enabled is off", async () => {
    config.isEnterprise = "true";
    store.state.zoConfig.ai_enabled = false;

    wrapper = mountMainLayout();
    await router.push({ name: "notHome" });
    await flushPromises();

    ctrlB()!.handler();
    expect(store.state.isAiChatEnabled).toBe(false);
  });

  it("should open the chat when ai_enabled is on", async () => {
    config.isEnterprise = "true";
    store.state.zoConfig.ai_enabled = true;

    wrapper = mountMainLayout();
    await router.push({ name: "notHome" });
    await flushPromises();

    ctrlB()!.handler();
    expect(store.state.isAiChatEnabled).toBe(true);
  });
});

describe("MainLayout — global resource search shortcut", () => {
  let wrapper: VueWrapper | undefined;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    resetManager();
    document.querySelector('[data-test="other-panel"]')?.remove();
    document.querySelector('[data-test="o-dialog-overlay"]')?.remove();
  });
  it("registers global Command K, toggles it from an editor and skips composition or open modals", async () => {
    resetManager();
    wrapper = mountMainLayout();
    await flushPromises();
    const shortcut = getManager()?.getById("commandPalette");
    expect(shortcut?.key).toBe("ctrl+k");
    expect(shortcut?.allowInInput).toBe(true);
    const palette = () => wrapper!.findComponent({ name: "CommandPalette" }).props("open");
    const press = async (init: KeyboardEventInit = {}) => {
      getManager()!.handleKeyDown(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, ...init }),
      );
      await flushPromises();
    };
    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    editor.innerHTML = '<textarea class="inputarea"></textarea>';
    document.body.append(editor);
    editor.querySelector("textarea")!.focus();
    await press();
    expect(palette()).toBe(true);
    await press();
    expect(palette()).toBe(false);
    editor.remove();
    await press({ isComposing: true });
    expect(palette()).toBe(false);
    const panel = document.createElement("div");
    panel.role = "dialog";
    panel.dataset.test = "other-panel";
    document.body.append(panel);
    await press();
    expect(palette()).toBe(true);
    await press();
    panel.remove();
    const overlay = document.createElement("div");
    overlay.dataset.test = "o-dialog-overlay";
    overlay.dataset.state = "open";
    document.body.append(overlay);
    await press();
    expect(palette()).toBe(false);
    overlay.remove();
  });
});
