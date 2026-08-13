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
import { describe, expect, it } from "vitest";

import OnCallContactReadiness from "@/components/oncall/OnCallContactReadiness.vue";
import i18n from "@/locales";
import type { MemberReachability, TeamReachability } from "@/ts/interfaces/oncall";

const stubs = {
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  OBanner: { name: "OBanner", template: "<div><slot /></div>" },
  OTooltip: { name: "OTooltip", props: ["content"], template: "<span />" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
};

function member(over: Partial<MemberReachability> = {}): MemberReachability {
  return {
    user_email: "ana@o2.ai",
    is_org_user: true,
    mailbox_shaped: true,
    channels: [],
    deliverable_channels: ["email"],
    configured_but_unverified: [],
    would_a_page_land: true,
    ...over,
  };
}

function reachability(over: Partial<TeamReachability> = {}): TeamReachability {
  return {
    team_id: "t",
    team_name: "Payments",
    smtp_configured: true,
    members: [member()],
    reachable: 1,
    total: 1,
    unreachable_members: [],
    ...over,
  };
}

function render(r: TeamReachability | null) {
  return mount(OnCallContactReadiness, {
    props: { reachability: r },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallContactReadiness", () => {
  it("lists the channels that could actually carry a page", () => {
    const wrapper = render(reachability());
    expect(wrapper.find('[data-test="oncall-readiness-row-ana@o2.ai"]').text()).toContain("Email");
  });

  /// The unreachable name is the one the panel exists for — it must not be
  /// fourth in a list somebody stops reading.
  it("puts unreachable people first", () => {
    const wrapper = render(
      reachability({
        members: [
          member({ user_email: "ok@o2.ai", would_a_page_land: true }),
          member({ user_email: "bad@o2.ai", would_a_page_land: false, why_not: "no mailbox" }),
        ],
      }),
    );
    const rows = wrapper.findAll('[data-test^="oncall-readiness-row-"]');
    expect(rows[0].attributes("data-test")).toBe("oncall-readiness-row-bad@o2.ai");
  });

  /// One `false` explains every unreachable row beneath it, so it is said once
  /// at the top rather than repeated against each name.
  it("explains a missing transport once, not per person", () => {
    const wrapper = render(reachability({ smtp_configured: false }));
    expect(wrapper.find('[data-test="oncall-readiness-no-smtp"]').exists()).toBe(true);
  });

  /// Rendering our own guess at why a page failed is exactly the lie this
  /// endpoint exists to prevent.
  it("shows the server's reason when nothing can carry a page", () => {
    const wrapper = render(
      reachability({
        members: [
          member({
            would_a_page_land: false,
            deliverable_channels: [],
            why_not: "no verified contact method is on file",
          }),
        ],
      }),
    );
    expect(wrapper.text()).toContain("no verified contact method is on file");
  });

  it("says so when the team has no members", () => {
    const wrapper = render(reachability({ members: [] }));
    expect(wrapper.find('[data-test="oncall-readiness-empty"]').exists()).toBe(true);
  });

  it("asks the caller to send a test page", async () => {
    const wrapper = render(reachability());
    await wrapper.find('[data-test="oncall-readiness-test-page"]').trigger("click");
    expect(wrapper.emitted("test-page")).toHaveLength(1);
  });
});
