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

import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import type { ReviewRow } from "@/composables/alerts/useLibraryReview";
import type { AlertLibraryEntry } from "@/types/alertLibrary";

const state = vi.hoisted(() => ({
  load: vi.fn(),
  enable: vi.fn(),
  toast: vi.fn(),
  onAdded: null as null | ((id: string) => void),
}));

const rows = ref<ReviewRow[]>([]);
const selectedIds = ref<string[]>([]);
const loading = ref(false);
const enabling = ref(false);

vi.mock("@/composables/alerts/useLibraryReview", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/composables/alerts/useLibraryReview",
  );
  return {
    ...actual,
    useLibraryReview: (deps: { onAdded: (id: string) => void }) => {
      state.onAdded = deps.onAdded;
      return { rows, selectedIds, loading, enabling, load: state.load, enable: state.enable };
    },
  };
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: state.toast }));

import LibraryReviewDrawer from "./LibraryReviewDrawer.vue";

const entry = (name: string, severity: "critical" | "warning" = "critical"): AlertLibraryEntry => ({
  id: `hadoop/${name}`,
  name,
  pack: "databases",
  category: "namenode",
  title: `Rule ${name}`,
  severity,
  description: "",
  stream: "up",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["up"],
  path: `packs/hadoop/${name}.json`,
  content_hash: "h1",
});

const row = (name: string, change: Partial<ReviewRow> = {}): ReviewRow => ({
  id: `hadoop/${name}`,
  entry: entry(name),
  state: "ready",
  needsData: "",
  requires: "up",
  threshold: "< 1",
  fires: 0,
  anomaly: false,
  ...change,
});

const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "title", "subTitle", "primaryButtonLabel", "primaryButtonDisabled"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template:
    '<div data-test="o-drawer" :data-title="title"><slot />' +
    '<button data-test="review-enable" :disabled="primaryButtonDisabled" @click="$emit(\'click:primary\')">{{ primaryButtonLabel }}</button></div>',
};

const mountDrawer = (props: Record<string, unknown> = {}) =>
  mount(LibraryReviewDrawer, {
    props: {
      open: true,
      pack: "databases",
      entries: [entry("a"), entry("b")],
      ...props,
    },
    global: { plugins: [i18n], stubs: { ODrawer: ODrawerStub } },
  });

beforeEach(() => {
  rows.value = [];
  selectedIds.value = [];
  loading.value = false;
  enabling.value = false;
  state.load.mockResolvedValue(undefined);
  state.enable.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LibraryReviewDrawer", () => {
  it("loads the pack's rules when it opens", async () => {
    const entries = [entry("a"), entry("b")];
    mountDrawer({ entries });
    await flushPromises();
    expect(state.load).toHaveBeenCalledWith(entries);
  });

  it("loads nothing while closed", async () => {
    mountDrawer({ open: false });
    await flushPromises();
    expect(state.load).not.toHaveBeenCalled();
  });

  it("names the pack in the title", () => {
    expect(String(mountDrawer().findComponent({ name: "ODrawer" }).props("title"))).toBe(
      "Review Databases alerts",
    );
  });

  it("shows each rule's threshold, needs and yesterday's estimate", async () => {
    rows.value = [
      row("a", { fires: 12 }),
      row("b", { state: "needsData", needsData: "job hadoop-namenode" }),
    ];
    const wrapper = mountDrawer();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Rule a");
    expect(text).toContain("< 1");
    expect(text).toContain("Would have fired 12 times yesterday");
    expect(wrapper.find('[data-test="alert-library-review-status-hadoop/b"]').text()).toBe(
      "Needs data: job hadoop-namenode",
    );
  });

  it("says a failed label check could not check, not that data arrives", async () => {
    rows.value = [row("a", { state: "unknown" })];
    const wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find('[data-test="alert-library-review-status-hadoop/a"]').text()).toBe(
      "Couldn't check",
    );
  });

  it("counts the ticked rules on Enable and disables it while loading", async () => {
    rows.value = [row("a"), row("b")];
    selectedIds.value = ["hadoop/a", "hadoop/b"];
    loading.value = true;
    const wrapper = mountDrawer();
    await flushPromises();
    const button = wrapper.find('[data-test="review-enable"]');
    expect(button.text()).toBe("Enable 2");
    expect(button.attributes("disabled")).toBeDefined();
  });

  it("enables the ticked rules and reports what it did", async () => {
    rows.value = [row("a"), row("b")];
    selectedIds.value = ["hadoop/a", "hadoop/b"];
    state.enable.mockResolvedValue([
      row("a", { result: "added" }),
      row("b", { result: "paused", fires: 40 }),
    ]);
    const wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-test="review-enable"]').trigger("click");
    await flushPromises();
    expect(state.enable).toHaveBeenCalledTimes(1);
    const message = String(state.toast.mock.calls.at(-1)?.[0].message);
    expect(message).toContain("Added 2 alerts to Databases");
    expect(message).toContain("1 paused");
  });

  it("re-emits each added rule so the page can mark it", async () => {
    const wrapper = mountDrawer();
    state.onAdded?.("hadoop/a");
    expect(wrapper.emitted("added")).toEqual([["hadoop/a"]]);
  });
});
