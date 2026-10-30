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
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import store from "@/test/unit/helpers/store";
import type { QueryHistoryEntry } from "@/services/query_history";
import { useRecentEntryText } from "./useRecentEntryText";

const at = (iso: string) => Date.parse(iso) * 1000;

const entry = (overrides: Partial<QueryHistoryEntry>): QueryHistoryEntry => ({
  id: "e",
  source: "logs",
  query: "q",
  query_key: "k",
  streams: [],
  context: {},
  status: "ok",
  starred: false,
  run_count: 1,
  created_at: at("2026-10-29T10:00:00Z"),
  updated_at: at("2026-10-29T10:00:00Z"),
  ...overrides,
});

const text = () => {
  let api!: ReturnType<typeof useRecentEntryText>;
  mount(
    defineComponent({
      setup() {
        api = useRecentEntryText();
        return () => null;
      },
    }),
    { global: { plugins: [store] } },
  );
  return api;
};

describe("useRecentEntryText", () => {
  it("shows a same-day run span as times only", () => {
    const span = text().spanText(entry({ run_count: 3, created_at: at("2026-10-29T08:05:00Z") }));
    expect(span).toBe("ran 3x · 08:05–10:00");
  });

  it("dates both ends of a run span that covers several days", () => {
    const span = text().spanText(entry({ run_count: 4, created_at: at("2026-10-26T09:12:00Z") }));
    expect(span).toBe("ran 4x · Oct 26 09:12 – Oct 29 10:00");
  });

  it("names a calendar preset by its rail label, not its stored token", () => {
    const api = text();
    const relative = (period: string) =>
      api.windowText(
        entry({ context: { time: { type: "relative", period, start_time: 0, end_time: 0 } } }),
      );
    expect(relative("calendar:day:0")).toBe("Today");
    expect(relative("calendar:week:0")).toBe("This week");
    expect(relative("calendar:month:-1")).toBe("Last month");
    expect(relative("15m")).toBe("Last 15m");
    expect(api.windowText(entry({ context: { time_range: { period: "calendar:day:-1" } } }))).toBe(
      "Yesterday",
    );
  });

  it("cuts days in the configured timezone", () => {
    const original = store.state.timezone;
    store.state.timezone = "Asia/Kolkata";
    try {
      const api = text();
      expect(api.zone.value).toBe("Asia/Kolkata");
      expect(api.spanText(entry({ run_count: 2, created_at: at("2026-10-28T20:00:00Z") }))).toBe(
        "ran 2x · 01:30–15:30",
      );
    } finally {
      store.state.timezone = original;
    }
  });
});
