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

import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

const mocks = vi.hoisted(() => ({
  labels: vi.fn(),
  labelValues: vi.fn(),
}));

vi.mock("@/services/metrics", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>("@/services/metrics");
  return {
    ...actual,
    default: { ...actual.default, labels: mocks.labels, labelValues: mocks.labelValues },
  };
});

import { clearLabelChecks, useLibraryLabelCheck } from "./useLibraryLabelCheck";

const entry = (id = "hadoop/namenode-down"): AlertLibraryEntry => ({
  id,
  name: "namenode-down",
  pack: "hadoop",
  category: "namenode",
  title: "Hadoop name node down",
  severity: "critical",
  description: "",
  stream: "up",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["up"],
  path: `packs/${id}.json`,
  content_hash: "h1",
});

const file = (promql = 'up{job="hadoop-namenode"} == 0'): AlertLibraryFile => ({
  query_condition: { type: "promql", promql },
});

const ok = (data: string[]) => Promise.resolve({ data: { status: "success", data } });

const mountHost = () => {
  let api!: ReturnType<typeof useLibraryLabelCheck>;
  const Host = defineComponent({
    setup() {
      api = useLibraryLabelCheck();
      return () => null;
    },
  });
  mount(Host, { global: { plugins: [i18n, store] } });
  return api;
};

beforeEach(() => {
  clearLabelChecks();
  mocks.labels.mockImplementation(() => ok(["__name__", "job", "instance"]));
  mocks.labelValues.mockImplementation(() => ok(["otel-collector", "node"]));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLibraryLabelCheck", () => {
  it("asks /labels and /label/{name}/values with match[] set to the selector's metric", async () => {
    await mountHost().check(entry(), file());
    const labelsCall = mocks.labels.mock.calls[0][0];
    expect(labelsCall.match).toBe("up");
    expect(labelsCall.end_time - labelsCall.start_time).toBe(24 * 3600 * 1_000_000);
    expect(mocks.labelValues.mock.calls[0][0]).toMatchObject({ label: "job", match: "up" });
  });

  it("reports a value the metric never carries as needed data", async () => {
    const api = mountHost();
    const verdict = await api.check(entry(), file());
    expect(verdict).toEqual({
      state: "missing",
      missing: [{ metric: "up", label: "job", value: "hadoop-namenode" }],
    });
    expect(api.needsData(entry())).toBe("job hadoop-namenode");
  });

  it("reports a label the metric lacks without asking for its values", async () => {
    mocks.labels.mockImplementation(() => ok(["__name__", "instance"]));
    const verdict = await mountHost().check(entry(), file());
    expect(verdict.state).toBe("missing");
    expect(mocks.labelValues).not.toHaveBeenCalled();
  });

  it("passes a rule whose label value arrives", async () => {
    mocks.labelValues.mockImplementation(() => ok(["hadoop-namenode"]));
    const api = mountHost();
    expect(await api.check(entry(), file())).toEqual({ state: "ok" });
    expect(api.needsData(entry())).toBe("");
  });

  it("passes a rule with no label matchers without a request", async () => {
    expect(await mountHost().check(entry(), file("up == 0"))).toEqual({ state: "ok" });
    expect(mocks.labels).not.toHaveBeenCalled();
  });

  it("does not check a SQL rule", async () => {
    const sql = { ...entry(), query_type: "sql" as const };
    const verdict = await mountHost().check(sql, { query_condition: { type: "sql", sql: "x" } });
    expect(verdict).toEqual({ state: "ok" });
    expect(mocks.labels).not.toHaveBeenCalled();
  });

  it("caches a verdict for the session, across composable instances", async () => {
    await mountHost().check(entry(), file());
    const again = mountHost();
    expect(again.needsData(entry())).toBe("job hadoop-namenode");
    await again.check(entry(), file());
    expect(mocks.labels).toHaveBeenCalledTimes(1);
  });

  it("asks once per metric when several rules share it", async () => {
    const api = mountHost();
    await Promise.all([
      api.check(entry("hadoop/a"), file()),
      api.check(entry("hadoop/b"), file('up{job="hadoop-datanode"} == 0')),
    ]);
    expect(mocks.labels).toHaveBeenCalledTimes(1);
    expect(mocks.labelValues).toHaveBeenCalledTimes(1);
  });

  it("claims nothing when the check fails, and checks again next time", async () => {
    mocks.labels.mockRejectedValueOnce(new Error("down"));
    const api = mountHost();
    expect(await api.check(entry(), file())).toEqual({ state: "unknown" });
    expect(api.needsData(entry())).toBe("");
    await api.check(entry(), file());
    expect(mocks.labels).toHaveBeenCalledTimes(2);
  });
});
