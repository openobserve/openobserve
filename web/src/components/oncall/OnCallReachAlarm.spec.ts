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

import OnCallReachAlarm from "@/components/oncall/OnCallReachAlarm.vue";
import i18n from "@/locales";
import type { DeliveryRecord, EscalationProgress, ResponseState } from "@/ts/interfaces/oncall";

const stubs = {
  OBanner: { name: "OBanner", template: "<div><slot /><slot name='actions' /></div>" },
  OButton: { name: "OButton", emits: ["click"], template: `<button @click="$emit('click')"><slot /></button>` },
};

function delivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    kind: "delivery",
    at: 1,
    actor: "o2-engine",
    body: "email to ana",
    recipient: "ana@o2.ai",
    channel: "email",
    delivered: false,
    ...overrides,
  };
}

function render(options: {
  state?: ResponseState;
  deliveries?: DeliveryRecord[];
  deliveriesTotal?: number | null;
  progress?: Partial<EscalationProgress> | null;
  smtpConfigured?: boolean | null;
} = {}) {
  const deliveries = options.deliveries ?? [delivery()];
  return mount(OnCallReachAlarm, {
    props: {
      state: options.state ?? "triggered",
      deliveries,
      deliveriesTotal: options.deliveriesTotal ?? deliveries.length,
      progress:
        options.progress === null
          ? null
          : {
              fired: [],
              next_targets: [],
              next_at: null,
              exhausted: false,
              ...options.progress,
            },
      smtpConfigured: options.smtpConfigured ?? null,
    },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallReachAlarm", () => {
  it("says nobody has seen the page when every send failed", () => {
    const wrapper = render({ deliveries: [delivery(), delivery({ recipient: "bo@o2.ai" })] });

    expect(wrapper.find('[data-test="oncall-reach-alarm-headline"]').text()).toContain(
      "Nobody has seen this page",
    );
    // Both addresses, deduplicated — five retries to one inbox is one person.
    expect(wrapper.find('[data-test="oncall-reach-alarm-detail"]').text()).toContain("ana@o2.ai");
    expect(wrapper.find('[data-test="oncall-reach-alarm-detail"]').text()).toContain("bo@o2.ai");
  });

  /// A banner that also fires when one send of five bounced is a banner people
  /// learn to scroll past.
  it("stays silent when a send in the same wave landed", () => {
    const wrapper = render({
      deliveries: [delivery(), delivery({ recipient: "bo@o2.ai", delivered: true })],
    });
    expect(wrapper.find('[data-test="oncall-reach-alarm"]').exists()).toBe(false);
  });

  /// Regression: a single landed send anywhere in the page's history used to
  /// silence the banner forever, even after every attempt made since kept
  /// failing for days. This is the common shape in production: one ladder,
  /// no handoff, just a lucky early send followed by a long run of failures
  /// nobody ever saw flagged.
  it("stops crediting an earlier landing once every attempt made since has failed", () => {
    const wrapper = render({
      deliveries: [
        delivery({ delivered: true, at: 100 }), // ana — the last time anyone was reached
        delivery({ recipient: "carl@o2.ai", delivered: false, at: 50 }), // failed before that — history
        delivery({ recipient: "bo@o2.ai", delivered: false, at: 200 }), // failed after — the current silence
      ],
      progress: { exhausted: true },
    });

    expect(wrapper.find('[data-test="oncall-reach-alarm"]').exists()).toBe(true);
    const detail = wrapper.find('[data-test="oncall-reach-alarm-detail"]').text();
    expect(detail).toContain("bo@o2.ai");
    expect(detail).not.toContain("carl@o2.ai");
    expect(detail).not.toContain("ana@o2.ai");
  });

  /// The scoping fix must not depend on the ladder having finished — a
  /// ladder still retrying, with nothing landed since, is already the fact
  /// this banner exists to say.
  it("does not wait for exhaustion once the failures since the last landing alone qualify", () => {
    const wrapper = render({
      deliveries: [
        delivery({ delivered: true, at: 100 }), // landed — history
        delivery({ recipient: "bo@o2.ai", delivered: false, at: 200 }), // failed after
      ],
      progress: { next_at: (Date.now() + 10 * 60_000) * 1000 },
    });
    expect(wrapper.find('[data-test="oncall-reach-alarm"]').exists()).toBe(true);
  });

  /// A page somebody owns has been seen by definition, whatever the transport
  /// records say about the first rung.
  it("stays silent once the page is acknowledged", () => {
    const wrapper = render({ state: "acknowledged" });
    expect(wrapper.find('[data-test="oncall-reach-alarm"]').exists()).toBe(false);
  });

  /// A truncated ledger cannot support "all of them failed" — the send that
  /// landed may be on the page nobody fetched.
  it("withholds the claim while the ledger is truncated", () => {
    const wrapper = render({ deliveries: [delivery()], deliveriesTotal: 40 });
    expect(wrapper.find('[data-test="oncall-reach-alarm"]').exists()).toBe(false);
  });

  /// A room post is a broadcast. One that fails says nothing about whether the
  /// on-call was reached, and must not open the banner on its own.
  it("ignores a failed room post", () => {
    const wrapper = render({
      deliveries: [delivery({ channel: "chat", recipient: "#gateway" })],
    });
    expect(wrapper.find('[data-test="oncall-reach-alarm"]').exists()).toBe(false);
  });

  /// The two ends of this are different emergencies: a ladder still climbing
  /// may yet reach somebody, and one that has finished never will.
  it("separates a ladder still retrying from one that has finished", () => {
    const retrying = render({ progress: { next_at: (Date.now() + 10 * 60_000) * 1000 } });
    expect(retrying.find('[data-test="oncall-reach-alarm-detail"]').text()).toMatch(/tries again/);

    const done = render({ progress: { exhausted: true } });
    expect(done.find('[data-test="oncall-reach-alarm-detail"]').text()).toContain(
      "Nothing is due to try again",
    );
    // Nothing left to escalate to, so the verb that would do it is withheld.
    expect(done.find('[data-test="oncall-reach-alarm-escalate"]').exists()).toBe(false);
  });

  /// The server's own finding, never our inference: `smtp_configured: false`
  /// explains every failed row above it in one line.
  it("names the deployment-level cause only when the server stated it", () => {
    expect(render({ smtpConfigured: false }).find('[data-test="oncall-reach-alarm-cause"]').text())
      .toContain("no transport is configured");
    expect(render({ smtpConfigured: null }).find('[data-test="oncall-reach-alarm-cause"]').exists())
      .toBe(false);
    expect(render({ smtpConfigured: true }).find('[data-test="oncall-reach-alarm-cause"]').exists())
      .toBe(false);
  });

  it("offers the two verbs that actually exist", async () => {
    const wrapper = render();

    await wrapper.find('[data-test="oncall-reach-alarm-escalate"]').trigger("click");
    await wrapper.find('[data-test="oncall-reach-alarm-reachability"]').trigger("click");

    expect(wrapper.emitted("escalate")).toHaveLength(1);
    expect(wrapper.emitted("open-reachability")).toHaveLength(1);
  });
});
