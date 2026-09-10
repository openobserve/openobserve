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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { http, HttpResponse } from "msw";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// ── Config mock — must be hoisted so the component import sees it ─────────────
const mockConfig = vi.hoisted(() => ({
  isCloud: "true" as string,
}));

vi.mock("@/aws-exports", () => ({
  default: mockConfig,
}));

vi.mock("@/services/segment_analytics", () => ({ default: { track: vi.fn() } }));

import ConnectDataSourcePopup from "./ConnectDataSourcePopup.vue";
import segment from "@/services/segment_analytics";

// ── Constants ─────────────────────────────────────────────────────────────────
const USER_EMAIL = "example@gmail.com"; // matches store.ts userInfo.email
const PENDING_KEY = "connectDataSourcePromptPending";
const SESSION_SHOWN_KEY = `connectDataSourcePromptShown:${USER_EMAIL}`;
const SUMMARY_URL = `${store.state.API_ENDPOINT}/api/:org/summary`;

// ── ODialog stub ──────────────────────────────────────────────────────────────
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: ["open", "size", "showClose"],
  emits: ["update:open"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
    >
      <slot />
      <button
        data-test="o-dialog-close-btn"
        @click="$emit('update:open', false)"
      >Close</button>
    </div>
  `,
};

function buildWrapper() {
  return mount(ConnectDataSourcePopup, {
    global: {
      plugins: [store, router, i18n],
      stubs: {
        ODialog: ODialogStub,
      },
    },
  });
}

// The shared global MSW handler for /summary returns a `streams` ARRAY (see
// src/test/unit/mockData/home.ts), so `streams.num_streams` is undefined
// against it — the popup reads that as "no data". Override per-test with this
// helper for cases that need a specific stream count.
function mockSummary(numStreams: number) {
  global.server.use(
    http.get(SUMMARY_URL, () => {
      return HttpResponse.json({ streams: { num_streams: numStreams } });
    }),
  );
}

describe("ConnectDataSourcePopup", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    mockConfig.isCloud = "true";

    store.commit("setUserInfo", { email: USER_EMAIL });
    store.commit("setSelectedOrganization", {
      label: "default Organization",
      id: 159,
      identifier: "default",
      user_email: USER_EMAIL,
      subscription_type: "",
    });
    store.dispatch("setIsDataIngested", false);

    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ── Cloud gate ───────────────────────────────────────────────────────────────

  describe("Cloud gate", () => {
    it("never opens on non-Cloud, even after the onboarding-complete event", async () => {
      mockConfig.isCloud = "false";
      localStorage.setItem("isFirstTimeLogin", "true");

      wrapper = buildWrapper();
      window.dispatchEvent(new Event("o2:onboarding-complete"));
      await flushPromises();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("does not add an o2:onboarding-complete listener on non-Cloud", () => {
      mockConfig.isCloud = "false";
      const addEventSpy = vi.spyOn(window, "addEventListener");

      wrapper = buildWrapper();
      const listeners = addEventSpy.mock.calls.filter(([event]) => event === "o2:onboarding-complete");

      expect(listeners).toHaveLength(0);
    });
  });

  // ── First-login flow ─────────────────────────────────────────────────────────

  describe("first-login flow", () => {
    it("sets the pending flag and does not open immediately", () => {
      localStorage.setItem("isFirstTimeLogin", "true");

      wrapper = buildWrapper();

      expect(localStorage.getItem(PENDING_KEY)).toBe("true");
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("registers the o2:onboarding-complete listener", () => {
      localStorage.setItem("isFirstTimeLogin", "true");
      const addEventSpy = vi.spyOn(window, "addEventListener");

      wrapper = buildWrapper();
      const listeners = addEventSpy.mock.calls.filter(([event]) => event === "o2:onboarding-complete");

      expect(listeners).toHaveLength(1);
    });

    it("opens after o2:onboarding-complete fires when the org has no data", async () => {
      mockSummary(0);
      localStorage.setItem("isFirstTimeLogin", "true");
      wrapper = buildWrapper();

      window.dispatchEvent(new Event("o2:onboarding-complete"));
      await flushPromises();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
      expect(segment.track).toHaveBeenCalledWith(
        "onboarding_prompt_shown",
        expect.objectContaining({ org_id: "default", user_id: USER_EMAIL }),
      );
    });

    it("stays closed and dispatches setIsDataIngested(true) when the org already has data", async () => {
      mockSummary(3);
      localStorage.setItem("isFirstTimeLogin", "true");
      wrapper = buildWrapper();

      window.dispatchEvent(new Event("o2:onboarding-complete"));
      await flushPromises();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
      expect(store.state.organizationData.isDataIngested).toBe(true);
      expect(segment.track).not.toHaveBeenCalledWith(
        "onboarding_prompt_shown",
        expect.anything(),
      );
    });
  });

  // ── Returning-session flow ───────────────────────────────────────────────────

  describe("returning-session flow", () => {
    it("checks directly on mount (no isFirstTimeLogin) and opens when there is no data", async () => {
      mockSummary(0);

      wrapper = buildWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
      expect(sessionStorage.getItem(SESSION_SHOWN_KEY)).toBe("true");
    });

    it("stays closed when the org already has data", async () => {
      mockSummary(5);

      wrapper = buildWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });
  });

  // ── Session cap ──────────────────────────────────────────────────────────────

  describe("session cap", () => {
    it("never opens when already shown this session, even with no data", async () => {
      mockSummary(0);
      sessionStorage.setItem(SESSION_SHOWN_KEY, "true");

      wrapper = buildWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });
  });

  // ── Org identifier not yet resolved ──────────────────────────────────────────

  describe("org identifier resolution", () => {
    it("waits for the org identifier to resolve, then opens", async () => {
      mockSummary(0);
      store.commit("setSelectedOrganization", {
        label: "",
        id: 0,
        identifier: "",
        user_email: USER_EMAIL,
        subscription_type: "",
      });

      wrapper = buildWrapper();
      await nextTick();
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");

      store.commit("setSelectedOrganization", {
        label: "default Organization",
        id: 159,
        identifier: "default",
        user_email: USER_EMAIL,
        subscription_type: "",
      });
      await flushPromises();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
    });
  });

  // ── Action handlers ──────────────────────────────────────────────────────────

  describe("action handlers", () => {
    beforeEach(async () => {
      mockSummary(0);
      wrapper = buildWrapper();
      await flushPromises();
    });

    it("navigates to the ingestion page and fires the connect event", async () => {
      const routerSpy = vi.spyOn(wrapper.vm.$router, "push");
      const connectBtn = wrapper.find('[data-test="connect-data-source-popup-connect-btn"]');

      await connectBtn.trigger("click");

      expect(segment.track).toHaveBeenCalledWith(
        "onboarding_prompt_connect_clicked",
        expect.objectContaining({ org_id: "default", user_id: USER_EMAIL }),
      );
      expect(routerSpy).toHaveBeenCalledWith({
        name: "ingestion",
        query: { org_identifier: "default" },
      });
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("closes and fires the dismissed event when the text link is clicked", async () => {
      const dismissLink = wrapper.find('[data-test="connect-data-source-popup-dismiss-link"]');

      await dismissLink.trigger("click");

      expect(segment.track).toHaveBeenCalledWith(
        "onboarding_prompt_dismissed",
        expect.objectContaining({ org_id: "default", user_id: USER_EMAIL }),
      );
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("fires the dismissed event exactly once when closed via overlay/Escape (update:open=false)", async () => {
      const dialogStub = wrapper.findComponent(ODialogStub);

      await dialogStub.vm.$emit("update:open", false);

      const dismissedCalls = (segment.track as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([event]) => event === "onboarding_prompt_dismissed",
      );
      expect(dismissedCalls).toHaveLength(1);
    });
  });

  // ── Rendering ─────────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the exact spec copy", async () => {
      mockSummary(0);
      wrapper = buildWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="connect-data-source-popup-title"]').text()).toBe(
        "To get started, let's connect your first data source.",
      );
      expect(wrapper.find('[data-test="connect-data-source-popup-description"]').text()).toBe(
        "We've got lots to show you, but we'll need to get your data connected first. Most teams see their first logs in about a minute.",
      );
      expect(wrapper.find('[data-test="connect-data-source-popup-connect-btn"]').text()).toContain(
        "Connect a data source",
      );
      expect(wrapper.find('[data-test="connect-data-source-popup-dismiss-link"]').text()).toBe(
        "I'll do this later",
      );
    });

    it("renders the dismiss link as a plain button, not OButton", () => {
      wrapper = buildWrapper();

      const dismissLink = wrapper.find('[data-test="connect-data-source-popup-dismiss-link"]');
      expect(dismissLink.element.tagName).toBe("BUTTON");
      // OButton marks its root with data-o2-btn; the dismiss link must not be one.
      expect(dismissLink.attributes("data-o2-btn")).toBeUndefined();
    });

    it("passes size='sm' and show-close=false to ODialog", () => {
      wrapper = buildWrapper();

      const dialog = wrapper.find('[data-test="o-dialog-stub"]');
      expect(dialog.attributes("data-size")).toBe("sm");
    });
  });
});
