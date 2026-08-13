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

import OnCallUnroutedQueue from "@/components/oncall/OnCallUnroutedQueue.vue";
import i18n from "@/locales";
import type { UnroutedSignal } from "@/ts/interfaces/oncall";
import store from "@/test/unit/helpers/store";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OInnerLoading: { name: "OInnerLoading", template: "<div />" },
  OButton: { name: "OButton", template: "<button><slot /></button>" },
};

function signal(over: Partial<UnroutedSignal> = {}): UnroutedSignal {
  return {
    id: "s1",
    org_id: "default",
    path: "k8s-namespace=payments-edge/service=disputes-api",
    dimensions: { service: "disputes-api", "k8s-namespace": "payments-edge" },
    occurrences: 4,
    first_seen_at: 0,
    last_seen_at: 0,
    last_title: "Dispute webhook backlog",
    description: "4 alerts on service=disputes-api reached no team",
    ...over,
  };
}

function render(signals: UnroutedSignal[] = [signal()]) {
  return mount(OnCallUnroutedQueue, {
    props: { signals, teamName: "Payments" },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallUnroutedQueue", () => {
  it("names the alert and the dimensions a rule would be written against", () => {
    const row = render().find('[data-test="oncall-unrouted-row-s1"]');
    expect(row.text()).toContain("Dispute webhook backlog");
    expect(row.text()).toContain("k8s-namespace = payments-edge · service = disputes-api");
  });

  /// The server's own sentence handles the empty-path case, which reads nothing
  /// like the normal one — so it is the fallback rather than a composed string.
  it("falls back to the server's description when the alert had no title", () => {
    const wrapper = render([signal({ last_title: null })]);
    expect(wrapper.text()).toContain("reached no team");
  });

  it("counts the firings, because one is a curiosity and forty is a problem", () => {
    expect(render().text()).toContain("4 fires");
  });

  it("offers to claim for the team whose screen this is", async () => {
    const wrapper = render();
    expect(wrapper.text()).toContain("Claim for Payments");

    await wrapper.find('[data-test="oncall-unrouted-claim-s1"]').trigger("click");
    expect(wrapper.emitted("claim")?.[0][0]).toMatchObject({ id: "s1" });
  });

  /// Silence is the good outcome here, so it gets a sentence rather than an
  /// empty panel somebody has to interpret.
  it("says so when every alert reached a team", () => {
    const wrapper = render([]);
    expect(wrapper.find('[data-test="oncall-unrouted-empty"]').exists()).toBe(true);
    // Nothing to claim, so the bulk action is not offered.
    expect(wrapper.find('[data-test="oncall-unrouted-claim-all"]').exists()).toBe(false);
  });

  it("dismisses an entry without claiming it", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-unrouted-dismiss-s1"]').trigger("click");
    expect(wrapper.emitted("dismiss")?.[0][0]).toMatchObject({ id: "s1" });
  });
});
