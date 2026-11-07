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
import { resetAssistantV2ForTests } from "@/composables/assistant/flags";
import { onOverviewFocusRequest, requestGoTo } from "@/composables/goto/goToRequests";

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
const PaletteStub = defineComponent({
  name: "GoToPalette",
  props: { open: Boolean, homeReturn: { type: Object, default: null } },
  setup: () => () => h("div", { "data-test": "go-to-palette-stub" }),
});

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
        GoToPalette: PaletteStub,
        HomeReturnBar: StubDiv,
        AssistantSidebarHost: StubDiv,
        AssistantWindowLayer: StubDiv,
        AssistantSkipLink: StubDiv,
      },
    },
  });
}

describe("MainLayout — AI chat shortcut gate", () => {
  let wrapper: VueWrapper | undefined;
  const originalIsEnterprise = config.isEnterprise;

  // Ctrl+B is the legacy chat's binding; a local `.env` may turn v2 on for the whole run.
  beforeEach(() => {
    window.__O2_ASSISTANT_V2__ = false;
    resetAssistantV2ForTests();
    resetManager();
  });

  afterEach(() => {
    delete window.__O2_ASSISTANT_V2__;
    resetAssistantV2ForTests();
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

describe("MainLayout — Go to shortcut", () => {
  let wrapper: VueWrapper | undefined;
  let stopFocus: (() => void) | undefined;

  const goTo = () => getManager()?.getById("goTo");
  const palette = () => wrapper!.findComponent(PaletteStub);
  const mountV2 = async (on: boolean, routeName = "logs") => {
    window.__O2_ASSISTANT_V2__ = on;
    resetAssistantV2ForTests();
    wrapper = mountMainLayout();
    await router.push({ name: routeName });
    await flushPromises();
  };

  beforeEach(() => {
    resetManager();
  });

  afterEach(() => {
    stopFocus?.();
    stopFocus = undefined;
    wrapper?.unmount();
    wrapper = undefined;
    delete window.__O2_ASSISTANT_V2__;
    resetAssistantV2ForTests();
    resetManager();
  });

  it("opens the palette on ⌘K away from Home, with no way back", async () => {
    await mountV2(true);
    expect(goTo()?.allowInInput).toBe(true);
    expect(palette().exists()).toBe(false);
    goTo()!.handler(new KeyboardEvent("keydown"));
    await flushPromises();
    expect(palette().props("open")).toBe(true);
    expect(palette().props("homeReturn")).toBeNull();
  });

  it("opens the palette for the editor's request too", async () => {
    await mountV2(true);
    requestGoTo("editor");
    await flushPromises();
    expect(palette().props("open")).toBe(true);
  });

  it("opens the palette on Home even while the Ask box listens, since / is its own key", async () => {
    const focus = vi.fn();
    stopFocus = onOverviewFocusRequest(focus);
    await mountV2(true, "home");
    goTo()!.handler(new KeyboardEvent("keydown"));
    await flushPromises();
    expect(focus).not.toHaveBeenCalled();
    expect(palette().props("open")).toBe(true);
  });

  it("opens the palette on Home and marks the trip", async () => {
    await mountV2(true, "home");
    goTo()!.handler(new KeyboardEvent("keydown"));
    await flushPromises();
    expect(palette().props("open")).toBe(true);
    expect(palette().props("homeReturn")).toEqual({ focus: "ask" });
  });

  it("binds nothing when v2 is off", async () => {
    await mountV2(false);
    expect(goTo()).toBeUndefined();
    requestGoTo("editor");
    await flushPromises();
    expect(palette().exists()).toBe(false);
  });
});
