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

import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import commonService from "@/services/common";
import dashboardService from "@/services/dashboards";
import { toSearchHit } from "@/services/dashboards.queries";
import jsTransformService from "@/services/jstransform";
import pipelineService from "@/services/pipelines";
import sampleDataService from "@/services/sample_data";
import streamService from "@/services/stream";
import {
  SAMPLE_ALERT_DESTINATION,
  SAMPLE_ALERT_TEMPLATE,
  SAMPLE_DASHBOARD_TITLES,
  SAMPLE_ENRICHMENT_TABLE,
  SAMPLE_FOLDER_NAME,
  SAMPLE_FUNCTIONS,
  SAMPLE_METRICS,
  SAMPLE_OVERVIEW_TITLE,
  SAMPLE_PIPELINE,
  SAMPLE_STREAMS,
} from "./catalog";
import {
  sampleAccessLogPipeline,
  sampleAlertDestination,
  sampleAlertTemplate,
  sampleAlerts,
  sampleDashboards,
  type SampleWindow,
  sampleFunctions,
  sampleServiceOwnersCsv,
} from "./assets";
import { createSampleGenerator } from "./generator";

export type SampleStepId =
  "functions" | "pipeline" | "telemetry" | "dashboards" | "alerts" | "enrichment";

// the pipeline must exist before the first access log arrives, so it can rewrite every record
export const SAMPLE_STEPS: readonly SampleStepId[] = [
  "functions",
  "pipeline",
  "telemetry",
  "dashboards",
  "alerts",
  "enrichment",
];

export interface SampleCounts {
  logs: number;
  spans: number;
  metrics: number;
}

export interface SampleLogLine {
  /** Microseconds. */
  ts: number;
  level: string;
  text: string;
}

export interface SampleProgress {
  step: SampleStepId;
  /** 0..1 within the telemetry step; the asset steps report 0 then 1. */
  fraction: number;
  counts: SampleCounts;
  /** A few of the app log rows the last telemetry batch really sent. */
  logs?: SampleLogLine[];
}

const FEED_LINES = 12;
const feedOf = (rows: Record<string, string | number | boolean>[]): SampleLogLine[] => {
  const step = Math.max(1, Math.floor(rows.length / FEED_LINES));
  return rows
    .filter((_, i) => i % step === 0)
    .slice(0, FEED_LINES)
    .map((r) => ({
      ts: Number(r._timestamp),
      level: String(r.level ?? "info"),
      text: `${r.service_name}: ${r.message}`,
    }))
    .sort((a, b) => a.ts - b.ts);
};

export interface SampleLoadResult {
  counts: SampleCounts;
  hours: number;
  dashboardFolderId?: string;
  overviewDashboardId?: string;
  failedSteps: SampleStepId[];
}

const HOUR_US = 3_600_000_000;
// covers the generator rounding its start down a minute, plus browser-to-server clock skew
const WINDOW_MARGIN_HOURS = 10 / 60;

/** Stays inside the server's back-fill window so no record is rejected as too old. */
export const sampleWindowHours = (ingestAllowedUptoHours: number | undefined) => {
  const limit = Number(ingestAllowedUptoHours) || 5;
  return Math.min(4, limit - WINDOW_MARGIN_HOURS);
};

const findOrCreateFolder = async (org: string, type: "dashboards" | "alerts") => {
  const res = await commonService.list_Folders(org, type);
  const existing = (res.data?.list ?? []).find((f: any) => f.name === SAMPLE_FOLDER_NAME);
  if (existing) return String(existing.folderId);
  const created = await commonService.new_Folder(org, type, {
    name: SAMPLE_FOLDER_NAME,
    description: "Created by Explore with sample data",
  });
  return String(created.data?.folderId);
};

const findFolder = async (org: string, type: "dashboards" | "alerts") => {
  const res = await commonService.list_Folders(org, type);
  const folder = (res.data?.list ?? []).find((f: any) => f.name === SAMPLE_FOLDER_NAME);
  return folder ? String(folder.folderId) : undefined;
};

interface IngestOutcome {
  accepted: number;
  error?: string;
}

// the /_json routes answer 200 even when they drop records; the per-stream status says how many were kept
const jsonOutcome = (res: any, sent: number): IngestOutcome => {
  const status: { successful?: number; error?: string }[] | undefined = res?.data?.status;
  if (!Array.isArray(status)) return { accepted: sent };
  return {
    accepted: status.reduce((n, s) => n + (Number(s.successful) || 0), 0),
    error: status.find((s) => s.error)?.error ?? res.data.error,
  };
};

// OTLP JSON reports drops as partialSuccess, with the int64 count as a string
const tracesOutcome = (res: any, sent: number): IngestOutcome => {
  const partial = res?.data?.partialSuccess;
  return {
    accepted: Math.max(0, sent - (Number(partial?.rejectedSpans) || 0)),
    error: partial?.errorMessage,
  };
};

