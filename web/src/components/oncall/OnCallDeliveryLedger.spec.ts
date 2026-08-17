// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallDeliveryLedger from "@/components/oncall/OnCallDeliveryLedger.vue";
import i18n from "@/locales";
import type { DeliveryRecord } from "@/ts/interfaces/oncall";

const stubs = {
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  OTimeCell: { name: "OTimeCell", props: ["value"], template: "<span />" },
};

function row(over: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    kind: "delivery",
    at: 1_700_000_000_000_000,
    actor: "o2-engine",
    body: "paged ana@o2.ai on email",
    rung_micros: 0,
    recipient: "ana@o2.ai",
    channel: "email",
    delivered: true,
    ...over,
  } as DeliveryRecord;
}

function render(records: DeliveryRecord[], total = records.length) {
  return mount(OnCallDeliveryLedger, {
    props: { records, total },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallDeliveryLedger", () => {
  it("shows the receipt per send: who, channel, landed or failed", () => {
    const text = render([row(), row({ recipient: "bo@o2.ai", delivered: false })]).text();
    expect(text).toContain("ana@o2.ai");
    expect(text).toContain("Landed");
    expect(text).toContain("Failed");
  });

  /// One run needs no header — "Run 1" over everything is a header with no
  /// question behind it.
  it("draws no run boundary while the ladder has climbed once", () => {
    const wrapper = render([row(), row({ recipient: "bo@o2.ai" })]);
    expect(wrapper.find('[data-test="oncall-deliveries-run-1"]').exists()).toBe(false);
  });

  /// A page that changed hands is climbed by more than one ladder; the old
  /// team's sends must not read as rungs of the new team's climb. Absent
  /// ladder_run means the first run; newest run renders first.
  it("groups by ladder run once a handoff has restarted the climb", () => {
    const wrapper = render([
      row(),
      row({ recipient: "bo@o2.ai", ladder_run: 2 }),
    ]);
    expect(wrapper.find('[data-test="oncall-deliveries-run-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-deliveries-run-2"]').exists()).toBe(true);
    const html = wrapper.html();
    expect(html.indexOf("oncall-deliveries-run-2")).toBeLessThan(
      html.indexOf("oncall-deliveries-run-1"),
    );
  });

  /// The server truncates and says so via `total`; the panel must not vouch
  /// for completeness it does not have.
  it("says when the server sent fewer rows than exist", () => {
    const wrapper = render([row()], 340);
    expect(wrapper.find('[data-test="oncall-deliveries-truncated"]').text()).toContain("340");
  });

  it("has an empty state that says nothing was sent", () => {
    expect(render([]).text()).toContain("Nothing has been sent yet");
  });
});
