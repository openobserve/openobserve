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

function mountMainLayout() {
  return mount(MainLayout, {
    global: {
      plugins: [store, i18n, router],
      stubs: {
        AppHeader: StubDiv,
        ONavbar: StubDiv,
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

  beforeEach(() => {
    resetManager();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    config.isEnterprise = originalIsEnterprise;
    store.state.zoConfig.ai_enabled = false;
    resetManager();
  });

  // The assistant owns its own shortcuts, so the layout binds no Ctrl+B chat toggle.
  it("registers no ctrl+b chat toggle, even on enterprise with AI on", async () => {
    config.isEnterprise = "true";
    store.state.zoConfig.ai_enabled = true;

    wrapper = mountMainLayout();
    await flushPromises();

    expect(getManager()?.getById("aiChatToggle")).toBeUndefined();
  });
});