const ingestTelemetry = async (
  org: string,
  hours: number,
  report: (fraction: number, counts: SampleCounts, logs: SampleLogLine[]) => void,
) => {
  const endUs = Date.now() * 1000;
  const range: SampleWindow = { startUs: endUs - hours * HOUR_US, endUs };
  const gen = createSampleGenerator(range);
  const counts: SampleCounts = { logs: 0, spans: 0, metrics: 0 };
  let error: string | undefined;
  for (let i = 0; i < gen.chunkCount; i++) {
    const batch = gen.generateChunk(i);
    const outcomes: IngestOutcome[] = await Promise.all([
      sampleDataService
        .ingestLogs(org, SAMPLE_STREAMS.appLogs, batch.appLogs)
        .then((res) => jsonOutcome(res, batch.appLogs.length)),
      sampleDataService
        .ingestLogs(org, SAMPLE_STREAMS.accessLogs, batch.accessLogs)
        .then((res) => jsonOutcome(res, batch.accessLogs.length)),
      sampleDataService
        .ingestMetrics(org, batch.metrics)
        .then((res) => jsonOutcome(res, batch.metrics.length)),
      batch.spanCount
        ? sampleDataService
            .ingestTraces(org, SAMPLE_STREAMS.traces, batch.traces)
            .then((res) => tracesOutcome(res, batch.spanCount))
        : { accepted: 0 },
    ]);
    const [app, access, metrics, traces] = outcomes;
    counts.logs += app.accepted + access.accepted;
    counts.spans += traces.accepted;
    counts.metrics += metrics.accepted;
    error ??= outcomes.find((o) => o.error)?.error;
    report((i + 1) / gen.chunkCount, { ...counts }, feedOf(batch.appLogs));
  }
  if (!counts.logs && !counts.spans && !counts.metrics) {
    throw new Error(error || "The server did not accept any sample records");
  }
  return { counts, window: range };
};

const createDashboards = async (org: string, range: SampleWindow) => {
  const folderId = await findOrCreateFolder(org, "dashboards");
  const existing = await dashboardService.list(0, 1000, "name", false, "", org, folderId, "");
  const titles = new Set(
    (existing.data?.dashboards ?? []).map((row: any) => toSearchHit(row).title),
  );
  let overviewId: string | undefined = (existing.data?.dashboards ?? [])
    .map(toSearchHit)
    .find((hit: { title: string }) => hit.title === SAMPLE_OVERVIEW_TITLE)?.dashboardId;
  for (const dash of sampleDashboards(range)) {
    if (titles.has(dash.title)) continue;
    const res = await dashboardService.create(org, dash, folderId);
    if (dash.title === SAMPLE_OVERVIEW_TITLE) overviewId = toSearchHit(res.data).dashboardId;
  }
  return { folderId, overviewId };
};

const createIfMissing = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e: any) {
    // re-running the loader finds the assets from the previous run
    if (e?.response?.status !== 409 && e?.response?.status !== 400) throw e;
  }
};

const createAlerts = async (org: string) => {
  await createIfMissing(() =>
    templateService.create({ org_identifier: org, data: sampleAlertTemplate() }),
  );
  await createIfMissing(() =>
    destinationService.create({ org_identifier: org, data: sampleAlertDestination() }),
  );
  const folderId = await findOrCreateFolder(org, "alerts");
  const existing = await alertsService.listByFolderId(1, 1000, "name", false, "", org, folderId);
  const names = new Set((existing.data?.list ?? []).map((a: any) => a.name));
  for (const alert of sampleAlerts(folderId)) {
    if (!names.has(alert.name)) await alertsService.create_by_alert_id(org, alert, folderId);
  }
};

const createFunctions = async (org: string) => {
  for (const fn of sampleFunctions()) {
    await createIfMissing(() => jsTransformService.create(org, fn));
  }
};

const findPipelineId = async (org: string): Promise<string | undefined> => {
  const res = await pipelineService.getPipelines(org);
  const hit = (res.data?.list ?? []).find((p: any) => p.name === SAMPLE_PIPELINE);
  return hit?.pipeline_id;
};

const createPipeline = async (org: string) => {
  if (await findPipelineId(org)) return;
  await pipelineService.createPipeline({
    org_identifier: org,
    data: sampleAccessLogPipeline(org),
  });
};

const createEnrichmentTable = async (org: string) => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([sampleServiceOwnersCsv()], { type: "text/csv" }),
    `${SAMPLE_ENRICHMENT_TABLE}.csv`,
  );
  await jsTransformService.create_enrichment_table(org, SAMPLE_ENRICHMENT_TABLE, form, false);
};

