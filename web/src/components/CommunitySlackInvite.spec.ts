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
const mockConfig = vi.hoisted(() => ({
  isCloud: "true" as string,
  isEnterprise: "false" as string,
}));

vi.mock("@/aws-exports", () => ({
  default: mockConfig,
}));

vi.mock("@/services/segment_analytics", () => ({ default: { track: vi.fn() } }));

import CommunitySlackInvite from "./CommunitySlackInvite.vue";
import segment from "@/services/segment_analytics";

// ── Constants ─────────────────────────────────────────────────────────────────
const USER_EMAIL = "example@gmail.com"; // matches store.ts userInfo.email
const STATE_KEY = `slackCommunityInvite:${USER_EMAIL}`;
const DEFAULT_SLACK_URL = "https://short.openobserve.ai/community";
const DAY2_DELAY_MS = 24 * 60 * 60 * 1000;

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

// A `pending_day2` record left over from ConnectDataSourcePopup's touchpoint.
// `hoursAgo` controls whether the day-2 threshold has elapsed yet.
function setPendingDay2(hoursAgo: number) {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({ status: "pending_day2", shownAt: Date.now() - hoursAgo * 60 * 60 * 1000 }),
  );
}

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
// Store deps: store.state.userInfo.email, store.state.zoConfig.custom_slack_url,
//             store.state.zoConfig.slack_member_count
// Service deps: config.isCloud, config.isEnterprise (mocked via vi.mock)
// Child components: ODialog (stubbed), OButton (real), OIcon (real), SlackIcon (real)
// Conditional states:
//   - Cloud vs non-Cloud (isCloud !== "true" → nothing shown)
//   - First-time login (isFirstTimeLogin = "true") → never opens, defers entirely
//     to ConnectDataSourcePopup for that session
//   - Day-2 record not yet "pending_day2", or shownAt < 24h ago → stays closed
//   - Day-2 record "pending_day2" and shownAt >= 24h ago → opens on mount
//   - memberCount present/absent → different captionText
// User interactions: close-btn click, join-btn click, maybe-later-btn click
// Async operations: none (synchronous mount-time check)

