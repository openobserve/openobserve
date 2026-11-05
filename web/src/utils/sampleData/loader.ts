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
import { withSilentForbidden as quiet } from "@/services/http";
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
  /** Set on an asset step's end when that step failed. */
  failed?: boolean;
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
  const res = await quiet(() => commonService.list_Folders(org, type));
  const existing = (res.data?.list ?? []).find((f: any) => f.name === SAMPLE_FOLDER_NAME);
  if (existing) return String(existing.folderId);
  const created = await quiet(() =>
    commonService.new_Folder(org, type, {
      name: SAMPLE_FOLDER_NAME,
      description: "Created by Explore with sample data",
    }),
  );
  return String(created.data?.folderId);
};

const findFolder = async (org: string, type: "dashboards" | "alerts") => {
  const res = await quiet(() => commonService.list_Folders(org, type));
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
    error:
      status.find((s) => s.error)?.error ??
      res.data.error ??
      (res.data.stream_skipped ? STILL_REMOVING : undefined),
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

// in the order ingestTelemetry sends them; the alert and both log chapters query only app logs
const SIGNALS = ["app logs", "access logs", "metrics", "spans"] as const;

const RETRY_DELAYS_MS = [1000, 3000];
const STILL_REMOVING = "Sample data is still being removed. Try again in a few minutes.";
// the text core/ingestion/mod.rs returns while the compactor is still deleting the stream
const isStreamDeleting = (e: any) =>
  /is being deleted/.test(e?.response?.data?.message ?? e?.message ?? "");

// only a dropped connection or a server fault is worth sending again; a 4xx would fail the same way
const withRetry = async <T>(send: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (e: any) {
      if (isStreamDeleting(e)) throw new Error(STILL_REMOVING);
      const status = e?.response?.status;
      const transient = !e?.response || status >= 500;
      if (!transient || attempt >= RETRY_DELAYS_MS.length) throw e;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
};

const ingestTelemetry = async (
  org: string,
  hours: number,
  report: (fraction: number, counts: SampleCounts, logs: SampleLogLine[]) => void,
  stored: { any: boolean },
) => {
  const endUs = Date.now() * 1000;
  const range: SampleWindow = { startUs: endUs - hours * HOUR_US, endUs };
  const gen = createSampleGenerator(range);
  const counts: SampleCounts = { logs: 0, spans: 0, metrics: 0 };
  // an outcome that landed before a sibling request failed still counts as stored
  const keep = (o: IngestOutcome) => {
    if (o.accepted) stored.any = true;
    return o;
  };
  const signals = SIGNALS.map(() => ({
    sent: 0,
    accepted: 0,
    error: undefined as string | undefined,
  }));
  for (let i = 0; i < gen.chunkCount; i++) {
    const batch = gen.generateChunk(i);
    // settle all four so a rollback never races a sibling request still storing data
    const settled = await Promise.allSettled([
      withRetry(() =>
        sampleDataService.ingestLogs(org, SAMPLE_STREAMS.appLogs, batch.appLogs),
      ).then((res) => keep(jsonOutcome(res, batch.appLogs.length))),
      withRetry(() =>
        sampleDataService.ingestLogs(org, SAMPLE_STREAMS.accessLogs, batch.accessLogs),
      ).then((res) => keep(jsonOutcome(res, batch.accessLogs.length))),
      withRetry(() => sampleDataService.ingestMetrics(org, batch.metrics)).then((res) =>
        keep(jsonOutcome(res, batch.metrics.length)),
      ),
      batch.spanCount
        ? withRetry(() =>
            sampleDataService.ingestTraces(org, SAMPLE_STREAMS.traces, batch.traces),
          ).then((res) => keep(tracesOutcome(res, batch.spanCount)))
        : { accepted: 0 },
    ]);
    const failure = settled.find((r) => r.status === "rejected");
    if (failure) throw (failure as PromiseRejectedResult).reason;
    const outcomes = settled.map((r) => (r as PromiseFulfilledResult<IngestOutcome>).value);
    const [app, access, metrics, traces] = outcomes;
    counts.logs += app.accepted + access.accepted;
    counts.spans += traces.accepted;
    counts.metrics += metrics.accepted;
    const sent = [
      batch.appLogs.length,
      batch.accessLogs.length,
      batch.metrics.length,
      batch.spanCount,
    ];
    outcomes.forEach((o, k) => {
      signals[k].sent += sent[k];
      signals[k].accepted += o.accepted;
      signals[k].error ??= o.error;
    });
    report((i + 1) / gen.chunkCount, { ...counts }, feedOf(batch.appLogs));
  }
  // the tour has a chapter per signal, so one that kept nothing fails the load
  const empty = signals.findIndex((s) => s.sent && !s.accepted);
  if (empty >= 0) {
    throw new Error(
      signals[empty].error || `The server did not accept any sample ${SIGNALS[empty]}`,
    );
  }
  return { counts, window: range };
};

const createDashboards = async (org: string, range: SampleWindow) => {
  const folderId = await findOrCreateFolder(org, "dashboards");
  const existing = await quiet(() =>
    dashboardService.list(0, 1000, "name", false, "", org, folderId, ""),
  );
  const idByTitle = new Map<string, string>(
    (existing.data?.dashboards ?? [])
      .map(toSearchHit)
      .map((hit: { title: string; dashboardId: string }) => [hit.title, hit.dashboardId]),
  );
  for (const dash of sampleDashboards(range)) {
    // a reload moves the window, and a kept dashboard would still query the old one
    const oldId = idByTitle.get(dash.title);
    if (oldId) await ignoreMissing(() => dashboardService.delete(org, oldId, folderId));
    await quiet(() => dashboardService.create(org, dash, folderId));
  }
};

const createIfMissing = async (fn: () => Promise<unknown>) => {
  try {
    await quiet(fn);
    return true;
  } catch (e: any) {
    // re-running the loader finds the assets from the previous run
    if (e?.response?.status !== 409 && e?.response?.status !== 400) throw e;
    return false;
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
  const existing = await quiet(() =>
    alertsService.listByFolderId(1, 1000, "name", false, "", org, folderId),
  );
  const names = new Set((existing.data?.list ?? []).map((a: any) => a.name));
  for (const alert of sampleAlerts(folderId)) {
    if (!names.has(alert.name)) {
      await quiet(() => alertsService.create_by_alert_id(org, alert, folderId));
    }
  }
};

// what this run created, so a load that stores nothing can undo it without touching reused assets
interface Created {
  functions: string[];
  pipeline: boolean;
}

const createFunctions = async (org: string, created: Created) => {
  for (const fn of sampleFunctions()) {
    if (await createIfMissing(() => jsTransformService.create(org, fn))) {
      created.functions.push(fn.name);
    }
  }
};

const findPipelineId = async (org: string): Promise<string | undefined> => {
  const res = await quiet(() => pipelineService.getPipelines(org));
  const hit = (res.data?.list ?? []).find((p: any) => p.name === SAMPLE_PIPELINE);
  return hit?.pipeline_id;
};

const createPipeline = async (org: string, created: Created) => {
  if (await findPipelineId(org)) return;
  await quiet(() =>
    pipelineService.createPipeline({ org_identifier: org, data: sampleAccessLogPipeline(org) }),
  );
  created.pipeline = true;
};

// best effort: a failed rollback must not hide the error that stopped the load
const rollback = async (org: string, created: Created) => {
  try {
    const pipelineId = created.pipeline ? await findPipelineId(org) : undefined;
    if (pipelineId) {
      await ignoreMissing(() =>
        pipelineService.deletePipeline({ pipeline_id: pipelineId, org_id: org }),
      );
    }
  } catch (e) {
    console.warn("Sample pipeline was not rolled back", e);
  }
  for (const name of created.functions) {
    try {
      await ignoreMissing(() => jsTransformService.delete(org, name));
    } catch (e) {
      console.warn(`Sample function "${name}" was not rolled back`, e);
    }
  }
};

const createEnrichmentTable = async (org: string) => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([sampleServiceOwnersCsv()], { type: "text/csv" }),
    `${SAMPLE_ENRICHMENT_TABLE}.csv`,
  );
  await quiet(() =>
    jsTransformService.create_enrichment_table(org, SAMPLE_ENRICHMENT_TABLE, form, false),
  );
};

export const loadSampleData = async (
  org: string,
  ingestAllowedUptoHours: number | undefined,
  onProgress: (p: SampleProgress) => void,
): Promise<SampleLoadResult> => {
  const hours = sampleWindowHours(ingestAllowedUptoHours);
  const failedSteps: SampleStepId[] = [];
  let counts: SampleCounts = { logs: 0, spans: 0, metrics: 0 };
  const result: SampleLoadResult = { counts, failedSteps };
  const run = async (step: SampleStepId, fn: () => Promise<void>) => {
    onProgress({ step, fraction: 0, counts });
    let failed = false;
    try {
      await fn();
    } catch (e: any) {
      // without write access every later step is refused too
      if (e?.response?.status === 403) throw e;
      console.warn(`Sample data step "${step}" failed`, e);
      failedSteps.push(step);
      failed = true;
    }
    onProgress({ step, fraction: 1, counts, failed });
  };
  const created: Created = { functions: [], pipeline: false };
  await run("functions", () => createFunctions(org, created));
  await run("pipeline", () => createPipeline(org, created));

  onProgress({ step: "telemetry", fraction: 0, counts });
  const stored = { any: false };
  let telemetry: Awaited<ReturnType<typeof ingestTelemetry>>;
  try {
    telemetry = await ingestTelemetry(
      org,
      hours,
      (fraction, c, logs) => onProgress({ step: "telemetry", fraction, counts: c, logs }),
      stored,
    );
  } catch (e) {
    // the UI offers Delete only when a sample stream exists, so nothing else could clean these up
    if (!stored.any) await rollback(org, created);
    throw e;
  }
  counts = telemetry.counts;
  result.counts = counts;
  try {
    await quiet(() =>
      sampleDataService.putState(org, telemetry.window.startUs, telemetry.window.endUs),
    );
  } catch (e) {
    // the data is already loaded; without the saved window the tour falls back to relative ranges
    console.warn("Sample data window was not saved", e);
  }

  await run("dashboards", () => createDashboards(org, telemetry.window));
  await run("alerts", () => createAlerts(org));
  await run("enrichment", () => createEnrichmentTable(org));
  return result;
};

const ignoreMissing = async (fn: () => Promise<unknown>) => {
  try {
    await quiet(fn);
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
  const res = await quiet(() =>
    dashboardService.list(0, 1000, "name", false, "", org, folderId, ""),
  );
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
  const res = await quiet(() =>
    alertsService.listByFolderId(1, 1000, "name", false, "", org, folderId),
  );
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

// a user alert or destination that uses it blocks the delete (409); the rest must still go
const deleteUnlessInUse = async (name: string, kept: string[], fn: () => Promise<unknown>) => {
  try {
    await ignoreMissing(fn);
  } catch (e: any) {
    if (e?.response?.status !== 409) throw e;
    console.warn(`Sample asset "${name}" was kept`, e);
    kept.push(name);
  }
};

const removeAlertDelivery = async (org: string, kept: string[]) => {
  await deleteUnlessInUse(SAMPLE_ALERT_DESTINATION, kept, () =>
    destinationService.delete({ org_identifier: org, destination_name: SAMPLE_ALERT_DESTINATION }),
  );
  await deleteUnlessInUse(SAMPLE_ALERT_TEMPLATE, kept, () =>
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

/**
 * Deletes everything the loader creates; each asset is found by its sample name, so it works from any browser.
 * Resolves to the sample assets it kept because something of the user's still uses them.
 */
export const removeSampleData = async (org: string): Promise<string[]> => {
  const kept: string[] = [];
  await removeAlerts(org);
  await removeAlertDelivery(org, kept);
  await removeDashboards(org);
  const pipelineId = await findPipelineId(org);
  if (pipelineId) {
    await ignoreMissing(() =>
      pipelineService.deletePipeline({ pipeline_id: pipelineId, org_id: org }),
    );
  }
  for (const name of SAMPLE_FUNCTIONS) {
    try {
      await ignoreMissing(() => jsTransformService.delete(org, name));
    } catch (e) {
      // a user pipeline or stream that uses the function blocks its delete; the rest must still go
      console.warn(`Sample function "${name}" was kept`, e);
      kept.push(name);
    }
  }
  // the sample alerts and pipeline are gone by name; the cascade would also take the user's own
  await Promise.all(
    SAMPLE_STREAM_SET.map((s) =>
      ignoreMissing(() => streamService.delete(org, s.name, s.type, false)),
    ),
  );
  try {
    await quiet(() => sampleDataService.deleteState(org));
  } catch (e) {
    // everything else is already deleted; a stale state only points the tour at a window with no data
    console.warn("Sample data window was not deleted", e);
  }
  return kept;
};