export const loadSampleData = async (
  org: string,
  ingestAllowedUptoHours: number | undefined,
  onProgress: (p: SampleProgress) => void,
): Promise<SampleLoadResult> => {
  const hours = sampleWindowHours(ingestAllowedUptoHours);
  const failedSteps: SampleStepId[] = [];
  let counts: SampleCounts = { logs: 0, spans: 0, metrics: 0 };
  const result: SampleLoadResult = { counts, hours, failedSteps };
  const run = async (step: SampleStepId, fn: () => Promise<void>) => {
    onProgress({ step, fraction: 0, counts });
    try {
      await fn();
    } catch (e) {
      console.warn(`Sample data step "${step}" failed`, e);
      failedSteps.push(step);
    }
    onProgress({ step, fraction: 1, counts });
  };
  await run("functions", () => createFunctions(org));
  await run("pipeline", () => createPipeline(org));

  onProgress({ step: "telemetry", fraction: 0, counts });
  const telemetry = await ingestTelemetry(org, hours, (fraction, c, logs) =>
    onProgress({ step: "telemetry", fraction, counts: c, logs }),
  );
  counts = telemetry.counts;
  result.counts = counts;
  try {
    await sampleDataService.putState(org, telemetry.window.startUs, telemetry.window.endUs);
  } catch (e) {
    // the data is already loaded; without the saved window the tour falls back to relative ranges
    console.warn("Sample data window was not saved", e);
  }

  await run("dashboards", async () => {
    const { folderId, overviewId } = await createDashboards(org, telemetry.window);
    result.dashboardFolderId = folderId;
    result.overviewDashboardId = overviewId;
  });
  await run("alerts", () => createAlerts(org));
  await run("enrichment", () => createEnrichmentTable(org));
  return result;
};

const ignoreMissing = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e: any) {
    if (e?.response?.status !== 404) throw e;
  }
};

const SAMPLE_DASHBOARD_TITLE_SET: ReadonlySet<string> = new Set(
  Object.values(SAMPLE_DASHBOARD_TITLES),
);
const SAMPLE_ALERT_NAMES: ReadonlySet<string> = new Set(sampleAlerts("").map((a) => a.name));

// the folder may predate the load or hold the user's own assets, so only sample names go
const removeDashboards = async (org: string) => {
  const folderId = await findFolder(org, "dashboards");
  if (!folderId) return;
  const res = await dashboardService.list(0, 1000, "name", false, "", org, folderId, "");
  const hits = (res.data?.dashboards ?? []).map(toSearchHit);
  const sample = hits.filter((hit: { title: string }) => SAMPLE_DASHBOARD_TITLE_SET.has(hit.title));
  for (const hit of sample) {
    await ignoreMissing(() => dashboardService.delete(org, hit.dashboardId, folderId));
  }
  if (sample.length === hits.length) {
    await ignoreMissing(() => commonService.delete_Folder(org, "dashboards", folderId));
  }
};

const removeAlerts = async (org: string) => {
  const folderId = await findFolder(org, "alerts");
  if (!folderId) return;
  const res = await alertsService.listByFolderId(1, 1000, "name", false, "", org, folderId);
  const alerts = res.data?.list ?? [];
  const sample = alerts.filter((alert: any) => SAMPLE_ALERT_NAMES.has(alert.name));
  for (const alert of sample) {
    await ignoreMissing(() =>
      alertsService.delete_by_alert_id(org, alert.alert_id ?? alert.id, folderId),
    );
  }
  if (sample.length === alerts.length) {
    await ignoreMissing(() => commonService.delete_Folder(org, "alerts", folderId));
  }
};

const removeAlertDelivery = async (org: string) => {
  await ignoreMissing(() =>
    destinationService.delete({ org_identifier: org, destination_name: SAMPLE_ALERT_DESTINATION }),
  );
  await ignoreMissing(() =>
    templateService.delete({ org_identifier: org, template_name: SAMPLE_ALERT_TEMPLATE }),
  );
};

const SAMPLE_STREAM_SET: { name: string; type: string }[] = [
  { name: SAMPLE_STREAMS.appLogs, type: "logs" },
  { name: SAMPLE_STREAMS.accessLogs, type: "logs" },
  { name: SAMPLE_STREAMS.traces, type: "traces" },
  { name: SAMPLE_ENRICHMENT_TABLE, type: "enrichment_tables" },
  ...Object.values(SAMPLE_METRICS).map((name) => ({ name, type: "metrics" })),
];

/** Deletes everything the loader creates; each asset is found by its sample name, so it works from any browser. */
export const removeSampleData = async (org: string) => {
  await removeAlerts(org);
  await removeAlertDelivery(org);
  await removeDashboards(org);
  const pipelineId = await findPipelineId(org);
  if (pipelineId) {
    await ignoreMissing(() =>
      pipelineService.deletePipeline({ pipeline_id: pipelineId, org_id: org }),
    );
  }
  for (const name of SAMPLE_FUNCTIONS) {
    await ignoreMissing(() => jsTransformService.delete(org, name, true));
  }
  await Promise.all(
    SAMPLE_STREAM_SET.map((s) =>
      ignoreMissing(() => streamService.delete(org, s.name, s.type, true)),
    ),
  );
  try {
    await sampleDataService.deleteState(org);
  } catch (e) {
    // everything else is already deleted; a stale state only points the tour at a window with no data
    console.warn("Sample data window was not deleted", e);
  }
};