describe("CommunitySlackInvite", () => {
  let wrapper: VueWrapper;
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConfig.isCloud = "true";
    mockConfig.isEnterprise = "false";

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
    vi.clearAllMocks();
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
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
    });

    it("shows the dialog open on mount when the day-2 threshold has elapsed", async () => {
      setPendingDay2(25);

      wrapper = buildWrapper();
      await nextTick();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
    });

    it("stays closed when there is no invite record at all", () => {
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("renders the localized title text inside an h2", () => {
      setPendingDay2(25);

      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="community-slack-invite-title"]').text()).toBe(
        "Join the OpenObserve community on Slack",
      );
      expect(wrapper.find('[data-test="community-slack-invite-title"]').element.tagName).toBe("H2");
    });

    it("renders the localized description text", () => {
      setPendingDay2(25);

      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="community-slack-invite-description"]').text()).toContain(
        "Learn, ask questions",
      );
    });

    it("renders the Join Slack button with localized label", () => {
      setPendingDay2(25);

      wrapper = buildWrapper();

      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');
      expect(joinBtn.exists()).toBe(true);
      expect(joinBtn.text()).toContain("Join the Slack");
    });

    it("renders the Maybe later button with localized label", () => {
      setPendingDay2(25);

      wrapper = buildWrapper();

      const laterBtn = wrapper.find('[data-test="community-slack-invite-maybe-later-btn"]');
      expect(laterBtn.exists()).toBe(true);
      expect(laterBtn.text()).toBe("Maybe later");
    });

    it("passes size='sm' to ODialog", () => {
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-size")).toBe("sm");
    });

    it("renders 3 benefit items", () => {
      setPendingDay2(25);

      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="community-slack-invite-benefit-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="community-slack-invite-benefit-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="community-slack-invite-benefit-2"]').exists()).toBe(true);
    });

    it("does not call window.open on initial render", () => {
      wrapper = buildWrapper();

      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  // ── Cloud gate ───────────────────────────────────────────────────────────────

  describe("Cloud gate", () => {
    it("never opens on non-Cloud, even with an elapsed day-2 record", () => {
      mockConfig.isCloud = "false";
      setPendingDay2(25);

      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });
  });

  // ── First-login gate ─────────────────────────────────────────────────────────
  // Never compete with ConnectDataSourcePopup/GetStarted during the user's
  // first-login session — the day-2 clock only starts once that session ends.

  describe("first-login gate", () => {
    it("does not open during first-time login even with an elapsed day-2 record", () => {
      localStorage.setItem("isFirstTimeLogin", "true");
      setPendingDay2(25);

      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("opens normally once isFirstTimeLogin is cleared (returning session)", async () => {
      localStorage.removeItem("isFirstTimeLogin");
      setPendingDay2(25);

      wrapper = buildWrapper();
      await nextTick();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
    });
  });

  // ── Day-2 trigger ────────────────────────────────────────────────────────────

  describe("day-2 trigger", () => {
    it("stays closed when the record is still 'not_asked' (no touchpoint yet)", () => {
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("stays closed when pending but less than 24h have elapsed", () => {
      setPendingDay2(5);

      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("opens exactly at the 24h boundary", async () => {
      setPendingDay2(24);

      wrapper = buildWrapper();
      await nextTick();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
    });

    it("stays closed when already resolved", () => {
      localStorage.setItem(STATE_KEY, JSON.stringify({ status: "resolved", shownAt: null }));

      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("fires community_slack_prompt_shown with source standalone_day2 when it opens", () => {
      setPendingDay2(25);

      wrapper = buildWrapper();

      expect(segment.track).toHaveBeenCalledWith(
        "community_slack_prompt_shown",
        expect.objectContaining({ source: "standalone_day2" }),
      );
    });
  });

  // ── Interaction: Join Slack button ───────────────────────────────────────────

  describe("Join Slack button", () => {
    beforeEach(() => {
      setPendingDay2(25);
      wrapper = buildWrapper();
    });

    it("calls window.open with the default slack URL, '_blank', 'noopener'", async () => {
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      await joinBtn.trigger("click");

      expect(openSpy).toHaveBeenCalledWith(DEFAULT_SLACK_URL, "_blank", "noopener");
    });

    it("closes the dialog after clicking Join Slack", async () => {
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");

      await joinBtn.trigger("click");

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("marks the invite resolved in localStorage after clicking Join Slack", async () => {
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      await joinBtn.trigger("click");

      const record = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      expect(record.status).toBe("resolved");
    });

    it("fires community_slack_prompt_joined with source standalone_day2", async () => {
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      await joinBtn.trigger("click");

      expect(segment.track).toHaveBeenCalledWith(
        "community_slack_prompt_joined",
        expect.objectContaining({ source: "standalone_day2" }),
      );
    });
  });

  // ── Interaction: Maybe later button ─────────────────────────────────────────

  describe("Maybe later button", () => {
    beforeEach(() => {
      setPendingDay2(25);
      wrapper = buildWrapper();
    });

    it("closes the dialog when Maybe later is clicked", async () => {
      const laterBtn = wrapper.find('[data-test="community-slack-invite-maybe-later-btn"]');

      await laterBtn.trigger("click");

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("marks the invite resolved in localStorage — the day-2 decline is final", async () => {
      const laterBtn = wrapper.find('[data-test="community-slack-invite-maybe-later-btn"]');

      await laterBtn.trigger("click");

      const record = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      expect(record.status).toBe("resolved");
    });

    it("does NOT call window.open when Maybe later is clicked", async () => {
      const laterBtn = wrapper.find('[data-test="community-slack-invite-maybe-later-btn"]');

      await laterBtn.trigger("click");

      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  // ── Interaction: close button (X) ────────────────────────────────────────────

  describe("close button / handleOpenChange path", () => {
    beforeEach(() => {
      setPendingDay2(25);
      wrapper = buildWrapper();
    });

    it("closes the dialog when the close button is clicked", async () => {
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');
      expect(closeBtn.exists()).toBe(true);

      await closeBtn.trigger("click");

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("does NOT call window.open when dismissed via close button", async () => {
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      await closeBtn.trigger("click");

      expect(openSpy).not.toHaveBeenCalled();
    });

    it("dismisses when ODialog emits update:open=false, marking the invite resolved", async () => {
      const dialogStub = wrapper.findComponent(ODialogStub);

      await dialogStub.vm.$emit("update:open", false);

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
      const record = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      expect(record.status).toBe("resolved");
    });

    it("does NOT dismiss when ODialog emits update:open=true", async () => {
      const dialogStub = wrapper.findComponent(ODialogStub);

      await dialogStub.vm.$emit("update:open", true);

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
    });
  });

  // ── slackUrl computed ────────────────────────────────────────────────────────

  describe("slackUrl computed", () => {
    it("uses the default community URL when not Enterprise", async () => {
      setPendingDay2(25);
      wrapper = buildWrapper();
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');

      await joinBtn.trigger("click");

      expect(openSpy).toHaveBeenCalledWith(DEFAULT_SLACK_URL, "_blank", "noopener");
    });

    it("uses the custom Slack URL when Enterprise and custom_slack_url is set", async () => {
      const customUrl = "https://enterprise.slack.com/my-org";
      mockConfig.isEnterprise = "true";
      store.commit("setConfig", {
        ...store.state.zoConfig,
        custom_slack_url: customUrl,
      });
      setPendingDay2(25);

      wrapper = buildWrapper();
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');
      await joinBtn.trigger("click");

      expect(openSpy).toHaveBeenCalledWith(customUrl, "_blank", "noopener");
    });

    it("falls back to default URL when Enterprise but custom_slack_url is falsy", async () => {
      mockConfig.isEnterprise = "true";
      store.commit("setConfig", {
        ...store.state.zoConfig,
        custom_slack_url: null,
      });
      setPendingDay2(25);

      wrapper = buildWrapper();
      const joinBtn = wrapper.find('[data-test="community-slack-invite-join-btn"]');
      await joinBtn.trigger("click");

      expect(openSpy).toHaveBeenCalledWith(DEFAULT_SLACK_URL, "_blank", "noopener");
    });
  });

  // ── captionText computed ─────────────────────────────────────────────────────

  describe("captionText computed", () => {
    it("shows qualitative community note when slack_member_count is absent", () => {
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="community-slack-invite-members-text"]').text()).toBe(
        "Engineers and the OpenObserve team, active every day",
      );
    });

    it("shows member count text when slack_member_count is a positive number", () => {
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 4250,
      });

      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="community-slack-invite-members-text"]').text()).toContain(
        "4,200+",
      );
    });

    it("falls back to community note when slack_member_count is 0", () => {
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 0,
      });

      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="community-slack-invite-members-text"]').text()).toBe(
        "Engineers and the OpenObserve team, active every day",
      );
    });
  });

  // ── per-user state key ───────────────────────────────────────────────────────

  describe("per-user state key", () => {
    it("reads the day-2 record keyed by the user email from the store", async () => {
      setPendingDay2(25);

      wrapper = buildWrapper();
      await nextTick();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
    });

    it("falls back to the 'anonymous' key when userInfo has no email", async () => {
      store.commit("setUserInfo", { email: undefined });
      localStorage.setItem(
        "slackCommunityInvite:anonymous",
        JSON.stringify({ status: "pending_day2", shownAt: Date.now() - DAY2_DELAY_MS - 1000 }),
      );

      wrapper = buildWrapper();
      await nextTick();

      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("true");
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("closing via close button a second time does not throw", async () => {
      setPendingDay2(25);
      wrapper = buildWrapper();
      const closeBtn = wrapper.find('[data-test="community-slack-invite-close-btn"]');

      await closeBtn.trigger("click");
      expect(() => closeBtn.trigger("click")).not.toThrow();
    });

    it("does not throw when the stored record is corrupted JSON", () => {
      localStorage.setItem(STATE_KEY, "{not-json");

      expect(() => {
        wrapper = buildWrapper();
      }).not.toThrow();
      expect(wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open")).toBe("false");
    });

    it("renders correctly with very large member count (e.g. 1,000,000)", () => {
      store.commit("setConfig", {
        ...store.state.zoConfig,
        slack_member_count: 1_000_000,
      });

      wrapper = buildWrapper();

      const text = wrapper.find('[data-test="community-slack-invite-members-text"]').text();
      expect(text).toContain("1,000,000+");
    });
  });
});
