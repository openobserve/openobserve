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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";

import { fakeAssistant, fakeRouter } from "../__tests__/fakeAssistant";
import AssistantGateState, {
  SETUP_DOCS_URL,
  resetGateTelemetryForTests,
  type AssistantGateStateProps,
} from "./AssistantGateState.vue";

const { fake, track, openUpgrade } = vi.hoisted(() => ({
  fake: {
    current: null as ReturnType<typeof import("../__tests__/fakeAssistant").fakeAssistant> | null,
  },
  track: vi.fn(),
  openUpgrade: vi.fn(),
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantCapability: () => fake.current!.handle,
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));
vi.mock("@/composables/useEnterpriseUpgradeDialog", () => ({
  useEnterpriseUpgradeDialog: () => ({ open: openUpgrade }),
}));

const mountGate = (props: Partial<AssistantGateStateProps> = {}) =>
  mount(AssistantGateState, {
    props: {
      reason: "no_permission",
      size: "inline",
      isAdmin: false,
      context: { org: "acme" },
      ...props,
    },
    global: { plugins: [fakeRouter()] },
    attachTo: document.body,
  });

let io: ReturnType<typeof installFakeIntersectionObserver>;

beforeEach(() => {
  fake.current = fakeAssistant("no_permission");
  resetGateTelemetryForTests();
  io = installFakeIntersectionObserver({ autoVisible: true });
});

afterEach(() => {
  io.restore();
  document.body.innerHTML = "";
  track.mockClear();
  openUpgrade.mockClear();
  vi.restoreAllMocks();
});

describe("AssistantGateState", () => {
  it.each([
    ["not_entitled", "Meet O2 Assistant", "assistant-gate-see-plans"],
    ["not_configured", "O2 Assistant isn't set up yet", "assistant-gate-setup"],
    ["off_for_org", "O2 Assistant is turned off for this organization", "assistant-gate-ask-admin"],
    ["unhealthy", "O2 Assistant is unavailable right now", "assistant-gate-try-again"],
    ["no_permission", "O2 Assistant isn't available to your role", "assistant-gate-ask-admin"],
    [
      "no_share_read",
      "You don't have access to shared chats in this organization",
      "assistant-gate-ask-admin",
    ],
  ] as const)("renders %s with its copy and primary action", (reason, title, primary) => {
    const wrapper = mountGate({ reason, size: "hero", isAdmin: reason === "not_configured" });
    const root = wrapper.get('[data-test="assistant-gate-state"]');
    expect(root.attributes("data-gate")).toBe(reason);
    expect(root.attributes("data-size")).toBe("hero");
    expect(root.find("h2").text()).toBe(title);
    expect(wrapper.find(`[data-test="${primary}"]`).exists()).toBe(true);
  });

  it.each(["hero", "inline", "popover", "tooltip"] as const)("renders the %s size", (size) => {
    const wrapper = mountGate({ size });
    expect(wrapper.get('[data-test="assistant-gate-state"]').attributes("data-size")).toBe(size);
    expect(wrapper.text()).toContain("O2 Assistant isn't available to your role");
  });

  it("renders nothing for a member on not_configured: their doors are hidden instead", () => {
    const wrapper = mountGate({ reason: "not_configured", isAdmin: false });
    expect(wrapper.find('[data-test="assistant-gate-state"]').exists()).toBe(false);
  });

  it("pitches with three capability lines and opens the upgrade dialog from See plans", async () => {
    const wrapper = mountGate({ reason: "not_entitled", size: "hero" });
    expect(wrapper.findAll('[data-test="assistant-gate-capabilities"] li')).toHaveLength(3);
    await wrapper.get('[data-test="assistant-gate-see-plans"]').trigger("click");
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("ai_gate_blocked", {
      reason: "not_entitled",
      cta: "see_plans",
    });
    expect(wrapper.emitted("action")).toEqual([["see_plans"]]);
  });

  it("drops See plans when it only explains the assistant to an entitled org", () => {
    const wrapper = mountGate({ reason: "not_entitled", size: "hero", learnOnly: true });
    expect(wrapper.find("h2").text()).toBe("What O2 Assistant does");
    expect(wrapper.find('[data-test="assistant-gate-see-plans"]').exists()).toBe(false);
  });

  it("names where to grant access, as a link to IAM roles for admins only", () => {
    const member = mountGate();
    expect(member.text()).toContain("An admin can grant access in IAM › Roles › Assistant.");
    expect(member.find('[data-test="assistant-gate-where-to-grant"]').exists()).toBe(false);
    const admin = mountGate({ isAdmin: true });
    expect(admin.get('[data-test="assistant-gate-where-to-grant"]').attributes("href")).toContain(
      "/iam/roles",
    );
  });

  it("offers Reload with its hint on the locked panel", () => {
    const wrapper = mountGate();
    expect(wrapper.text()).toContain("If an admin just granted access, reload to check.");
    expect(wrapper.find('[data-test="assistant-gate-reload"]').exists()).toBe(true);
    expect(
      mountGate({ size: "popover" }).find('[data-test="assistant-gate-reload"]').exists(),
    ).toBe(false);
  });

  it("reports ai_gate_blocked once per session per reason", () => {
    mountGate();
    mountGate({ size: "hero" });
    mountGate({ reason: "unhealthy" });
    const passive = track.mock.calls.filter(([, props]) => !props.cta);
    expect(passive).toEqual([
      ["ai_gate_blocked", { reason: "no_permission" }],
      ["ai_gate_blocked", { reason: "unhealthy" }],
    ]);
  });

  it("reports a gate mounted out of sight only once it is first seen", () => {
    io.restore();
    io = installFakeIntersectionObserver();
    const wrapper = mountGate();
    expect(track).not.toHaveBeenCalled();
    io.setVisible(wrapper.get('[data-test="assistant-gate-state"]').element, true);
    expect(track).toHaveBeenCalledWith("ai_gate_blocked", { reason: "no_permission" });
  });

  it("moves focus to the primary action only when a user action opened it", async () => {
    mountGate();
    await flushPromises();
    expect(document.activeElement?.getAttribute("data-test")).not.toBe("assistant-gate-ask-admin");
    mountGate({ reason: "unhealthy", focusOnMount: true });
    await flushPromises();
    expect(document.activeElement?.getAttribute("data-test")).toBe("assistant-gate-try-again");
  });

  it("opens the setup docs in a new tab without an opener", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const wrapper = mountGate({ reason: "not_configured", isAdmin: true, size: "hero" });
    await wrapper.get('[data-test="assistant-gate-setup"]').trigger("click");
    expect(open).toHaveBeenCalledWith(SETUP_DOCS_URL, "_blank", "noopener,noreferrer");
  });

  it("reloads the page to re-read the role when B-06 is absent", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload });
    const wrapper = mountGate();
    await wrapper.get('[data-test="assistant-gate-reload"]').trigger("click");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("emits learn_more so the container can open the explanation", async () => {
    const wrapper = mountGate();
    await wrapper.get('[data-test="assistant-gate-learn-more"]').trigger("click");
    expect(wrapper.emitted("action")).toEqual([["learn_more"]]);
  });
});
