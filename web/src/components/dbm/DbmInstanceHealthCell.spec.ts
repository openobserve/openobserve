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
import { describe, expect, it } from "vitest";

import i18n from "@/locales";
import { absentMetrics, type DbmRowMetrics } from "@/utils/dbm/instanceMetrics";

import DbmInstanceHealthCell from "./DbmInstanceHealthCell.vue";

type CellMetrics = DbmRowMetrics & { engine?: string };

const metrics = (over: Partial<CellMetrics> = {}): CellMetrics => ({
  state: "matched",
  saturation: { state: "measured", used: 20, limit: 100, ratio: 0.2 },
  cacheHitRatio: 0.9,
  replicationLag: { value: 4096, unit: "bytes" },
  deadlocks: 0,
  connectionSeries: [18, 20],
  connectionPoints: [
    { timestamp: 1, value: 18 },
    { timestamp: 2, value: 20 },
  ],
  unmatchedReason: null,
  ...over,
});

const mountWith = (value: CellMetrics) =>
  mount(DbmInstanceHealthCell, {
    props: { metrics: value, engine: value.engine ?? "postgresql" },
    global: { plugins: [i18n] },
  });

describe("DbmInstanceHealthCell", () => {
  // The single most-cited complaint about the original design was a raw
  // connection count. The percentage is the answer to "am I at the limit".
  it("renders saturation as a percentage of the limit, not as a count", () => {
    const wrapper = mountWith(metrics());
    expect(wrapper.text()).toContain("20%");
  });

  it("still shows the count behind the percentage, so the figure is checkable", () => {
    const wrapper = mountWith(metrics());
    expect(wrapper.text()).toContain("20");
    expect(wrapper.text()).toContain("100");
  });

  // Every MySQL instance is permanently in this state, because mysqlreceiver
  // publishes no max_connections. It must read as "no limit published", never
  // as a percentage of an invented denominator.
  it("renders a count with no published limit without inventing a percentage", () => {
    const wrapper = mountWith(
      metrics({
        saturation: { state: "no-limit", used: 20, limit: null, ratio: null },
        // The other metrics off, so the only figure under test is saturation —
        // a cache-hit chip legitimately carries a percent sign of its own.
        cacheHitRatio: null,
        replicationLag: null,
      }),
    );
    expect(wrapper.text()).toContain("20");
    expect(wrapper.text()).not.toContain("%");
  });

  it("renders an em dash when there is no connection reading at all", () => {
    const wrapper = mountWith(
      metrics({ saturation: { state: "absent", used: null, limit: null, ratio: null } }),
    );
    expect(wrapper.text()).toContain("—");
  });

  // A matched instance can still publish no connections metric — the user
  // never enabled it, the receiver restarted mid-window, retention ate it.
  // That reaches the em-dash branch on the HAPPY join path, and a bare dash
  // there is the same forbidden silence as an unexplained unmatched row.
  it("explains an empty cell on an instance the receiver does know", () => {
    const wrapper = mountWith(
      metrics({
        state: "matched",
        saturation: { state: "absent", used: null, limit: null, ratio: null },
      }),
    );
    expect(wrapper.text()).toContain("—");
    expect(wrapper.find("[data-test='dbm-instance-health-reason']").exists()).toBe(true);
  });

  // The receiver DOES publish a Postgres limit. Telling a Postgres user their
  // engine has none, because one stream read failed, sends them to fix
  // nothing.
  it("does not blame the engine for a missing limit when Postgres publishes one", () => {
    const wrapper = mount(DbmInstanceHealthCell, {
      props: {
        metrics: metrics({ saturation: { state: "no-limit", used: 20, limit: null, ratio: null } }),
        engine: "postgresql",
      },
      global: { plugins: [i18n] },
    });
    const hint = wrapper.findComponent({ name: "OTooltip" }).props("content") as string;
    expect(hint).not.toContain("does not publish");
    // ...and still says SOMETHING, because a bare count with no explanation is
    // the silence this column exists to avoid.
    expect(hint).toContain("no percentage");
  });

  it("does say the engine publishes no limit when that is true of MySQL", () => {
    const wrapper = mount(DbmInstanceHealthCell, {
      props: {
        metrics: metrics({ saturation: { state: "no-limit", used: 20, limit: null, ratio: null } }),
        engine: "mysql",
      },
      global: { plugins: [i18n] },
    });
    const hint = wrapper.findComponent({ name: "OTooltip" }).props("content") as string;
    expect(hint).toContain("does not publish");
  });

  // Four metric streams are read for these. Computing them and rendering
  // nothing is a round trip per stream spent on nothing.
  it("shows the cache hit ratio the read paid for", () => {
    expect(mountWith(metrics({ cacheHitRatio: 0.9 })).text()).toContain("90");
  });

  it("shows replication lag in BYTES for Postgres", () => {
    const wrapper = mountWith(
      metrics({ engine: "postgresql", replicationLag: { value: 4096, unit: "bytes" } }),
    );
    expect(wrapper.find("[data-test='dbm-instance-health-lag']").text()).toMatch(/KB|B\b/);
  });

  // Same role, other unit. Printing "4 KB behind" for a replica 4096 seconds
  // behind is the failure the unit tag exists to prevent.
  it("shows replication lag in SECONDS for MySQL", () => {
    const wrapper = mountWith(
      metrics({ engine: "mysql", replicationLag: { value: 4096, unit: "seconds" } }),
    );
    const text = wrapper.find("[data-test='dbm-instance-health-lag']").text();
    expect(text).not.toMatch(/KB|MB/);
  });

  it("shows a deadlock count when the window saw any", () => {
    expect(mountWith(metrics({ deadlocks: 3 })).text()).toContain("3");
  });

  // Zero deadlocks is the ordinary state of every healthy database; a chip on
  // every row would be noise, and the calm-signal rule is to show exceptions.
  it("shows no deadlock chip when the window saw none", () => {
    const wrapper = mountWith(metrics({ deadlocks: 0 }));
    expect(wrapper.find("[data-test='dbm-instance-health-deadlocks']").exists()).toBe(false);
  });

  it("shows no deadlock chip when the counter could not be determined", () => {
    const wrapper = mountWith(metrics({ deadlocks: null }));
    expect(wrapper.find("[data-test='dbm-instance-health-deadlocks']").exists()).toBe(false);
  });

  // "Silently empty is forbidden": an unmatched row must SAY why, or the
  // reader concludes the feature is broken rather than unjoined.
  it("names pooler indirection on an unmatched row", () => {
    const wrapper = mountWith(absentMetrics("unmatched", "pooler"));
    expect(wrapper.text()).toContain("—");
    expect(wrapper.attributes("data-test-unmatched")).toBe("pooler");
    expect(wrapper.html()).toContain("pooler");
  });

  it("names the loopback substitution rather than blaming a pooler", () => {
    const wrapper = mountWith(absentMetrics("unmatched", "loopback"));
    expect(wrapper.attributes("data-test-unmatched")).toBe("loopback");
  });

  it("names an unreadable stream rather than a missing receiver", () => {
    const wrapper = mountWith(absentMetrics("unmatched", "unreadable"));
    expect(wrapper.attributes("data-test-unmatched")).toBe("unreadable");
  });

  it("names a missing receiver", () => {
    const wrapper = mountWith(absentMetrics("unmatched", "no-receiver"));
    expect(wrapper.attributes("data-test-unmatched")).toBe("no-receiver");
  });

  // The knob is off or the read never happened: that is not a claim about the
  // instance, so the cell must not accuse anything.
  it("renders nothing accusatory when no metrics were read at all", () => {
    const wrapper = mountWith(absentMetrics("no-data", null));
    expect(wrapper.attributes("data-test-unmatched")).toBeUndefined();
  });

  // The 3am workflow: overlay the connection trend against a latency spike. A
  // number alone cannot do that, which is why the strip is a requirement and
  // not a decoration.
  it("draws the connection trend when there is a series to draw", () => {
    const wrapper = mountWith(metrics());
    expect(wrapper.find("[data-test='dbm-instance-health-trend-sparkline']").exists()).toBe(true);
  });

  it("draws no trend when only one reading exists — two points make a trend", () => {
    const wrapper = mountWith(
      metrics({ connectionSeries: [20], connectionPoints: [{ timestamp: 1, value: 20 }] }),
    );
    expect(wrapper.find("[data-test='dbm-instance-health-trend-sparkline']").exists()).toBe(false);
  });

  it("warns once saturation is high, so a row near its limit stands out", () => {
    const wrapper = mountWith(
      metrics({ saturation: { state: "measured", used: 95, limit: 100, ratio: 0.95 } }),
    );
    expect(wrapper.attributes("data-test-tone")).toBe("danger");
  });

  it("stays calm at ordinary saturation", () => {
    expect(mountWith(metrics()).attributes("data-test-tone")).toBe("default");
  });

  // Over the limit is not the same as near it, and it must never round down
  // into a calm tone.
  it("stays in the danger tone above the limit", () => {
    const wrapper = mountWith(
      metrics({ saturation: { state: "measured", used: 120, limit: 100, ratio: 1.2 } }),
    );
    expect(wrapper.attributes("data-test-tone")).toBe("danger");
  });
});
