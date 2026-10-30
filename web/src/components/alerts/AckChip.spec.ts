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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { AckSource } from "@/ts/interfaces/alert";
import AckChip from "./AckChip.vue";

// 14:08 UTC on 2026-10-22, in microseconds.
const ACKED_AT = Date.parse("2026-10-22T14:08:00Z") * 1000;

const store = createStore({ state: { timezone: "UTC" } });

const chip = (source: AckSource, ackedBy = "bob@acme.io") =>
  mount(AckChip, {
    props: { ack: { acked_by: ackedBy, acked_at: ACKED_AT, ack_source: source } },
    global: { plugins: [store] },
  });

// Intl may join the time and AM/PM with a narrow no-break space.
const plain = (s: string | undefined) => (s ?? "").replace(/\s/g, " ");

describe("AckChip", () => {
  it("says who acknowledged, through what, and when", () => {
    const wrapper = chip("slack");
    expect(plain(wrapper.text())).toContain("Acked by bob via Slack · 2:08 PM");
    expect(wrapper.get('[data-test="ack-chip"]').exists()).toBe(true);
  });

  it("names the full address and the source in the hover", () => {
    const wrapper = chip("slack");
    expect(plain(wrapper.findComponent(OTooltip).props("content"))).toBe(
      "Acknowledged by bob@acme.io at 2:08 PM from Slack",
    );
  });

  it.each([
    ["ui", "via OpenObserve"],
    ["api", "via API"],
    ["oncall", "via on-call"],
    ["incident", "via incident"],
  ] as [AckSource, string][])("labels the %s source", (source, label) => {
    expect(plain(chip(source).text())).toContain(label);
  });

  it("renders as the acknowledged state badge", () => {
    const tag = chip("slack").findComponent(OTag);
    expect(tag.props("type")).toBe("alertState");
    expect(tag.props("value")).toBe("acknowledged");
  });

  it("shows a non-email actor as it is", () => {
    expect(plain(chip("oncall", "o2-engine").text())).toContain("Acked by o2-engine via on-call");
  });
});
