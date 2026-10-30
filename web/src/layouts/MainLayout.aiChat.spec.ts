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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { defineComponent, h, watch } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));

vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { setUser: vi.fn(), startView: vi.fn() },
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });

type Delivery = { payload: Record<string, unknown>; isOpen: boolean };

/** What the chat panel observed through its props, in arrival order. */
const seenPayloads: Delivery[] = [];
const seenInputContexts: string[] = [];

const ChatStub = defineComponent({
  name: "O2AIChat",
  props: ["isOpen", "aiChatPayload", "aiChatInputContext", "appendMode", "headerHeight"],
  setup(props) {
    watch(
      () => props.aiChatPayload,
      (payload) => seenPayloads.push({ payload, isOpen: props.isOpen }),
    );
    watch(
      () => props.aiChatInputContext,
      (value) => seenInputContexts.push(value),
    );
    return () => h("div");
  },
});

function mountMainLayout() {
  return mount(MainLayout, {
    global: {
      plugins: [store, i18n, router],
      stubs: {
        AppHeader: StubDiv,
        ONavbar: StubDiv,
        O2AIChat: ChatStub,
        WebinarBanner: StubDiv,
        AnnouncementBanner: StubDiv,
        ShortcutCheatsheet: StubDiv,
        GetStarted: StubDiv,
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

const HANDOFF = {
  query: "Root cause: checkout-db connection pool exhausted",
  chipName: "Analysis · run 3",
  newChat: true,
  autoSend: false,
  context: { currentPage: "incidents", org_id: "default" },
};

describe("MainLayout — sendToAiChat", () => {
  let wrapper: VueWrapper | undefined;

  const open = async (isOpen: boolean) => {
    store.state.isAiChatEnabled = isOpen;
    wrapper = mountMainLayout();
    await flushPromises();
    seenPayloads.length = 0;
    seenInputContexts.length = 0;
  };

  const send = (...args: unknown[]) => {
    // Options-API setup return is not reflected in the mounted instance's type.
    const layout = wrapper!.vm as unknown as { sendToAiChat: (...a: unknown[]) => void };
    layout.sendToAiChat(...args);
  };

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    store.state.isAiChatEnabled = false;
  });

  describe("named-chip hand-off", () => {
    it("forwards every hand-off field to the chat panel and never auto-sends", async () => {
      await open(true);

      send({ ...HANDOFF, autoSend: true });
      await flushPromises();

      expect(seenPayloads).toHaveLength(1);
      expect(seenPayloads[0].payload).toEqual({
        text: HANDOFF.query,
        chipName: HANDOFF.chipName,
        newChat: true,
        autoSend: false,
        context: { currentPage: "incidents", org_id: "default" },
        id: expect.any(Number),
      });
    });

    it("does not pulse the legacy input context, so no generic chip appears too", async () => {
      await open(true);

      send(HANDOFF);
      await flushPromises();

      expect(seenInputContexts).toEqual([]);
    });

    it("opens a closed panel and delivers the payload only once the panel is open", async () => {
      await open(false);

      send(HANDOFF);
      expect(store.state.isAiChatEnabled).toBe(true);
      await flushPromises();

      expect(seenPayloads).toHaveLength(1);
      expect(seenPayloads[0].isOpen).toBe(true);
      expect(seenPayloads[0].payload).toMatchObject({ chipName: HANDOFF.chipName, newChat: true });
    });

    it("defaults newChat to false and context to null when they are absent or malformed", async () => {
      await open(true);

      send({ query: "q", chipName: "Analysis", context: "not-an-object" });
      await flushPromises();

      expect(seenPayloads[0].payload).toMatchObject({
        text: "q",
        chipName: "Analysis",
        newChat: false,
        context: null,
        autoSend: false,
      });
    });

    it("delivers a second identical hand-off as a new payload", async () => {
      await open(true);
      const now = vi.spyOn(Date, "now");

      now.mockReturnValue(1000);
      send(HANDOFF);
      await flushPromises();
      now.mockReturnValue(2000);
      send(HANDOFF);
      await flushPromises();

      expect(seenPayloads).toHaveLength(2);
      now.mockRestore();
    });
  });

  describe("existing callers", () => {
    it("a plain string goes through the legacy input context and is not auto-sent", async () => {
      await open(true);

      send("level=error msg=boom");
      await flushPromises();

      expect(seenPayloads).toHaveLength(1);
      expect(seenPayloads[0].payload).toEqual({
        text: "level=error msg=boom",
        autoSend: false,
        id: expect.any(Number),
      });
      expect(seenInputContexts).toContain("level=error msg=boom");
      expect(seenInputContexts[seenInputContexts.length - 1]).toBe("");
    });

    it("a plain string with autoSend set is delivered as auto-send", async () => {
      await open(true);

      send("show me slow traces", true, true);
      await flushPromises();

      expect(seenPayloads[0].payload).toMatchObject({
        text: "show me slow traces",
        autoSend: true,
      });
    });

    it("{query, autoSend} without chipName keeps the old payload shape", async () => {
      await open(false);

      send({ query: "what changed?", autoSend: true });
      expect(store.state.isAiChatEnabled).toBe(true);
      await flushPromises();

      expect(seenPayloads).toHaveLength(1);
      expect(seenPayloads[0].payload).toEqual({
        text: "what changed?",
        autoSend: true,
        id: expect.any(Number),
      });
      expect(seenInputContexts).toContain("what changed?");
    });

    it("an empty chipName stays on the old path", async () => {
      await open(true);

      send({ query: "q", chipName: "", autoSend: true });
      await flushPromises();

      expect(seenPayloads[0].payload).toEqual({
        text: "q",
        autoSend: true,
        id: expect.any(Number),
      });
      expect(seenInputContexts).toContain("q");
    });
  });
});
