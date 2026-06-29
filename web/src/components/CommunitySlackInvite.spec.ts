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
import i18n from "@/locales";
import CommunitySlackInvite from "./CommunitySlackInvite.vue";

// ── ODialog stub ──────────────────────────────────────────────────────────────
// ODialog uses reka-ui's DialogPortal which teleports content outside the
// component tree. Stubbing it lets us render default + footer slots inline,
// assert on props forwarded to ODialog, and emit update:open to test the
// close path — all without any teleport / jsdom complexity.
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: ["open", "size", "title"],
  emits: ["update:open"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-close-btn"
        @click="$emit('update:open', false)"
      >Close</button>
    </div>
  `,
};

// ── Mount factory ─────────────────────────────────────────────────────────────
const SLACK_URL = "https://example.slack.com/join";

function buildWrapper(props: Record<string, unknown> = {}) {
  return mount(CommunitySlackInvite, {
    props: {
      modelValue: true,
      slackUrl: SLACK_URL,
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        ODialog: ODialogStub,
      },
    },
  });
}

// ── Component analysis ────────────────────────────────────────────────────────
// Component: CommunitySlackInvite
// Props:     modelValue: boolean (controlled visibility), slackUrl: string (CTA url)
// Emits:     update:modelValue (false on dismiss), seen (on any dismissal path)
// Slots:     default (description), footer (join + maybe-later buttons)
// Store deps: none
// Service deps: none
// Child components: ODialog (stubbed), OButton (real — renders with real click)
// Conditional states: open (modelValue=true) / closed (modelValue=false)
// User interactions: "Join Slack" click, "Maybe later" click, dialog close btn
// Async operations: none

describe("CommunitySlackInvite", () => {
  let wrapper: VueWrapper;
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    wrapper = buildWrapper();
  });

  afterEach(() => {
    wrapper?.unmount();
    // clearAllMocks resets call history on the spy while keeping it in place;
    // the spy is re-created in the next beforeEach via vi.spyOn anyway.
    vi.clearAllMocks();
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the ODialog stub when modelValue is true", () => {
      // Arrange (done in beforeEach)

      // Act — no interaction

      // Assert
      expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
    });

    it("forwards modelValue=true as open=true to ODialog", () => {
      // Arrange (done in beforeEach — modelValue: true)

      // Act — no interaction

      // Assert: data-open reflects the bound prop
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("true");
    });

    it("forwards modelValue=false as open=false to ODialog", () => {
      // Arrange
      wrapper.unmount();
      wrapper = buildWrapper({ modelValue: false });

      // Act — no interaction

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });

    it("renders the localized title text", () => {
      // Arrange (done in beforeEach)

      // Act — no interaction

      // Assert: title is passed into ODialog as prop and rendered via stub
      expect(
        wrapper.find('[data-test="o-dialog-stub-title"]').text(),
      ).toBe("Join the OpenObserve Community");
    });

    it("renders the localized description text", () => {
      // Arrange (done in beforeEach)

      // Act — no interaction

      // Assert
      expect(
        wrapper.find('[data-test="community-slack-invite-description"]').text(),
      ).toContain("Learn, ask questions");
    });

    it("renders the Join Slack button with localized label", () => {
      // Arrange (done in beforeEach)

      // Act — no interaction

      // Assert
      const joinBtn = wrapper.find(
        '[data-test="community-slack-invite-join-btn"]',
      );
      expect(joinBtn.exists()).toBe(true);
      expect(joinBtn.text()).toBe("Join Slack");
    });

    it("renders the Maybe later button with localized label", () => {
      // Arrange (done in beforeEach)

      // Act — no interaction

      // Assert
      const laterBtn = wrapper.find(
        '[data-test="community-slack-invite-maybe-later-btn"]',
      );
      expect(laterBtn.exists()).toBe(true);
      expect(laterBtn.text()).toBe("Maybe later");
    });

    it("passes size='sm' to ODialog", () => {
      // Arrange (done in beforeEach)

      // Act — no interaction

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-size"),
      ).toBe("sm");
    });

    it("does not call window.open on initial render", () => {
      // Arrange (done in beforeEach)

      // Act — no interaction

      // Assert
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  // ── seen does not fire on initial render ────────────────────────────────────

  describe("seen event", () => {
    it("does not emit 'seen' on initial render", () => {
      // Arrange (done in beforeEach)

      // Act — no interaction

      // Assert
      expect(wrapper.emitted("seen")).toBeFalsy();
    });
  });

  // ── Interaction: Join Slack ─────────────────────────────────────────────────

  describe("Join Slack button", () => {
    it("calls window.open with the slackUrl, '_blank', 'noopener' when clicked", async () => {
      // Arrange
      const joinBtn = wrapper.find(
        '[data-test="community-slack-invite-join-btn"]',
      );

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(openSpy).toHaveBeenCalledWith(SLACK_URL, "_blank", "noopener");
    });

    it("emits update:modelValue with false when Join Slack is clicked", async () => {
      // Arrange
      const joinBtn = wrapper.find(
        '[data-test="community-slack-invite-join-btn"]',
      );

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
    });

    it("emits 'seen' when Join Slack is clicked", async () => {
      // Arrange
      const joinBtn = wrapper.find(
        '[data-test="community-slack-invite-join-btn"]',
      );

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(wrapper.emitted("seen")).toHaveLength(1);
    });

    it("calls window.open exactly once when Join Slack is clicked once", async () => {
      // Arrange
      const joinBtn = wrapper.find(
        '[data-test="community-slack-invite-join-btn"]',
      );

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Interaction: Maybe later ────────────────────────────────────────────────

  describe("Maybe later button", () => {
    it("emits update:modelValue with false when Maybe later is clicked", async () => {
      // Arrange
      const laterBtn = wrapper.find(
        '[data-test="community-slack-invite-maybe-later-btn"]',
      );

      // Act
      await laterBtn.trigger("click");

      // Assert
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
    });

    it("emits 'seen' when Maybe later is clicked", async () => {
      // Arrange
      const laterBtn = wrapper.find(
        '[data-test="community-slack-invite-maybe-later-btn"]',
      );

      // Act
      await laterBtn.trigger("click");

      // Assert
      expect(wrapper.emitted("seen")).toHaveLength(1);
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

  // ── Interaction: Dialog close button (X / overlay path) ────────────────────

  describe("dialog close / dismiss path", () => {
    it("emits update:modelValue with false when the dialog close button is clicked", async () => {
      // Arrange
      // The ODialogStub renders a close button that emits update:open=false;
      // the component handles that via handleOpenChange → dismiss().
      const closeBtn = wrapper.find('[data-test="o-dialog-close-btn"]');
      expect(closeBtn.exists()).toBe(true);

      // Act
      await closeBtn.trigger("click");

      // Assert
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
    });

    it("emits 'seen' when the dialog close button is clicked", async () => {
      // Arrange
      const closeBtn = wrapper.find('[data-test="o-dialog-close-btn"]');

      // Act
      await closeBtn.trigger("click");

      // Assert
      expect(wrapper.emitted("seen")).toHaveLength(1);
    });

    it("does NOT call window.open when dismissed via close button", async () => {
      // Arrange
      const closeBtn = wrapper.find('[data-test="o-dialog-close-btn"]');

      // Act
      await closeBtn.trigger("click");

      // Assert
      expect(openSpy).not.toHaveBeenCalled();
    });

    it("emits update:modelValue=false when ODialog emits update:open=false", async () => {
      // Arrange — drive through the ODialog's update:open emit directly
      // (simulates Escape key / overlay click paths inside the real ODialog)
      const dialogStub = wrapper.findComponent(ODialogStub);

      // Act
      await dialogStub.vm.$emit("update:open", false);

      // Assert
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
    });

    it("emits 'seen' when ODialog emits update:open=false", async () => {
      // Arrange
      const dialogStub = wrapper.findComponent(ODialogStub);

      // Act
      await dialogStub.vm.$emit("update:open", false);

      // Assert
      expect(wrapper.emitted("seen")).toHaveLength(1);
    });

    it("does not emit 'seen' or update:modelValue when ODialog emits update:open=true", async () => {
      // Arrange — open=true means the dialog is opening, not closing; dismiss
      // should not fire in this case.
      const dialogStub = wrapper.findComponent(ODialogStub);

      // Act
      await dialogStub.vm.$emit("update:open", true);

      // Assert
      expect(wrapper.emitted("seen")).toBeFalsy();
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  // ── Props reactivity ────────────────────────────────────────────────────────

  describe("props reactivity", () => {
    it("updates data-open attribute when modelValue prop changes to false", async () => {
      // Arrange — initially open
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("true");

      // Act
      await wrapper.setProps({ modelValue: false });

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");
    });

    it("updates data-open attribute when modelValue prop changes to true", async () => {
      // Arrange — start closed
      wrapper.unmount();
      wrapper = buildWrapper({ modelValue: false });
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("false");

      // Act
      await wrapper.setProps({ modelValue: true });

      // Assert
      expect(
        wrapper.find('[data-test="o-dialog-stub"]').attributes("data-open"),
      ).toBe("true");
    });

    it("uses updated slackUrl when joinSlack is triggered after prop change", async () => {
      // Arrange
      const newUrl = "https://updated.slack.com/join";
      await wrapper.setProps({ slackUrl: newUrl });
      const joinBtn = wrapper.find(
        '[data-test="community-slack-invite-join-btn"]',
      );

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(openSpy).toHaveBeenCalledWith(newUrl, "_blank", "noopener");
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("emits both update:modelValue and seen exactly once per single dismissal", async () => {
      // Arrange
      const laterBtn = wrapper.find(
        '[data-test="community-slack-invite-maybe-later-btn"]',
      );

      // Act — single click
      await laterBtn.trigger("click");

      // Assert — no duplicate events
      expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
      expect(wrapper.emitted("seen")).toHaveLength(1);
    });

    it("emits 'seen' on every dismissal path independently", async () => {
      // Test that calling dismiss multiple times (via different UI interactions)
      // each produces a 'seen' event — the component does not gate it.

      // Dismiss via Maybe later
      await wrapper.find(
        '[data-test="community-slack-invite-maybe-later-btn"]',
      ).trigger("click");

      // Dismiss again via close button
      await wrapper.find('[data-test="o-dialog-close-btn"]').trigger("click");

      // Assert — both dismissals fired seen
      expect(wrapper.emitted("seen")).toHaveLength(2);
    });

    it("renders without throwing when slackUrl is an empty string", () => {
      // Arrange
      wrapper.unmount();

      // Act + Assert — no throw on mount
      expect(() => {
        wrapper = buildWrapper({ slackUrl: "" });
      }).not.toThrow();
    });

    it("passes empty string slackUrl to window.open without modification", async () => {
      // Arrange
      wrapper.unmount();
      wrapper = buildWrapper({ slackUrl: "" });
      const joinBtn = wrapper.find(
        '[data-test="community-slack-invite-join-btn"]',
      );

      // Act
      await joinBtn.trigger("click");

      // Assert
      expect(openSpy).toHaveBeenCalledWith("", "_blank", "noopener");
    });
  });
});
