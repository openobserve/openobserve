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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import RunDetailDrawer from "./RunDetailDrawer.vue";

// Raw stream rows go through the REAL mapper, so `start_load` takes production's path.
const executeQuery = vi.fn();
const cancelAll = vi.fn();
vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({ executeQuery, cancelAll }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "org-1" } } }),
}));

vi.mock("@/services/synthetics", () => ({
  default: {
    artifactUrl: (_org: string, key: string) => `https://artifacts.example.com/${key}`,
  },
}));

// ── Stubs ──────────────────────────────────────────────────────────────────
const STUBS = {
  ODrawer: {
    props: ["open", "title", "subTitle", "size", "bleed"],
    template: '<div v-if="open" class="odrawer-stub"><slot name="header-right" /><slot /></div>',
  },
  OBadge: {
    props: ["variant", "size"],
    template: '<span class="obadge-stub"><slot /></span>',
  },
  OIcon: {
    props: ["name", "size"],
    template: '<i :data-icon="name" />',
  },
  OButton: {
    props: ["variant", "size"],
    emits: ["click"],
    template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
  },
};

// ── Fixtures ──────────────────────────────────────────────────────────────
const EXEC = "exec-1";

function rawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts: 1_700_000_000_000_000,
    status: "passed",
    duration: 1240,
    location: "us-east-1",
    device: "desktop",
    engine: "chromium",
    error: "",
    job_id: "job-1",
    execution_id: EXEC,
    trace_key: null,
    recorded_steps: JSON.stringify([
      { id: "s1", name: "Sign in", action: "click" },
      { id: "s2", name: "Open cart", action: "click" },
    ]),
    last_attempt_steps: JSON.stringify([
      { step_id: "s1", status: "ok", duration_ms: 300, error: "" },
      { step_id: "s2", status: "ok", duration_ms: 800, error: "" },
    ]),
    ...overrides,
  };
}

const startLoad = (overrides: Record<string, unknown> = {}) => ({
  step_id: "_start",
  status: "ok",
  duration_ms: 420,
  error: "",
  url: "https://app.test/",
  ...overrides,
});

async function mountOpenWith(rows: Record<string, unknown>[]) {
  executeQuery.mockResolvedValue(rows);
  const w = mount(RunDetailDrawer, {
    props: { runId: "run-1", monitorId: "mon-1", scheduledTs: 1_700_000_000_000_000, open: false },
    global: { plugins: [i18n], stubs: STUBS },
  }) as VueWrapper;
  // The watcher is not immediate: the fetch runs on the open transition.
  await w.setProps({ open: true });
  await flushPromises();
  return w;
}

async function expandSteps(w: VueWrapper) {
  await w.find(`[data-test="synthetics-run-detail-toggle-steps-${EXEC}-btn"]`).trigger("click");
  await flushPromises();
}

describe("RunDetailDrawer", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    executeQuery.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders one card per location with its step count", async () => {
    wrapper = await mountOpenWith([rawRow()]);

    expect(wrapper.text()).toContain("us-east-1");
    expect(wrapper.text()).toContain("Steps (2)");
  });

  // `start_load` is a sibling of `last_attempt_steps`, so "Steps (N)" never includes it.
  describe("start load (row 0)", () => {
    function startRow(w: VueWrapper) {
      return w.find(`[data-test="synthetics-run-detail-start-row-${EXEC}"]`);
    }

    it("renders row 0 above Step 1 with the Open label and its duration", async () => {
      wrapper = await mountOpenWith([rawRow({ start_load: JSON.stringify(startLoad()) })]);
      await expandSteps(wrapper);

      const row0 = startRow(wrapper);
      expect(row0.exists(), "no start row rendered").toBe(true);
      expect(row0.text()).toContain("Open https://app.test/");
      expect(row0.text()).toContain("420 ms");
      const step1 = wrapper.findAll("span").find((el) => el.text() === "1")!;
      expect(step1).toBeTruthy();
      expect(
        !!(row0.element.compareDocumentPosition(step1.element) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
    });

    it("keeps the Steps count and numbering to the Steps", async () => {
      wrapper = await mountOpenWith([rawRow({ start_load: JSON.stringify(startLoad()) })]);
      await expandSteps(wrapper);

      expect(wrapper.text()).toContain("Steps (2)");
      expect(startRow(wrapper).exists(), "no start row rendered").toBe(true);
      expect(startRow(wrapper).text()).not.toMatch(/(^|\s)0(\s|$)/);
      const numbers = wrapper.findAll("span").filter((el) => /^\d+$/.test(el.text()));
      expect(numbers.map((el) => el.text())).toEqual(["1", "2"]);
    });

    it("shows the start load's error on row 0 and does not count it as a failed Step", async () => {
      wrapper = await mountOpenWith([
        rawRow({
          status: "failed",
          start_load: JSON.stringify(
            startLoad({ status: "failed", error: "net::ERR_NAME_NOT_RESOLVED" }),
          ),
        }),
      ]);
      // A failed location auto-expands its steps.

      const row0 = startRow(wrapper);
      expect(row0.exists(), "no start row rendered").toBe(true);
      expect(row0.text()).toContain("net::ERR_NAME_NOT_RESOLVED");
      expect(wrapper.text()).toContain("Steps (2)");
      expect(wrapper.text()).not.toContain("1 failed");
    });

    // One start load per attempt per combo: each execution card carries its own row 0.
    it("renders one row 0 per execution combo", async () => {
      wrapper = await mountOpenWith([
        rawRow({ start_load: JSON.stringify(startLoad()) }),
        rawRow({
          execution_id: "exec-2",
          device: "mobile",
          start_load: JSON.stringify(startLoad({ duration_ms: 910 })),
        }),
      ]);
      await expandSteps(wrapper);
      await wrapper
        .find('[data-test="synthetics-run-detail-toggle-steps-exec-2-btn"]')
        .trigger("click");
      await flushPromises();

      expect(startRow(wrapper).exists(), "no start row rendered").toBe(true);
      const second = wrapper.find('[data-test="synthetics-run-detail-start-row-exec-2"]');
      expect(second.exists()).toBe(true);
      expect(second.text()).toContain("910 ms");
    });

    // The probe stops at the failure, so a failed start load leaves no Step results at all.
    it("renders row 0 alone when the start load failed before any Step ran", async () => {
      wrapper = await mountOpenWith([
        rawRow({
          status: "failed",
          last_attempt_steps: "[]",
          start_load: JSON.stringify(
            startLoad({ status: "failed", error: "net::ERR_NAME_NOT_RESOLVED" }),
          ),
        }),
      ]);

      const row0 = startRow(wrapper);
      expect(row0.exists(), "no start row rendered").toBe(true);
      expect(row0.text()).toContain("Open https://app.test/");
      expect(row0.text()).toContain("net::ERR_NAME_NOT_RESOLVED");
      expect(wrapper.text()).toContain("Steps (0)");
      expect(wrapper.text()).not.toContain("1 failed");
      expect(wrapper.findAll("span").filter((el) => /^\d+$/.test(el.text()))).toHaveLength(0);
    });

    it("renders a location with no start load exactly as before", async () => {
      wrapper = await mountOpenWith([rawRow()]);
      await expandSteps(wrapper);

      expect(startRow(wrapper).exists()).toBe(false);
      expect(wrapper.text()).toContain("Steps (2)");
      expect(wrapper.text()).toContain("s1");
      expect(wrapper.text()).toContain("s2");
    });
  });
});
