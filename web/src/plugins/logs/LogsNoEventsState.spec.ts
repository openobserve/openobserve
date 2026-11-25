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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import LogsNoEventsState from "./LogsNoEventsState.vue";

const OEmptyStateStub = defineComponent({
  name: "OEmptyState",
  setup(_, { slots }) {
    return () => h("div", { "data-test": "o-empty-state" }, [slots.description?.()]);
  },
});

const mountState = (relativeTimePeriod: string) =>
  mount(LogsNoEventsState, {
    props: {
      sqlMode: false,
      query: "",
      relativeTimePeriod,
      dateType: "relative",
      aiEnabled: false,
    },
    global: { plugins: [i18n, store], stubs: { OEmptyState: OEmptyStateStub } },
  });

describe("LogsNoEventsState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names a calendar period in the no-events message", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T03:00:00Z"));
    const text = mountState("calendar:month:-1").text();
    expect(text).toContain("Last month");
    expect(text).not.toContain("NaN");
  });

  it("keeps the rolling wording for a rolling period", () => {
    expect(mountState("15m").text()).toContain("Past 15 Minutes");
  });

  it.each([
    ["SELECT * FROM \"app\" WHERE level = 'x'", "Nothing matched"],
    ['SELECT * FROM "app"', "doesn't contain any data"],
  ])("reads the WHERE of the SQL query it is given: %s", (query, copy) => {
    const wrapper = mount(LogsNoEventsState, {
      props: {
        sqlMode: true,
        query,
        relativeTimePeriod: "1d",
        dateType: "relative",
        aiEnabled: false,
        streamDocTimeRange: { min: 1_000_000, max: 2_000_000 },
        queryWindowUs: { start: 0, end: 3_000_000 },
      },
      global: { plugins: [i18n, store], stubs: { OEmptyState: OEmptyStateStub } },
    });
    expect(wrapper.text()).toContain(copy);
  });

  const mountWithError = (functionError: string | string[]) =>
    mount(LogsNoEventsState, {
      props: {
        sqlMode: true,
        query: 'SELECT * FROM "app"',
        relativeTimePeriod: "15m",
        dateType: "relative",
        aiEnabled: false,
        functionError,
      },
      global: { plugins: [i18n, store], stubs: { OEmptyState: OEmptyStateStub } },
    });
  const bannerOf = (wrapper: ReturnType<typeof mountWithError>) =>
    wrapper.findComponent({ name: "OBanner" });

  it("shows the server's error above the no-events copy as a warning", () => {
    const banner = bannerOf(mountWithError("regex parse error: unclosed group"));
    expect(banner.props("variant")).toBe("warning");
    expect(banner.text()).toContain("Query execution warning");
    expect(banner.text()).toContain("regex parse error: unclosed group");
  });

  it.each([
    ["a JSON array text", '["Query duration is modified", "second notice"]'],
    ["an array", ["Query duration is modified", "second notice"]],
  ])("lists the messages of %s one per line, without brackets", (_, functionError) => {
    const banner = bannerOf(mountWithError(functionError));
    const message = banner.find(".font-mono").element.textContent;
    expect(message).toBe("Query duration is modified\nsecond notice");
  });

  it("keeps a message that only starts with a bracket", () => {
    const banner = bannerOf(mountWithError("[E203] syntax error"));
    expect(banner.find(".font-mono").text()).toBe("[E203] syntax error");
  });

  it("fills the pane it is placed in, as the drill-down gives it no flex class", () => {
    expect(mountState("15m").classes()).toContain("h-full");
  });

  it("shows no error banner when the run had none", () => {
    expect(mountState("15m").find('[data-test="logs-no-events-query-error"]').exists()).toBe(false);
  });
});
