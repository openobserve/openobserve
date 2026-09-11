// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";

import { DBM_INSTANCE_METRICS } from "@/utils/dbm/instanceMetrics";
import { DBM_METRIC_SECTIONS } from "@/utils/dbm/metricSections";
import {
  DBM_MODULE_RESOURCE,
  DBM_VIEWER_STREAM_ROW_PERMS,
  DBM_VIEWER_STREAMS,
  DBM_VIEWER_TYPE_NODE_PERMS,
} from "./dbmViewerPreset";

// Mirrors RE_OFGA_UNSUPPORTED_NAME in src/config/src/utils/str.rs:45-46.
const OFGA_UNSUPPORTED = /[:#?\s'"%&]/;

// Every raw metric stream the Metrics tab's themed catalog can chart.
const sectionCatalogStreams = (): string[] =>
  DBM_METRIC_SECTIONS.flatMap((section) =>
    section.panels
      .filter((panel) => panel.source === "promql" && panel.metric)
      .map((panel) => panel.metric as string),
  );

// Every raw metric stream the instance-metrics rail (Databases page) can read.
const instanceMetricsStreams = (): string[] => DBM_INSTANCE_METRICS.map((spec) => spec.stream);

describe("DBM_VIEWER_STREAMS", () => {
  it("is sorted and free of duplicates", () => {
    expect(DBM_VIEWER_STREAMS).toEqual([...new Set(DBM_VIEWER_STREAMS)]);
    expect(DBM_VIEWER_STREAMS).toEqual([...DBM_VIEWER_STREAMS].sort());
  });

  it("carries only OFGA-safe names", () => {
    // The frontend has no into_ofga_supported_format, so a name needing it cannot be granted at all.
    for (const name of DBM_VIEWER_STREAMS) {
      expect(OFGA_UNSUPPORTED.test(name), name).toBe(false);
    }
  });
});

describe("preset permission sets", () => {
  it("grants a curated stream row read access only", () => {
    expect(DBM_VIEWER_STREAM_ROW_PERMS).toEqual(["AllowGet"]);
  });

  // ALLOW_GET on `metrics:_all_<org>` reads as a wildcard over every metric stream in the org, which would make the per-stream grants decorative.
  it("grants the metrics type node LIST and never GET", () => {
    expect(DBM_VIEWER_TYPE_NODE_PERMS).toEqual(["AllowList"]);
    expect(DBM_VIEWER_TYPE_NODE_PERMS).not.toContain("AllowGet");
  });
});

describe("DBM_MODULE_RESOURCE", () => {
  it("names the db_monitoring OFGA type key", () => {
    expect(DBM_MODULE_RESOURCE).toBe("db_monitoring");
  });
});

describe("drift guard against the Metrics tab catalogs", () => {
  const preset = new Set(DBM_VIEWER_STREAMS);

  it("every promql metric in DBM_METRIC_SECTIONS is granted by the preset", () => {
    const required = [...new Set(sectionCatalogStreams())].sort();
    expect(required.length).toBeGreaterThan(0);
    const missing = required.filter((name) => !preset.has(name));
    expect(
      missing,
      `DBM_METRIC_SECTIONS charts streams the DB Monitoring viewer preset does not grant: ` +
        `${missing.join(", ")} — add them to DBM_VIEWER_STREAMS in dbmViewerPreset.ts ` +
        `(sorted), or the role silently cannot read those panels`,
    ).toEqual([]);
  });

  it("every stream in DBM_INSTANCE_METRICS is granted by the preset", () => {
    const required = [...new Set(instanceMetricsStreams())].sort();
    expect(required.length).toBeGreaterThan(0);
    const missing = required.filter((name) => !preset.has(name));
    expect(
      missing,
      `DBM_INSTANCE_METRICS reads streams the DB Monitoring viewer preset does not grant: ` +
        `${missing.join(", ")} — add them to DBM_VIEWER_STREAMS in dbmViewerPreset.ts ` +
        `(sorted), or the role silently cannot read those health columns`,
    ).toEqual([]);
  });

  it("grants nothing neither catalog requires", () => {
    // A name left behind after a panel is dropped grants a stream nothing on the tab reads.
    const required = new Set([...sectionCatalogStreams(), ...instanceMetricsStreams()]);
    const extra = DBM_VIEWER_STREAMS.filter((name) => !required.has(name));
    expect(
      extra,
      `DBM_VIEWER_STREAMS grants streams neither DBM catalog requires: ${extra.join(", ")} — ` +
        `remove them, or point the preset at the catalog that needs them`,
    ).toEqual([]);
  });
});
