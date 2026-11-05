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

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeEvidence } from "../__tests__/fakeEvidence";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: track }));

import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantPolicyNotice from "./AssistantPolicyNotice.vue";

const routes = [
  { path: "/alerts/:alert_id", name: "alertDetail", component: {} },
  { path: "/dashboards", name: "dashboards", component: {} },
];

const mountNotice = (props: Record<string, unknown>) =>
  mount(AssistantPolicyNotice, {
    props: { org: "default", ...props },
    global: { plugins: [fakeRouter(routes)] },
  });

describe("AssistantPolicyNotice", () => {
  beforeEach(() => track.mockReset());

  it("names the blocked tool, the server's detail and the admin path", () => {
    const wrapper = mountNotice({
      blockId: "b1",
      policy: {
        kind: "denied",
        tool: "o2_UpdateAlert",
        detail: "Writes are off.",
        policy: "admin",
      },
    });
    const notice = wrapper.get('[data-test="assistant-permission-denied"]');
    expect(notice.text()).toContain("Blocked by policy: o2_UpdateAlert. Writes are off.");
    expect(notice.text()).toContain("An admin can allow it in Settings › Assistant › Permissions.");
    expect(track).toHaveBeenCalledWith("ai_policy_notice", { kind: "permission_denied" });
  });

  it("says an automatic decline as such", () => {
    const wrapper = mountNotice({
      policy: { kind: "denied", tool: "bash", policy: "auto_reject" },
    });
    expect(wrapper.text()).toContain("Blocked by policy: bash.");
    expect(wrapper.text()).toContain("Auto-declined by the assistant's safety settings");
  });

  it("surfaces a change made without a review step, with the object in a new tab", () => {
    const wrapper = mountNotice({
      blockId: "b2",
      block: {
        type: "policy",
        policy: { kind: "unreviewed", resourceType: "alert", count: 1, resourceId: "a1" },
      },
    });
    const notice = wrapper.get('[data-test="assistant-unreviewed-change"]');
    expect(notice.text()).toContain("The assistant changed 1 alert without a review step.");
    const open = wrapper.get('[data-test="assistant-unreviewed-change-open"]');
    expect(open.text()).toBe("See what changed");
    expect(open.attributes("aria-label")).toBe("See what changed (opens in a new tab)");
    expect(open.attributes("href")).toContain("/alerts/a1");
    expect(open.attributes("target")).toBe("_blank");
    expect(track).toHaveBeenCalledWith("ai_policy_notice", { kind: "unreviewed_change" });
  });

  it("counts many changes of one kind and opens the list when no id came", () => {
    const wrapper = mountNotice({
      block: {
        type: "policy",
        policy: { kind: "unreviewed", resourceType: "dashboard", count: 3 },
      },
    });
    expect(wrapper.text()).toContain("The assistant changed 3 dashboards without a review step.");
    expect(
      wrapper.get('[data-test="assistant-unreviewed-change-open"]').attributes("href"),
    ).toContain("/dashboards");
  });

  it("speaks a denial once while its answer streams, and never one from history", () => {
    const evidence = fakeEvidence();
    const mountDenied = (outcome: "live" | "done", blockId: string) =>
      mount(AssistantPolicyNotice, {
        props: {
          org: "default",
          blockId,
          policy: { kind: "denied", tool: "o2_UpdateAlert" },
          turn: evidence.turn({ outcome }),
        },
        global: { plugins: [fakeRouter(routes)], provide: evidence.provide },
      });
    mountDenied("live", "live-1");
    mountDenied("live", "live-1");
    mountDenied("done", "old-1");
    expect(evidence.host.announce).toHaveBeenCalledTimes(1);
    expect(evidence.host.announce).toHaveBeenCalledWith(
      evidence.sid,
      "Blocked by policy: o2_UpdateAlert.",
    );
  });

  it("offers no link on a readonly page", () => {
    const wrapper = mountNotice({
      readonly: true,
      policy: { kind: "unreviewed", resourceType: "alert", count: 1 },
    });
    expect(wrapper.find('[data-test="assistant-unreviewed-change-open"]').exists()).toBe(false);
  });
});
