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
import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import i18n from "@/locales";
import { makeSlackStore } from "@/test/unit/helpers/slack";
import type { ChannelReadiness } from "@/ts/interfaces/oncall";
import OnCallChannelChips from "./OnCallChannelChips.vue";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const TooltipStub = defineComponent({
  name: "OTooltip",
  props: { content: { type: String, default: "" } },
  template: `<span data-test-stub="tooltip">{{ content }}</span>`,
});

const unlinkedSlack = (over: Partial<ChannelReadiness> = {}): ChannelReadiness => ({
  channel: "slack",
  deliverable: false,
  configured_but_unverified: false,
  blocked_because: "not linked",
  ...over,
});

const tip = (channel: ChannelReadiness, own = true) =>
  mount(OnCallChannelChips, {
    props: { email: "ana@acme.example", channels: [channel], own },
    global: { plugins: [i18n, makeSlackStore()], stubs: { OTooltip: TooltipStub } },
  })
    .find('[data-test-stub="tooltip"]')
    .text();

describe("OnCallChannelChips", () => {
  it("names the team's own Slack app command on the caller's unlinked chip", () => {
    expect(tip(unlinkedSlack({ slack_command: "/staging-o2" }))).toBe(
      "not linked. Run /staging-o2 link in Slack",
    );
  });

  it("falls back to /o2 when the server names no command", () => {
    expect(tip(unlinkedSlack())).toBe("not linked. Run /o2 link in Slack");
  });

  it("names no command on another person's row", () => {
    expect(tip(unlinkedSlack({ slack_command: "/staging-o2" }), false)).toBe("not linked");
  });
});
