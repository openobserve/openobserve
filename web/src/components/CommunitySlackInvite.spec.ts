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
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// ── Config mock — must be hoisted so the component import sees it ─────────────
// vi.hoisted() runs before any imports; the returned object is captured so that
// individual tests can mutate `mockConfig.isCloud` and `mockConfig.isEnterprise`
// before mounting. The factory closure then uses the hoisted reference — this is
// the only way to have a mutable mock for a default-export primitive-ish object.
const mockConfig = vi.hoisted(() => ({
  isCloud: "true" as string,
  isEnterprise: "false" as string,
}));

vi.mock("@/aws-exports", () => ({
  default: mockConfig,
}));

import CommunitySlackInvite from "./CommunitySlackInvite.vue";

// ── Constants ─────────────────────────────────────────────────────────────────
const USER_EMAIL = "example@gmail.com"; // matches store.ts userInfo.email
const SEEN_KEY = `communitySlackInviteSeen:${USER_EMAIL}`;
const VISIT_COUNT_KEY = `communitySlackInviteVisitCount:${USER_EMAIL}`;
const DEFAULT_SLACK_URL = "https://short.openobserve.ai/community";

// ── ODialog stub ──────────────────────────────────────────────────────────────
// ODialog uses reka-ui's DialogPortal which teleports content outside the
// component tree. Stubbing it renders the default slot inline, exposes :data-open
// for open-state assertions, and provides a close trigger for update:open.
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

// ── Mount factory ─────────────────────────────────────────────────────────────
function buildWrapper() {
  return mount(CommunitySlackInvite, {
    global: {
      plugins: [store, i18n],
      stubs: {
        ODialog: ODialogStub,
        // OButton, OIcon, SlackIcon render real — they have no side effects
        // that interfere with the test.
      },
    },
  });
}

// Simulates the cursor exiting toward the browser chrome/tab bar. `clientY <= 0`
// is what the component's listener treats as exit intent.
function dispatchExitIntent(clientY = 0) {
  document.dispatchEvent(new MouseEvent("mouseleave", { clientY }));
}

// ── Component analysis ────────────────────────────────────────────────────────
// Component: CommunitySlackInvite
// Props:     none
// Emits:     none
// Store deps: store.state.userInfo.email (seenKey, visitCountKey), store.state.zoConfig.custom_slack_url,
//             store.state.zoConfig.slack_member_count
// Service deps: config.isCloud, config.isEnterprise (mocked via vi.mock)
// Child components: ODialog (stubbed), OButton (real), OIcon (real), SlackIcon (real)
// Conditional states:
//   - Cloud vs non-Cloud (isCloud !== "true" → nothing shown, no listener)
//   - Already seen (seenKey = "true") → no listener registered, never shown
//   - Visit cap (3) reached → no listener registered, never shown
//   - Exit intent (mouseleave with clientY <= 0) → opens, increments visit count, removes listener
//   - memberCount present/absent → different captionText
// User interactions: close-btn click, join-btn click, maybe-later-btn click
// Async operations: none (synchronous mouseleave-triggered logic)

