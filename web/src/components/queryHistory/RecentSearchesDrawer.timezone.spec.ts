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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import type { QueryHistoryEntry } from "@/services/query_history";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  record: vi.fn(),
  star: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  count: vi.fn(),
}));
vi.mock("@/services/query_history", () => ({ default: api }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn(), resolve: vi.fn() }) }));

import i18n from "@/locales";
import RecentSearchesDrawer from "./RecentSearchesDrawer.vue";

enableAutoUnmount(afterEach);

const at = (iso: string) => Date.parse(iso) * 1000;

const row = (id: string, ranAt: string): QueryHistoryEntry => ({
  id,
  source: "logs",
  query: `query ${id}`,
  query_key: id,
  streams: ["k8s"],
  context: {},
  status: "ok",
  starred: false,
  run_count: 1,
  created_at: at(ranAt),
  updated_at: at(ranAt),
});

const mountDrawer = () =>
  mount(RecentSearchesDrawer, {
    props: { source: "logs", open: true },
    global: {
      plugins: [store, i18n],
      stubs: {
        ODrawer: {
          props: ["open"],
          template: `<div v-if="open"><slot name="header-left" /><slot /><slot name="footer" /></div>`,
        },
        RecentSearchesDayPicker: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: `<input data-stub="date" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
        },
        OTimeCell: true,
        OTooltip: true,
      },
    },
  });

describe("RecentSearchesDrawer in the configured timezone", () => {
  const original = store.state.timezone;

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.timezone = "Asia/Kolkata";
    api.count.mockResolvedValue({ data: { count: 0 } });
    // 20:00 UTC is 01:30 the next day in Kolkata; the test runner's own zone is UTC.
    api.list.mockResolvedValue({
      data: [row("late", "2025-03-04T20:00:00Z"), row("noon", "2025-03-04T10:00:00Z")],
    });
  });
  afterEach(() => {
    store.state.timezone = original;
  });

  it("cuts the day headers in the app timezone, not the browser's", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    const days = wrapper.findAll('[data-test="recent-searches-day"]');
    expect(days).toHaveLength(2);
    expect(days[0].text()).toContain("Wed, Mar 5");
    expect(days[1].text()).toContain("Tue, Mar 4");
  });

  it("asks for a Ran on day's bounds in the app timezone", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-stub="date"]').setValue("2025-03-05");
    await flushPromises();
    expect(api.list.mock.calls.at(-1)?.[1]).toMatchObject({
      ran_from: at("2025-03-04T18:30:00Z"),
      ran_to: at("2025-03-05T18:30:00Z") - 1,
    });
  });
});
