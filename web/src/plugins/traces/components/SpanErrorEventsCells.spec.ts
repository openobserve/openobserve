// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import SpanEventsCell from "./SpanEventsCell.vue";
import SpanErrorCell from "./SpanErrorCell.vue";

const START_NS = 1752490492843000000;
const ev = (name: string, ms: number, extra: Record<string, unknown> = {}) => ({
  name,
  _timestamp: START_NS + ms * 1_000_000,
  ...extra,
});

const mountEvents = (events: unknown[] | string) =>
  mount(SpanEventsCell, {
    props: {
      row: {
        start_time: START_NS,
        operation_name: "SELECT products",
        events: typeof events === "string" ? events : JSON.stringify(events),
      },
    },
    global: { plugins: [i18n] },
  });

describe("SpanEventsCell", () => {
  it("shows a dash when the span has no events", () => {
    const wrapper = mountEvents("[]");
    expect(wrapper.find('[data-test="span-events-cell-empty"]').text()).toBe("–");
    expect(wrapper.find('[data-test="span-events-cell"]').exists()).toBe(false);
  });

  it("counts exceptions and logs with plural forms", () => {
    const wrapper = mountEvents([
      ev("exception", 2, { "exception.message": "reset" }),
      ev("exception", 1880, { "exception.message": "reset again" }),
      ev("pool: closing broken connection", 1890),
    ]);
    expect(wrapper.find('[data-test="span-events-cell"]').text()).toBe("2 exceptions · 1 log");
  });

  it("uses the singular for a lone log event", () => {
    const wrapper = mountEvents([ev("cache miss", 1)]);
    expect(wrapper.find('[data-test="span-events-cell"]').text()).toBe("1 log");
  });

  it("uses the error colour only when an event is an exception", () => {
    const withException = mountEvents([ev("exception", 1)]);
    const logsOnly = mountEvents([ev("cache miss", 1)]);
    expect(withException.find('[data-test="span-events-cell"]').classes().join(" ")).not.toBe(
      logsOnly.find('[data-test="span-events-cell"]').classes().join(" "),
    );
  });
});

describe("SpanErrorCell", () => {
  const mountError = (row: Record<string, unknown>) =>
    mount(SpanErrorCell, { props: { row }, global: { plugins: [i18n] } });

  it("renders the HTTP code then the message on an error span", () => {
    const wrapper = mountError({
      span_status: "ERROR",
      status_message: "upstream request failed",
      http_status_code: 503,
    });
    expect(wrapper.find('[data-test="span-status-code-badge"]').text()).toBe("503");
    expect(wrapper.find('[data-test="span-error-cell-message"]').text()).toBe(
      "upstream request failed",
    );
  });

  it("renders nothing on a span that is not an error", () => {
    const wrapper = mountError({ span_status: "OK", status_message: "fine" });
    expect(wrapper.find('[data-test="span-error-cell"]').exists()).toBe(false);
  });
});
