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
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";
import en from "@/locales/languages/en-US.json";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import SubtestPicker from "./SubtestPicker.vue";

vi.mock("@/services/synthetics", () => ({
  default: {
    listByFolderId: vi.fn(),
    get: vi.fn(),
    getRuns: vi.fn(),
  },
}));

import syntheticsService from "@/services/synthetics";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

const CHECKS = [
  { id: "self", name: "Checkout", type: "browser" },
  { id: "login-test", name: "Login", type: "browser" },
  { id: "api-1", name: "Orders API", type: "http" },
];

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(SubtestPicker, {
    props: { ownCheckId: "self", ownStepCount: 4, ...props },
    global: { plugins: [store, i18n] },
  });
}

describe("SubtestPicker", () => {
  it("mounts and renders the picker select", async () => {
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    const w = mountPicker();
    await flushPromises();
    // Precondition: the component actually mounted and rendered a select —
    // otherwise every assertion below that reads its props is vacuous.
    expect(w.find('[data-test="synthetics-subtest-picker"]').exists()).toBe(true);
    expect(w.findComponent(OSelect).exists()).toBe(true);
  });

  it("offers every other browser check and never itself or a protocol check", async () => {
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    const w = mountPicker();
    await flushPromises();
    const options = w.findComponent(OSelect).props("options") as unknown as {
      header?: boolean;
      value?: string;
    }[];
    expect(options.map((o) => o.value)).toEqual(["login-test"]);
    expect(options.some((o) => o.header)).toBe(false);
  });

  it("emits the reference and states the executed-step delta and the run time", async () => {
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: new Array(13).fill({ id: "c", action: "click" }) } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [{ created_at: 0, completed_at: 20_000_000 }] },
    });
    // What the host really passes: the expanded count, already including the child's 13 steps.
    const w = mountPicker({ ownStepCount: 16 });
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    expect(syntheticsService.get).toHaveBeenCalledTimes(1);
    expect(w.emitted("update:modelValue")![0][0]).toEqual({ id: "login-test", name: "Login" });
    // 3 own steps before this reference existed, 16 executed after it resolves.
    expect(w.find('[data-test="synthetics-subtest-delta"]').text()).toContain("3 → 16");
    expect(w.find('[data-test="synthetics-subtest-lastrun"]').text()).toContain("20");
  });

  it("shows the delta alone when the child has never completed a run", async () => {
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: [] } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [] },
    });
    const w = mountPicker();
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();
    // Assert the node is absent rather than matching copy, which changes with the locale.
    expect(w.find('[data-test="synthetics-subtest-delta"]').exists()).toBe(true);
    // A 0-step child adds nothing; the old arithmetic rendered "4 \u2192 3", backwards.
    expect(w.find('[data-test="synthetics-subtest-delta"]').text()).toContain("4 \u2192 4");
    expect(w.find('[data-test="synthetics-subtest-lastrun"]').exists()).toBe(false);
    // Design 5.11 state 3: show the delta only AND say the time impact is unknown.
    expect(w.find('[data-test="synthetics-subtest-lastrun-unknown"]').exists()).toBe(true);
  });

  it("counts the child's steps once, not twice", async () => {
    // The host's count already includes the pick, so adding the child again double-counts it.
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: new Array(3).fill({ id: "c", action: "click" }) } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [] },
    });
    const w = mountPicker({ ownStepCount: 4 });
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    expect(w.find('[data-test="synthetics-subtest-delta"]').text()).toContain("1 \u2192 4");
  });

  it("withholds the delta entirely when the host cannot expand the journey", async () => {
    // `ownStepCount` is undefined whenever `expandJourney` throws; inventing a number there lies.
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: new Array(13).fill({ id: "c", action: "click" }) } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [] },
    });
    const w = mountPicker({ ownStepCount: undefined });
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    expect(w.find('[data-test="synthetics-subtest-delta"]').exists()).toBe(false);
    expect(w.text()).not.toContain("0 \u2192");
    expect(w.find('[data-test="synthetics-subtest-delta-unknown"]').exists()).toBe(true);
  });

  it("withholds the delta when the host count cannot contain the child", async () => {
    // Re-picking a bigger child: the host's count still describes the previous one, so it is
    // stale. Subtracting anyway rendered a negative "before" against the old child's name.
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: CHECKS },
    });
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: new Array(10).fill({ id: "c", action: "click" }) } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [] },
    });
    const w = mountPicker({ ownStepCount: 3 });
    await flushPromises();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    expect(w.find('[data-test="synthetics-subtest-delta"]').exists()).toBe(false);
    expect(w.text()).not.toMatch(/-\d+/);
    expect(w.find('[data-test="synthetics-subtest-delta-unknown"]').exists()).toBe(true);
  });
});

