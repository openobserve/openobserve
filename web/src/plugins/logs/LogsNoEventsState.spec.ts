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
      editorValue: "",
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
});
