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
import sampleDataService from "@/services/sample_data";
import streamService from "@/services/stream";
import {
  SAMPLE_ALERT_DESTINATION,
  SAMPLE_ALERT_TEMPLATE,
  SAMPLE_ENRICHMENT_TABLE,
  SAMPLE_FOLDER_NAME,
  SAMPLE_FUNCTIONS,
  SAMPLE_METRICS,
  SAMPLE_OVERVIEW_TITLE,
  SAMPLE_STREAMS,
} from "./catalog";
import {
  sampleAlertDestination,
  sampleAlertTemplate,
  sampleAlerts,
  sampleDashboards,
  sampleFunctions,
  sampleServiceOwnersCsv,
} from "./assets";
import { createSampleGenerator } from "./generator";

export type SampleStepId = "telemetry" | "dashboards" | "alerts" | "functions" | "enrichment";

export const SAMPLE_STEPS: readonly SampleStepId[] = [
  "telemetry",
  "dashboards",
  "alerts",
  "functions",
  "enrichment",
];

export interface SampleCounts {
  logs: number;
  spans: number;
  metrics: number;
}

export interface SampleProgress {
  step: SampleStepId;
  /** 0..1 within the telemetry step; the asset steps report 0 then 1. */
  fraction: number;
  counts: SampleCounts;
}

export interface SampleLoadResult {
  counts: SampleCounts;
  hours: number;
  dashboardFolderId?: string;
  overviewDashboardId?: string;
  failedSteps: SampleStepId[];
}

const HOUR_US = 3_600_000_000;

/** Stays inside the server's back-fill window so no record is rejected as too old. */
export const sampleWindowHours = (ingestAllowedUptoHours: number | undefined) => {
  const limit = Number(ingestAllowedUptoHours) || 5;
  return Math.max(1, Math.min(4, limit - 0.5));
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

const ingestTelemetry = async (
  org: string,
  hours: number,
  report: (fraction: number, counts: SampleCounts) => void,
) => {
  const endUs = Date.now() * 1000;
  const gen = createSampleGenerator({ startUs: endUs - hours * HOUR_US, endUs });
  const counts: SampleCounts = { logs: 0, spans: 0, metrics: 0 };
  for (let i = 0; i < gen.chunkCount; i++) {
    const batch = gen.generateChunk(i);
    const writes: Promise<unknown>[] = [
      sampleDataService.ingestLogs(org, SAMPLE_STREAMS.appLogs, batch.appLogs),
      sampleDataService.ingestLogs(org, SAMPLE_STREAMS.accessLogs, batch.accessLogs),
      sampleDataService.ingestMetrics(org, batch.metrics),
    ];
    if (batch.spanCount) {
      writes.push(sampleDataService.ingestTraces(org, SAMPLE_STREAMS.traces, batch.traces));
    }
    await Promise.all(writes);
    counts.logs += batch.appLogs.length + batch.accessLogs.length;
    counts.spans += batch.spanCount;
    counts.metrics += batch.metrics.length;
    report((i + 1) / gen.chunkCount, { ...counts });
  }
  return counts;
};

const createDashboards = async (org: string) => {
  const folderId = await findOrCreateFolder(org, "dashboards");
  const existing = await dashboardService.list(0, 1000, "name", false, "", org, folderId, "");
  const titles = new Set(
    (existing.data?.dashboards ?? []).map((row: any) => toSearchHit(row).title),
  );
  let overviewId: string | undefined = (existing.data?.dashboards ?? [])
    .map(toSearchHit)
    .find((hit: { title: string }) => hit.title === SAMPLE_OVERVIEW_TITLE)?.dashboardId;
  for (const dash of sampleDashboards()) {
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
  onProgress({ step: "telemetry", fraction: 0, counts });
  counts = await ingestTelemetry(org, hours, (fraction, c) =>
    onProgress({ step: "telemetry", fraction, counts: c }),
  );

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
  await run("dashboards", async () => {
    const { folderId, overviewId } = await createDashboards(org);
    result.dashboardFolderId = folderId;
    result.overviewDashboardId = overviewId;
  });
  await run("alerts", () => createAlerts(org));
  await run("functions", () => createFunctions(org));
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

const removeDashboards = async (org: string) => {
  const folderId = await findFolder(org, "dashboards");
  if (!folderId) return;
  const res = await dashboardService.list(0, 1000, "name", false, "", org, folderId, "");
  for (const hit of (res.data?.dashboards ?? []).map(toSearchHit)) {
    await ignoreMissing(() => dashboardService.delete(org, hit.dashboardId, folderId));
  }
  await ignoreMissing(() => commonService.delete_Folder(org, "dashboards", folderId));
};

const removeAlerts = async (org: string) => {
  const folderId = await findFolder(org, "alerts");
  if (!folderId) return;
  const res = await alertsService.listByFolderId(1, 1000, "name", false, "", org, folderId);
  for (const alert of res.data?.list ?? []) {
    await ignoreMissing(() =>
      alertsService.delete_by_alert_id(org, alert.alert_id ?? alert.id, folderId),
    );
  }
  await ignoreMissing(() => commonService.delete_Folder(org, "alerts", folderId));
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
  for (const name of SAMPLE_FUNCTIONS) {
    await ignoreMissing(() => jsTransformService.delete(org, name, true));
  }
  await Promise.all(
    SAMPLE_STREAM_SET.map((s) =>
      ignoreMissing(() => streamService.delete(org, s.name, s.type, true)),
    ),
  );
};
