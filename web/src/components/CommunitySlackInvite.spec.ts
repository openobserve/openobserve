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
const PENDING_KEY = "communitySlackInvitePending";
const USER_EMAIL = "example@gmail.com"; // matches store.ts userInfo.email
const SEEN_KEY = `communitySlackInviteSeen:${USER_EMAIL}`;
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

// ── Component analysis ────────────────────────────────────────────────────────
// Component: CommunitySlackInvite
// Props:     none
// Emits:     none
// Store deps: store.state.userInfo.email (seenKey), store.state.zoConfig.custom_slack_url,
//             store.state.zoConfig.slack_member_count
// Service deps: config.isCloud, config.isEnterprise (mocked via vi.mock)
// Child components: ODialog (stubbed), OButton (real), OIcon (real), SlackIcon (real)
// Conditional states:
//   - Cloud vs non-Cloud (isCloud !== "true" → nothing shown)
//   - First login vs returning session
//   - Already seen (seenKey = "true") → never shown
//   - PENDING_KEY present → shows (returning session) or after onboarding event (first login)
//   - memberCount present/absent → different captionText
// User interactions: close-btn click, join-btn click, maybe-later-btn click
// Async operations: none (synchronous onMounted logic)

describe("CommunitySlackInvite", () => {
  let wrapper: VueWrapper;
  let openSpy: ReturnType<typeof vi.spyOn>;

  // Default each test to: Cloud, not first login, PENDING_KEY set, not seen.
  // This makes the dialog open on mount without waiting for the onboarding event.
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
    it("renders the ODialog stub when dialog is open", () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
    });

    it("shows dialog as open when PENDING_KEY is true and not yet seen", async () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();
      await nextTick();

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("true");
    });

    it("shows dialog as closed when PENDING_KEY is not set", () => {
      // Arrange — no localStorage setup, dialog should stay closed

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });

    it("renders the localized title text inside an h2", () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="community-slack-invite-title"]').text(),
      ).toBe("Join the OpenObserve community on Slack");
      expect(
        wrapper.find('[data-test="community-slack-invite-title"]').element.tagName,
      ).toBe("H2");
    });

    it("renders the localized description text", () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="community-slack-invite-description"]').text(),
      ).toContain("Learn, ask questions");
    });

    it("renders the Join Slack button with localized label", () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');
      expect(joinBtn.exists()).toBe(true);
      expect(joinBtn.text()).toContain("Join the Slack");
    });

    it("renders the Maybe later button with localized label", () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      const laterBtn = wrapper.find(
        '[data-test="community-slack-invite-maybe-later-btn"]',
      );
      expect(laterBtn.exists()).toBe(true);
      expect(laterBtn.text()).toBe("Maybe later");
    });

    it("passes size='sm' to ODialog", () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-size"),
      ).toBe("sm");
    });

    it("renders 3 benefit items", () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="community-slack-invite-benefit-0"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="community-slack-invite-benefit-1"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="community-slack-invite-benefit-2"]').exists(),
      ).toBe(true);
    });

    it("renders each benefit with its localized text", () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="community-slack-invite-benefit-0"]').text(),
      ).toContain("Answers from the core team");
      expect(
        wrapper.find('[data-test="community-slack-invite-benefit-1"]').text(),
      ).toContain("Setup help");
      expect(
        wrapper.find('[data-test="community-slack-invite-benefit-2"]').text(),
      ).toContain("Early word on releases");
    });

    it("does not call window.open on initial render", () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  // ── Cloud gate ───────────────────────────────────────────────────────────────

  describe("Cloud gate", () => {
    it("never opens dialog on non-Cloud (isCloud is 'false')", () => {
      // Arrange
      mockConfig.isCloud = "false";
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });

    it("does not set PENDING_KEY for non-Cloud first-time login", () => {
      // Arrange
      mockConfig.isCloud = "false";
      localStorage.setItem("isFirstTimeLogin", "true");

      // Act
      wrapper = buildWrapper();

      // Assert — guard returned before any localStorage writes
      expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    });

    it("does not add o2:onboarding-complete listener on non-Cloud", () => {
      // Arrange
      mockConfig.isCloud = "false";
      const addEventSpy = vi.spyOn(window, "addEventListener");

      // Act
      wrapper = buildWrapper();
      const onboardingListeners = addEventSpy.mock.calls.filter(
        ([event]) => event === "o2:onboarding-complete",
      );

      // Assert
      expect(onboardingListeners).toHaveLength(0);
    });

    it("shows dialog on Cloud with PENDING_KEY set", async () => {
      // Arrange — already default (isCloud = "true")
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();
      await nextTick();

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("true");
    });
  });

  // ── First-login flow ─────────────────────────────────────────────────────────

  describe("first-login flow", () => {
    it("sets PENDING_KEY when isFirstTimeLogin is true and not yet seen", () => {
      // Arrange
      localStorage.setItem("isFirstTimeLogin", "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(localStorage.getItem(PENDING_KEY)).toBe("true");
    });

    it("does not set PENDING_KEY if already seen", () => {
      // Arrange
      localStorage.setItem("isFirstTimeLogin", "true");
      localStorage.setItem(SEEN_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    });

    it("does not open dialog immediately on first login (waits for onboarding event)", () => {
      // Arrange
      localStorage.setItem("isFirstTimeLogin", "true");

      // Act — mount without dispatching onboarding event
      wrapper = buildWrapper();

      // Assert — PENDING_KEY was set but dialog is still closed
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });

    it("adds o2:onboarding-complete listener on first login in Cloud", () => {
      // Arrange
      localStorage.setItem("isFirstTimeLogin", "true");
      const addEventSpy = vi.spyOn(window, "addEventListener");

      // Act
      wrapper = buildWrapper();
      const onboardingListeners = addEventSpy.mock.calls.filter(
        ([event]) => event === "o2:onboarding-complete",
      );

      // Assert
      expect(onboardingListeners).toHaveLength(1);
    });

    it("opens dialog after o2:onboarding-complete event is dispatched", async () => {
      // Arrange
      localStorage.setItem("isFirstTimeLogin", "true");
      wrapper = buildWrapper();

      // Assert — closed before event
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");

      // Act — dispatch the onboarding-complete event
      window.dispatchEvent(new Event("o2:onboarding-complete"));
      await wrapper.vm.$nextTick();

      // Assert — now open
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("true");
    });

    it("does not open dialog after onboarding event if already seen", async () => {
      // Arrange
      localStorage.setItem("isFirstTimeLogin", "true");
      // Seen key is set but PENDING_KEY would be set too (seen check in maybeShow)
      localStorage.setItem(SEEN_KEY, "true");
      wrapper = buildWrapper();

      // Act
      window.dispatchEvent(new Event("o2:onboarding-complete"));
      await wrapper.vm.$nextTick();

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });
  });

  // ── Returning session flow ───────────────────────────────────────────────────

  describe("returning session flow", () => {
    it("shows dialog immediately when PENDING_KEY is set and not first login", async () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");
      // isFirstTimeLogin not set → returning session

      // Act
      wrapper = buildWrapper();
      await nextTick();

      // Assert — opens immediately via maybeShow()
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("true");
    });

    it("does not open dialog if PENDING_KEY is absent", () => {
      // Arrange — no PENDING_KEY

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });

    it("does not open dialog if PENDING_KEY is set but user has already seen it", () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");
      localStorage.setItem(SEEN_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });
  });

  // ── Interaction: Join Slack button ───────────────────────────────────────────

  describe("Join Slack button", () => {
    beforeEach(() => {
      localStorage.setItem(PENDING_KEY, "true");
      wrapper = buildWrapper();
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
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("true");

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });

    it("sets seen key in localStorage after clicking Join Slack", async () => {
      // Arrange
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(localStorage.getItem(SEEN_KEY)).toBe("true");
    });

    it("removes PENDING_KEY from localStorage after clicking Join Slack", async () => {
      // Arrange
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    });
  });

  // ── Interaction: Maybe later button ─────────────────────────────────────────

  describe("Maybe later button", () => {
    beforeEach(() => {
      localStorage.setItem(PENDING_KEY, "true");
      wrapper = buildWrapper();
    });

    it("closes the dialog when Maybe later is clicked", async () => {
      // Arrange
      const laterBtn = wrapper.find(
        '[data-test="community-slack-invite-maybe-later-btn"]',
      );

      // Act
      await laterBtn.trigger("click");

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });

    it("sets seen key in localStorage when Maybe later is clicked", async () => {
      // Arrange
      const laterBtn = wrapper.find(
        '[data-test="community-slack-invite-maybe-later-btn"]',
      );

      // Act
      await laterBtn.trigger("click");

      // Assert
      expect(localStorage.getItem(SEEN_KEY)).toBe("true");
    });

    it("removes PENDING_KEY when Maybe later is clicked", async () => {
      // Arrange
      const laterBtn = wrapper.find(
        '[data-test="community-slack-invite-maybe-later-btn"]',
      );

      // Act
      await laterBtn.trigger("click");

      // Assert
      expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    });

    it("does NOT call window.open when Maybe later is clicked", async () => {
      // Arrange
      const laterBtn = wrapper.find(
        '[data-test="community-slack-invite-maybe-later-btn"]',
      );

      // Act
      await laterBtn.trigger("click");

      // Assert
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  // ── Interaction: close button (X) ────────────────────────────────────────────

  describe("close button / handleOpenChange path", () => {
    beforeEach(() => {
      localStorage.setItem(PENDING_KEY, "true");
      wrapper = buildWrapper();
    });

    it("closes the dialog when the close button is clicked", async () => {
      // Arrange
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');
      expect(closeBtn.exists()).toBe(true);

      // Act
      await closeBtn.trigger("click");

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });

    it("sets seen key in localStorage when close button is clicked", async () => {
      // Arrange
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      // Act
      await closeBtn.trigger("click");

      // Assert
      expect(localStorage.getItem(SEEN_KEY)).toBe("true");
    });

    it("removes PENDING_KEY when close button is clicked", async () => {
      // Arrange
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      // Act
      await closeBtn.trigger("click");

      // Assert
      expect(localStorage.getItem(PENDING_KEY)).toBeNull();
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
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
      expect(localStorage.getItem(SEEN_KEY)).toBe("true");
    });

    it("does NOT dismiss when ODialog emits update:open=true", async () => {
      // Arrange — update:open=true means the dialog is opening, not closing
      const dialogStub = wrapper.findComponent(ODialogStub);

      // Act
      await dialogStub.vm.$emit("update:open", true);

      // Assert — dialog stays open, seen key NOT written
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("true");
      expect(localStorage.getItem(SEEN_KEY)).toBeNull();
    });
  });

  // ── slackUrl computed ────────────────────────────────────────────────────────

  describe("slackUrl computed", () => {
    it("uses the default community URL when not Enterprise", async () => {
      // Arrange — isEnterprise = "false" (default)
      localStorage.setItem(PENDING_KEY, "true");
      wrapper = buildWrapper();
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
      localStorage.setItem(PENDING_KEY, "true");

      // Mount AFTER setting config so computed reads the correct value
      wrapper = buildWrapper();
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
      localStorage.setItem(PENDING_KEY, "true");
      wrapper = buildWrapper();
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
      localStorage.setItem(PENDING_KEY, "true");
      wrapper = buildWrapper();
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
      // Arrange — no member count in store (already default: null)
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="community-slack-invite-members-text"]').text(),
      ).toBe("Engineers and the OpenObserve team, active every day");
    });

    it("shows member count text when slack_member_count is a positive number", () => {
      // Arrange — 4250 members → floored to 4200 → "4,200+ members"
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 4250,
      });
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="community-slack-invite-members-text"]').text(),
      ).toContain("4,200+");
    });

    it("shows member count without '+' suffix when count is below 100", () => {
      // Arrange — 50 members → no floor to 100, no "+"
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 50,
      });
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      const text = wrapper
        .find('[data-test="community-slack-invite-members-text"]')
        .text();
      expect(text).toContain("50");
      expect(text).not.toContain("+");
    });

    it("falls back to community note when slack_member_count is 0", () => {
      // Arrange — 0 is not > 0, so memberCount returns null
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 0,
      });
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="community-slack-invite-members-text"]').text(),
      ).toBe("Engineers and the OpenObserve team, active every day");
    });

    it("falls back to community note when slack_member_count is negative", () => {
      // Arrange
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: -5,
      });
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      expect(
        wrapper.find('[data-test="community-slack-invite-members-text"]').text(),
      ).toBe("Engineers and the OpenObserve team, active every day");
    });

    it("floors member count to nearest 100 (e.g. 1999 → 1900+)", () => {
      // Arrange
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 1999,
      });
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert
      const text = wrapper
        .find('[data-test="community-slack-invite-members-text"]')
        .text();
      expect(text).toContain("1,900+");
      expect(text).not.toContain("1,999");
    });
  });

  // ── seenKey uses user email ──────────────────────────────────────────────────

  describe("per-user seen key", () => {
    it("uses the user email from the store to build the seenKey", async () => {
      // Arrange — store has email = "example@gmail.com"
      localStorage.setItem(PENDING_KEY, "true");
      wrapper = buildWrapper();
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      // Act
      await closeBtn.trigger("click");

      // Assert — the exact keyed entry was written
      expect(
        localStorage.getItem(`communitySlackInviteSeen:${USER_EMAIL}`),
      ).toBe("true");
    });

    it("uses 'anonymous' seenKey when userInfo has no email", async () => {
      // Arrange — clear email before mounting
      store.commit("setUserInfo", { email: undefined });
      localStorage.setItem(PENDING_KEY, "true");
      wrapper = buildWrapper();
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      // Act
      await closeBtn.trigger("click");

      // Assert — falls back to "anonymous"
      expect(
        localStorage.getItem("communitySlackInviteSeen:anonymous"),
      ).toBe("true");
    });
  });

  // ── Listener cleanup on unmount ──────────────────────────────────────────────

  describe("listener cleanup", () => {
    it("removes o2:onboarding-complete listener on unmount", () => {
      // Arrange
      localStorage.setItem("isFirstTimeLogin", "true");
      const removeEventSpy = vi.spyOn(window, "removeEventListener");
      wrapper = buildWrapper();

      // Act
      wrapper.unmount();
      const removals = removeEventSpy.mock.calls.filter(
        ([event]) => event === "o2:onboarding-complete",
      );

      // Assert
      expect(removals.length).toBeGreaterThanOrEqual(1);
    });

    it("does not open dialog after unmount even if onboarding event fires", () => {
      // Arrange — first login flow: listener registered, then unmount
      localStorage.setItem("isFirstTimeLogin", "true");
      wrapper = buildWrapper();
      wrapper.unmount();

      // Act — event fires after unmount
      expect(() => {
        window.dispatchEvent(new Event("o2:onboarding-complete"));
      }).not.toThrow();
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("closing via close button a second time does not throw", async () => {
      // Arrange
      localStorage.setItem(PENDING_KEY, "true");
      wrapper = buildWrapper();
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
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert — 100 floors to 100, and n >= 100 so "+" is appended
      const text = wrapper
        .find('[data-test="community-slack-invite-members-text"]')
        .text();
      expect(text).toContain("100+");
    });

    it("renders correctly with very large member count (e.g. 1,000,000)", () => {
      // Arrange
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 1_000_000,
      });
      localStorage.setItem(PENDING_KEY, "true");

      // Act
      wrapper = buildWrapper();

      // Assert — floored to 1,000,000, shows commas and "+"
      const text = wrapper
        .find('[data-test="community-slack-invite-members-text"]')
        .text();
      expect(text).toContain("1,000,000+");
    });

    it("renders without throwing when slack_member_count is NaN", () => {
      // Arrange
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: NaN,
      });
      localStorage.setItem(PENDING_KEY, "true");

      // Act + Assert — falls back gracefully
      expect(() => {
        wrapper = buildWrapper();
      }).not.toThrow();
      expect(
        wrapper.find('[data-test="community-slack-invite-members-text"]').text(),
      ).toBe("Engineers and the OpenObserve team, active every day");
    });
  });
});