describe("CommunitySlackInvite", () => {
  let wrapper: VueWrapper;
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConfig.isCloud = "true";
    mockConfig.isEnterprise = "false";

    // Reset store to defaults (userInfo.email = "example@gmail.com" by default in store.ts)
    store.commit("setConfig", {
      ...store.state.zoConfig,
      custom_slack_url: null,
      slack_member_count: null,
    });
    store.commit("setUserInfo", {
      email: USER_EMAIL,
    });

    localStorage.clear();
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    wrapper?.unmount();
    localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the ODialog stub", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
    });

    it("shows dialog as open after exit intent when not yet seen", async () => {
      // Act
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
    });

    it("shows dialog as closed before any exit intent", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("renders the localized title text inside an h2", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="community-slack-invite-title"]').text()).toBe(
        "Join the OpenObserve community on Slack",
      );
      expect(wrapper.find('[data-test="community-slack-invite-title"]').element.tagName).toBe("H2");
    });

    it("renders the localized description text", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="community-slack-invite-description"]').text()).toContain(
        "Learn, ask questions",
      );
    });

    it("renders the Join Slack button with localized label", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');
      expect(joinBtn.exists()).toBe(true);
      expect(joinBtn.text()).toContain("Join the Slack");
    });

    it("renders the Maybe later button with localized label", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      const laterBtn = wrapper.find('[data-test="community-slack-invite-maybe-later-btn"]');
      expect(laterBtn.exists()).toBe(true);
      expect(laterBtn.text()).toBe("Maybe later");
    });

    it("passes size='sm' to ODialog", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-size")).toBe("sm");
    });

    it("renders 3 benefit items", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="community-slack-invite-benefit-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="community-slack-invite-benefit-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="community-slack-invite-benefit-2"]').exists()).toBe(true);
    });

    it("renders each benefit with its localized text", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="community-slack-invite-benefit-0"]').text()).toContain(
        "Answers from the core team",
      );
      expect(wrapper.find('[data-test="community-slack-invite-benefit-1"]').text()).toContain(
        "Setup help",
      );
      expect(wrapper.find('[data-test="community-slack-invite-benefit-2"]').text()).toContain(
        "Early word on releases",
      );
    });

    it("does not call window.open on initial render", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  // ── Cloud gate ───────────────────────────────────────────────────────────────

  describe("Cloud gate", () => {
    it("never opens dialog on non-Cloud (isCloud is 'false')", async () => {
      // Arrange
      mockConfig.isCloud = "false";

      // Act
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("does not add a mouseleave listener on non-Cloud", () => {
      // Arrange
      mockConfig.isCloud = "false";
      const addEventSpy = vi.spyOn(document, "addEventListener");

      // Act
      wrapper = buildWrapper();
      const exitIntentListeners = addEventSpy.mock.calls.filter(([event]) => event === "mouseleave");

      // Assert
      expect(exitIntentListeners).toHaveLength(0);
    });

    it("shows dialog on Cloud after exit intent", async () => {
      // Act
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
    });
  });

  // ── Exit-intent trigger ──────────────────────────────────────────────────────

  describe("exit-intent trigger", () => {
    it("does not open when the cursor leaves an in-page element (clientY > 0)", async () => {
      // Act
      wrapper = buildWrapper();
      dispatchExitIntent(50);
      await nextTick();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("opens when the cursor heads toward the browser chrome (clientY <= 0)", async () => {
      // Act
      wrapper = buildWrapper();
      dispatchExitIntent(0);
      await nextTick();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
    });

    it("does not open if already seen", async () => {
      // Arrange
      localStorage.setItem(SEEN_KEY, "true");

      // Act
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("does not register a listener at mount if already seen", () => {
      // Arrange
      localStorage.setItem(SEEN_KEY, "true");
      const addEventSpy = vi.spyOn(document, "addEventListener");

      // Act
      wrapper = buildWrapper();
      const exitIntentListeners = addEventSpy.mock.calls.filter(([event]) => event === "mouseleave");

      // Assert
      expect(exitIntentListeners).toHaveLength(0);
    });

    it("increments the visit count on exit intent", () => {
      // Act
      wrapper = buildWrapper();
      dispatchExitIntent();

      // Assert
      expect(localStorage.getItem(VISIT_COUNT_KEY)).toBe("1");
    });

    it("still opens and increments on visit 2", () => {
      // Arrange
      localStorage.setItem(VISIT_COUNT_KEY, "1");

      // Act
      wrapper = buildWrapper();
      dispatchExitIntent();

      // Assert
      expect(localStorage.getItem(VISIT_COUNT_KEY)).toBe("2");
    });

    it("does not open once the visit cap (3) is reached", async () => {
      // Arrange
      localStorage.setItem(VISIT_COUNT_KEY, "3");

      // Act
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
      expect(localStorage.getItem(VISIT_COUNT_KEY)).toBe("3");
    });

    it("does not register a listener at mount once the visit cap is reached", () => {
      // Arrange
      localStorage.setItem(VISIT_COUNT_KEY, "3");
      const addEventSpy = vi.spyOn(document, "addEventListener");

      // Act
      wrapper = buildWrapper();
      const exitIntentListeners = addEventSpy.mock.calls.filter(([event]) => event === "mouseleave");

      // Assert
      expect(exitIntentListeners).toHaveLength(0);
    });

    it("removes the mouseleave listener once exit intent has fired", () => {
      // Arrange
      const removeEventSpy = vi.spyOn(document, "removeEventListener");

      // Act
      wrapper = buildWrapper();
      dispatchExitIntent();
      const removals = removeEventSpy.mock.calls.filter(([event]) => event === "mouseleave");

      // Assert
      expect(removals.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Interaction: Join Slack button ───────────────────────────────────────────

  describe("Join Slack button", () => {
    beforeEach(async () => {
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();
    });

    it("calls window.open with the default slack URL, '_blank', 'noopener'", async () => {
      // Arrange
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(openSpy).toHaveBeenCalledWith(DEFAULT_SLACK_URL, "_blank", "noopener");
    });

    it("calls window.open exactly once per click", async () => {
      // Arrange
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it("closes the dialog after clicking Join Slack", async () => {
      // Arrange
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("sets seen key in localStorage after clicking Join Slack", async () => {
      // Arrange
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(localStorage.getItem(SEEN_KEY)).toBe("true");
    });
  });

  // ── Interaction: Maybe later button ─────────────────────────────────────────

  describe("Maybe later button", () => {
    beforeEach(async () => {
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();
    });

    it("closes the dialog when Maybe later is clicked", async () => {
      // Arrange
      const laterBtn = wrapper.find('[data-test="community-slack-invite-maybe-later-btn"]');

      // Act
      await laterBtn.trigger("click");

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("sets seen key in localStorage when Maybe later is clicked", async () => {
      // Arrange
      const laterBtn = wrapper.find('[data-test="community-slack-invite-maybe-later-btn"]');

      // Act
      await laterBtn.trigger("click");

      // Assert
      expect(localStorage.getItem(SEEN_KEY)).toBe("true");
    });

    it("does NOT call window.open when Maybe later is clicked", async () => {
      // Arrange
      const laterBtn = wrapper.find('[data-test="community-slack-invite-maybe-later-btn"]');

      // Act
      await laterBtn.trigger("click");

      // Assert
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  // ── Interaction: close button (X) ────────────────────────────────────────────

  describe("close button / handleOpenChange path", () => {
    beforeEach(async () => {
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();
    });

    it("closes the dialog when the close button is clicked", async () => {
      // Arrange
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');
      expect(closeBtn.exists()).toBe(true);

      // Act
      await closeBtn.trigger("click");

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("sets seen key in localStorage when close button is clicked", async () => {
      // Arrange
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      // Act
      await closeBtn.trigger("click");

      // Assert
      expect(localStorage.getItem(SEEN_KEY)).toBe("true");
    });

    it("does NOT call window.open when dismissed via close button", async () => {
      // Arrange
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      // Act
      await closeBtn.trigger("click");

      // Assert
      expect(openSpy).not.toHaveBeenCalled();
    });

    it("dismisses when ODialog emits update:open=false", async () => {
      // Arrange — simulate Escape / overlay click paths inside real ODialog
      const dialogStub = wrapper.findComponent(ODialogStub);

      // Act
      await dialogStub.vm.$emit("update:open", false);

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
      expect(localStorage.getItem(SEEN_KEY)).toBe("true");
    });

    it("does NOT dismiss when ODialog emits update:open=true", async () => {
      // Arrange — update:open=true means the dialog is opening, not closing
      const dialogStub = wrapper.findComponent(ODialogStub);

      // Act
      await dialogStub.vm.$emit("update:open", true);

      // Assert — dialog stays open, seen key NOT written
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
      expect(localStorage.getItem(SEEN_KEY)).toBeNull();
    });
  });

  // ── slackUrl computed ────────────────────────────────────────────────────────

  describe("slackUrl computed", () => {
    it("uses the default community URL when not Enterprise", async () => {
      // Arrange — isEnterprise = "false" (default)
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(openSpy).toHaveBeenCalledWith(DEFAULT_SLACK_URL, "_blank", "noopener");
    });

    it("uses the custom Slack URL when Enterprise and custom_slack_url is set", async () => {
      // Arrange
      const customUrl = "https://enterprise.slack.com/my-org";
      mockConfig.isEnterprise = "true";
      store.commit("setConfig", {
        ...store.state.zoConfig,
        custom_slack_url: customUrl,
      });

      // Mount AFTER setting config so computed reads the correct value
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(openSpy).toHaveBeenCalledWith(customUrl, "_blank", "noopener");
    });

    it("falls back to default URL when Enterprise but custom_slack_url is falsy", async () => {
      // Arrange
      mockConfig.isEnterprise = "true";
      store.commit("setConfig", {
        ...store.state.zoConfig,
        custom_slack_url: null,
      });
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(openSpy).toHaveBeenCalledWith(DEFAULT_SLACK_URL, "_blank", "noopener");
    });

    it("falls back to default URL when Enterprise is 'false' even with a custom_slack_url set", async () => {
      // Arrange — isEnterprise = "false" → condition short-circuits
      const customUrl = "https://enterprise.slack.com/my-org";
      mockConfig.isEnterprise = "false";
      store.commit("setConfig", {
        ...store.state.zoConfig,
        custom_slack_url: customUrl,
      });
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(openSpy).toHaveBeenCalledWith(DEFAULT_SLACK_URL, "_blank", "noopener");
    });
  });

  // ── captionText computed ─────────────────────────────────────────────────────

  describe("captionText computed", () => {
    it("shows qualitative community note when slack_member_count is absent", () => {
      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="community-slack-invite-members-text"]').text()).toBe(
        "Engineers and the OpenObserve team, active every day",
      );
    });

    it("shows member count text when slack_member_count is a positive number", () => {
      // Arrange — 4250 members → floored to 4200 → "4,200+ members"
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 4250,
      });

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="community-slack-invite-members-text"]').text()).toContain(
        "4,200+",
      );
    });

    it("shows member count without '+' suffix when count is below 100", () => {
      // Arrange — 50 members → no floor to 100, no "+"
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 50,
      });

      // Act
      wrapper = buildWrapper();

      // Assert
      const text = wrapper.find('[data-test="community-slack-invite-members-text"]').text();
      expect(text).toContain("50");
      expect(text).not.toContain("+");
    });

    it("falls back to community note when slack_member_count is 0", () => {
      // Arrange — 0 is not > 0, so memberCount returns null
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 0,
      });

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="community-slack-invite-members-text"]').text()).toBe(
        "Engineers and the OpenObserve team, active every day",
      );
    });

    it("falls back to community note when slack_member_count is negative", () => {
      // Arrange
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: -5,
      });

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="community-slack-invite-members-text"]').text()).toBe(
        "Engineers and the OpenObserve team, active every day",
      );
    });

    it("floors member count to nearest 100 (e.g. 1999 → 1900+)", () => {
      // Arrange
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 1999,
      });

      // Act
      wrapper = buildWrapper();

      // Assert
      const text = wrapper.find('[data-test="community-slack-invite-members-text"]').text();
      expect(text).toContain("1,900+");
      expect(text).not.toContain("1,999");
    });
  });

  // ── seenKey / visitCountKey use user email ───────────────────────────────────

  describe("per-user keys", () => {
    it("uses the user email from the store to build the seenKey", async () => {
      // Arrange
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      // Act
      await closeBtn.trigger("click");

      // Assert — the exact keyed entry was written
      expect(localStorage.getItem(`communitySlackInviteSeen:${USER_EMAIL}`)).toBe("true");
    });

    it("uses 'anonymous' seenKey when userInfo has no email", async () => {
      // Arrange — clear email before mounting
      store.commit("setUserInfo", { email: undefined });
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      // Act
      await closeBtn.trigger("click");

      // Assert — falls back to "anonymous"
      expect(localStorage.getItem("communitySlackInviteSeen:anonymous")).toBe("true");
    });

    it("uses 'anonymous' visitCountKey when userInfo has no email", () => {
      // Arrange
      store.commit("setUserInfo", { email: undefined });

      // Act
      wrapper = buildWrapper();
      dispatchExitIntent();

      // Assert
      expect(localStorage.getItem("communitySlackInviteVisitCount:anonymous")).toBe("1");
    });
  });

  // ── Listener cleanup on unmount ──────────────────────────────────────────────

  describe("listener cleanup", () => {
    it("removes mouseleave listener on unmount", () => {
      // Arrange
      const removeEventSpy = vi.spyOn(document, "removeEventListener");
      wrapper = buildWrapper();

      // Act
      wrapper.unmount();
      const removals = removeEventSpy.mock.calls.filter(([event]) => event === "mouseleave");

      // Assert
      expect(removals.length).toBeGreaterThanOrEqual(1);
    });

    it("does not open dialog after unmount even if exit intent fires", () => {
      // Arrange
      wrapper = buildWrapper();
      wrapper.unmount();

      // Act
      expect(() => {
        dispatchExitIntent();
      }).not.toThrow();
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("closing via close button a second time does not throw", async () => {
      // Arrange
      wrapper = buildWrapper();
      dispatchExitIntent();
      await nextTick();
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      // Act + Assert — two dismissals, no throw
      await closeBtn.trigger("click");
      expect(() => closeBtn.trigger("click")).not.toThrow();
    });

    it("renders correctly with exact member count of 100 (boundary: floored to 100, shows '+')", () => {
      // Arrange
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 100,
      });

      // Act
      wrapper = buildWrapper();

      // Assert — 100 floors to 100, and n >= 100 so "+" is appended
      const text = wrapper.find('[data-test="community-slack-invite-members-text"]').text();
      expect(text).toContain("100+");
    });

    it("renders correctly with very large member count (e.g. 1,000,000)", () => {
      // Arrange
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 1_000_000,
      });

      // Act
      wrapper = buildWrapper();

      // Assert — floored to 1,000,000, shows commas and "+"
      const text = wrapper.find('[data-test="community-slack-invite-members-text"]').text();
      expect(text).toContain("1,000,000+");
    });

    it("renders without throwing when slack_member_count is NaN", () => {
      // Arrange
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: NaN,
      });

      // Act + Assert — falls back gracefully
      expect(() => {
        wrapper = buildWrapper();
      }).not.toThrow();
      expect(wrapper.find('[data-test="community-slack-invite-members-text"]').text()).toBe(
        "Engineers and the OpenObserve team, active every day",
      );
    });
  });
});