// ── Flat, annotated rows (Phase B) ───────────────────────────────────────────
// Everything on a row comes from the list response; nothing costs a request per option.
describe("SubtestPicker rows", () => {
  const NOW = new Date("2026-09-11T12:00:00Z");
  const MINUTE_US = 60 * 1_000_000;
  const usAgo = (minutes: number) => NOW.getTime() * 1000 - minutes * MINUTE_US;

  const ROWS = [
    {
      id: "self",
      name: "Checkout",
      type: "browser",
      folder_id: "default",
      steps: 4,
      referenced_by: 0,
      references: 0,
      enabled: true,
      status: "passed",
      last_check_at: usAgo(1),
    },
    {
      id: "login-test",
      name: "Login",
      type: "browser",
      folder_id: "shared",
      steps: 13,
      referenced_by: 5,
      references: 0,
      enabled: true,
      status: "passed",
      last_check_at: usAgo(4),
    },
    {
      id: "login-staging",
      name: "Login (staging)",
      type: "browser",
      folder_id: "staging",
      steps: 13,
      referenced_by: 1,
      references: 0,
      enabled: false,
      status: "failed",
      last_check_at: usAgo(2 * 24 * 60),
    },
    {
      id: "checkout-full",
      name: "Checkout — full flow",
      type: "browser",
      folder_id: "checkout",
      steps: 20,
      referenced_by: 0,
      references: 1,
      enabled: true,
      status: "unknown",
      last_check_at: null,
    },
    { id: "api-1", name: "Orders API", type: "http" },
  ];

  type Row = {
    header?: boolean;
    label: string;
    value?: string;
    disabled?: boolean;
    badge?: string;
    badgeMuted?: boolean;
    subLabel?: string;
  };

  async function mountWithRows(rows: unknown[], props: Record<string, unknown> = {}) {
    (syntheticsService.listByFolderId as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { checks: rows },
    });
    const w = mountPicker(props);
    await flushPromises();
    return w;
  }

  const optionsOf = (w: ReturnType<typeof mountPicker>) =>
    w.findComponent(OSelect).props("options") as unknown as Row[];
  const rowOf = (w: ReturnType<typeof mountPicker>, value: string) =>
    optionsOf(w).find((o) => o.value === value)!;

  beforeEach(() => {
    store.commit("setFoldersByType", {
      synthetics: [
        { folderId: "default", name: "default" },
        { folderId: "shared", name: "Shared" },
        { folderId: "staging", name: "Staging" },
        { folderId: "checkout", name: "Checkout" },
      ],
    });
    // "4 minutes ago" is measured from a pinned clock, not from whenever the test runs.
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists every other browser check flat, in list order, with no header rows", async () => {
    const w = await mountWithRows(ROWS);
    const shape = optionsOf(w).map((o) => ({ value: o.value, disabled: o.disabled === true }));
    expect(shape).toEqual([
      { value: "login-test", disabled: false },
      { value: "login-staging", disabled: false },
      { value: "checkout-full", disabled: true },
    ]);
    expect(optionsOf(w).some((o) => o.header)).toBe(false);
    expect(w.findComponent(OSelect).props("disabled")).toBe(false);
  });

  it("disables a check that already contains a subtest and explains why", async () => {
    const w = await mountWithRows(ROWS);
    const nested = rowOf(w, "checkout-full");
    expect(nested.disabled).toBe(true);
    expect(nested.subLabel).toBe("Already contains a subtest — nesting is limited to one level");
    expect(nested.badgeMuted).toBe(true);
    // Eligible rows stay selectable.
    expect(rowOf(w, "login-test").disabled).not.toBe(true);
  });

  it("keeps ineligible checks listed and disabled even when every check is ineligible", async () => {
    // Ineligible rows are explained, not hidden: the list must not collapse to the empty state.
    const allNested = ROWS.map((r) =>
      r.type === "browser" && r.id !== "self" ? { ...r, references: 1 } : r,
    );
    const w = await mountWithRows(allNested);
    const shape = optionsOf(w).map((o) => ({ value: o.value, disabled: o.disabled }));
    expect(shape).toEqual([
      { value: "login-test", disabled: true },
      { value: "login-staging", disabled: true },
      { value: "checkout-full", disabled: true },
    ]);
    expect(optionsOf(w).some((o) => o.header)).toBe(false);
    expect(w.find('[data-test="synthetics-subtest-empty"]').exists()).toBe(false);
    expect(w.findComponent(OSelect).props("disabled")).toBe(false);
  });

  it("annotates a row with folder, step count, used-by (pluralised) and last run", async () => {
    const neverRun = {
      id: "fresh",
      name: "Fresh",
      type: "browser",
      folder_id: "default",
      steps: null,
      referenced_by: 0,
      references: 0,
      enabled: true,
      status: "unknown",
      last_check_at: usAgo(1),
    };
    const passedNeverTimed = {
      ...neverRun,
      id: "passed-no-time",
      name: "Passed, untimed",
      steps: 2,
      status: "passed",
      last_check_at: null,
    };
    const w = await mountWithRows([...ROWS, neverRun, passedNeverTimed]);
    const login = rowOf(w, "login-test");
    expect(login.label).toBe("Login");
    expect(login.badge).toBe("Shared");
    expect(login.badgeMuted).toBe(true);
    expect(login.subLabel).toBe("13 steps · Used by 5 tests · Passed 4 minutes ago");
    // A single referrer reads in the singular.
    expect(rowOf(w, "login-staging").subLabel).toContain("Used by 1 test ·");
    // Null steps, no referrers and an unknown status contribute no fragment, even with a timestamp.
    const fresh = rowOf(w, "fresh");
    expect(fresh.disabled).not.toBe(true);
    expect(fresh.subLabel ?? "").toBe("");
    // A known status without a timestamp is just as silent about the last run.
    expect(rowOf(w, "passed-no-time").subLabel).toBe("2 steps");
  });

  it("marks a paused check and still offers it", async () => {
    const w = await mountWithRows(ROWS);
    const options = optionsOf(w);
    const paused = rowOf(w, "login-staging");
    expect(paused.disabled).not.toBe(true);
    expect(paused.subLabel).toBe("13 steps · Used by 1 test · Paused · Failed 2 days ago");
    // Offered: it is a plain row in the flat list, not a header.
    expect(options).toContain(paused);
    expect(paused.header).not.toBe(true);
    expect(rowOf(w, "login-test").subLabel).not.toContain("Paused");
  });

  it("shows the empty state and disables the select when no other browser test exists", async () => {
    const w = await mountWithRows(ROWS.filter((r) => r.id === "self" || r.id === "api-1"));
    const empty = w.find('[data-test="synthetics-subtest-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toBe("No other browser tests in this organization yet.");
    expect(w.findComponent(OSelect).props("disabled")).toBe(true);
    expect(optionsOf(w)).toEqual([]);
  });

  it("states the limit in the delta line", async () => {
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: new Array(13).fill({ id: "c", action: "click" }) } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [] },
    });
    const w = await mountWithRows(ROWS, { ownStepCount: 16 });
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    const delta = w.find('[data-test="synthetics-subtest-delta"]').text();
    expect(delta).toContain("3 → 16");
    expect(delta).toContain("The limit is 50.");
  });

  it("uses the passed journey budget in the run-time line", async () => {
    (syntheticsService.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { name: "Login", config: { steps: new Array(13).fill({ id: "c", action: "click" }) } },
    });
    (syntheticsService.getRuns as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { runs: [{ created_at: 0, completed_at: 20_000_000 }] },
    });
    const w = await mountWithRows(ROWS, { ownStepCount: 16, journeyBudgetMs: 120_000 });
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "login-test");
    await flushPromises();

    const lastRun = w.find('[data-test="synthetics-subtest-lastrun"]').text();
    expect(lastRun).toContain("20s");
    expect(lastRun).toContain("120s allowance");
    expect(lastRun).not.toContain("300s");
  });
});
