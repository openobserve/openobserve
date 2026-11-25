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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import slack from "@/services/slack";
import { makeSlackStore, ok } from "@/test/unit/helpers/slack";
import type { ChannelReadiness } from "@/ts/interfaces/oncall";
import OnCallChannelChips from "./OnCallChannelChips.vue";

vi.mock("@/services/slack", () => ({ default: { getMyLinks: vi.fn() } }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const TooltipStub = defineComponent({
  name: "OTooltip",
  props: { content: { type: String, default: "" } },
  template: `<span data-test-stub="tooltip">{{ content }}</span>`,
});

const unlinkedSlack: ChannelReadiness = {
  channel: "slack",
  deliverable: false,
  configured_but_unverified: false,
  blocked_because: "not linked",
};

const render = (own: boolean) =>
  mount(OnCallChannelChips, {
    props: { email: "ana@acme.example", channels: [unlinkedSlack], own },
    global: { plugins: [i18n, makeSlackStore()], stubs: { OTooltip: TooltipStub } },
  });

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

describe("OnCallChannelChips", () => {
  it("names the serving app's own slash command on the caller's unlinked Slack chip", async () => {
    vi.mocked(slack.getMyLinks).mockReturnValue(
      ok({ links: [], slack_serves_org: true, command: "/staging-o2" }) as any,
    );
    const w = render(true);
    await flushPromises();

    expect(w.find('[data-test-stub="tooltip"]').text()).toBe(
      "not linked. Run /staging-o2 link in Slack",
    );
  });

  it("falls back to /o2 when the server names no command", async () => {
    vi.mocked(slack.getMyLinks).mockReturnValue(ok({ links: [], slack_serves_org: true }) as any);
    const w = render(true);
    await flushPromises();

    expect(w.find('[data-test-stub="tooltip"]').text()).toBe("not linked. Run /o2 link in Slack");
  });

  it("does not read the caller's links for another person's row", async () => {
    const w = render(false);
    await flushPromises();

    expect(slack.getMyLinks).not.toHaveBeenCalled();
    expect(w.find('[data-test-stub="tooltip"]').text()).toBe("not linked");
  });
});
