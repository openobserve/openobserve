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

import { describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import RcaToolCallRow from "./RcaToolCallRow.vue";
import { rcaToolCall } from "@/test/unit/fixtures/rcaThread";
import type { RcaToolCall } from "@/services/incidents";

const mountRow = (call: RcaToolCall) =>
  mount(RcaToolCallRow, { props: { call }, global: { plugins: [i18n] } });

const text = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`).text();

describe("RcaToolCallRow (02 TH33, TH34, TH38)", () => {
  it("shows tool, key argument, summary, OK and duration", () => {
    const wrapper = mountRow(rcaToolCall());

    expect(text(wrapper, "rca-tool-call-name")).toBe("SearchSQL");
    expect(text(wrapper, "rca-tool-call-arg")).toBe("SELECT count(*) FROM checkout_logs");
    expect(text(wrapper, "rca-tool-call-summary")).toBe("42 rows");
    expect(text(wrapper, "rca-tool-call-status")).toBe("OK · 1.2s");
    expect(wrapper.find('[data-test="rca-tool-call-error"]').exists()).toBe(false);
  });

  it("shows Error and the error text of a failed call", () => {
    const wrapper = mountRow(
      rcaToolCall({ status: "error", result_summary: null, error: "upstream timeout" }),
    );

    expect(text(wrapper, "rca-tool-call-status")).toBe("Error");
    expect(text(wrapper, "rca-tool-call-error")).toBe("upstream timeout");
    expect(wrapper.find('[data-test="rca-tool-call-summary"]').exists()).toBe(false);
  });

  it("shows Running for a call in flight", () => {
    const wrapper = mountRow(rcaToolCall({ status: "running", duration_ms: null }));

    expect(text(wrapper, "rca-tool-call-status")).toBe("Running");
  });

  it("expands the key argument on click", async () => {
    const wrapper = mountRow(rcaToolCall());
    const arg = wrapper.find('[data-test="rca-tool-call-arg"]');
    expect(arg.attributes("aria-expanded")).toBe("false");

    await arg.trigger("click");

    expect(arg.attributes("aria-expanded")).toBe("true");
  });

  it("a11y: the key-arg button is named by the query and controls an existing element", () => {
    const wrapper = mountRow(rcaToolCall());
    const arg = wrapper.find('[data-test="rca-tool-call-arg"]');

    expect(arg.attributes("aria-label")).toBeUndefined();
    expect(arg.text()).toContain("SELECT count(*) FROM checkout_logs");
    const controls = arg.attributes("aria-controls");
    expect(controls).toBeTruthy();
    expect(wrapper.find(`[id="${controls}"]`).text()).toBe("SELECT count(*) FROM checkout_logs");
  });

  it("offers no raw data without input/output (TH33 default)", () => {
    const wrapper = mountRow(rcaToolCall());

    expect(wrapper.find('[data-test="rca-tool-call-raw-toggle"]').exists()).toBe(false);
  });

  it("shows input and output when the org setting sends them (TH34)", async () => {
    const wrapper = mountRow(rcaToolCall({ input: { sql: "SELECT 1" }, output: '{"hits": [1]}' }));
    const toggle = wrapper.find('[data-test="rca-tool-call-raw-toggle"]');
    expect(toggle.text()).toBe("Show input and output");

    await toggle.trigger("click");

    expect(text(wrapper, "rca-tool-call-input")).toBe('{\n  "sql": "SELECT 1"\n}');
    expect(text(wrapper, "rca-tool-call-output")).toBe('{"hits": [1]}');
    expect(toggle.text()).toBe("Hide input and output");
    const controls = toggle.attributes("aria-controls");
    expect(controls).toBeTruthy();
    expect(
      wrapper.find(`[id="${controls}"]`).find('[data-test="rca-tool-call-input"]').exists(),
    ).toBe(true);
  });
});
