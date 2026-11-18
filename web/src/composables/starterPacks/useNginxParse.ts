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

import { readQuery } from "@/composables/query/readQuery";
import { alertsListQuery } from "@/services/alerts.queries";
import dashboards from "@/services/dashboards";
import jstransform from "@/services/jstransform";
import pipelines from "@/services/pipelines";
import { pipelinesQuery } from "@/services/pipelines.queries";
import { viewTypeOf } from "@/services/saved_views";
import { savedViewDetailQuery, savedViewsQuery } from "@/services/saved_views.queries";

import {
  addedFields,
  detectFormat,
  PARSE_REPAIR_ID,
  parserSource,
  PREVIEW_RECORDS,
  repairName,
  repairPipeline,
  streamReaders,
  type NginxFormat,
  type StreamReader,
} from "./nginxParse";
import { inBatches } from "./packMatchData";
import type { RawLogNotice } from "./rawLogs";
import type { PackInstallRecord, PackRecordItem } from "./types";
import { useInstallRecords } from "./useInstallRecords";
import { useStreamValues } from "./useStreamValues";

export interface ParsePreviewRow {
  line: string;
  added: Record<string, unknown>;
}

export interface ParsePreview {
  format: NginxFormat;
  rows: ParsePreviewRow[];
}

const DASHBOARD_PAGE = 1000;

/** Saved views list without their search, so only this many are opened to find their streams. */
const VIEW_READS = 100;

const setItem = (record: PackInstallRecord, kind: string, patch: Partial<PackRecordItem>) => {
  record.items = record.items.map((item) => (item.kind === kind ? { ...item, ...patch } : item));
};

// The object may have been deleted by hand, and Undo must still finish.
const ignoreMissing = async (work: () => Promise<unknown>) => {
  try {
    await work();
  } catch (error: any) {
    if (error?.response?.status !== 404) throw error;
  }
};

const owned = (record: PackInstallRecord, kind: string) =>
  record.items.find((item) => item.kind === kind && item.status === "created" && item.id);

export function useNginxParse(org: string) {
  const records = useInstallRecords(org);
  const { readValues } = useStreamValues(org);

  const preview = async ({ stream, column }: RawLogNotice): Promise<ParsePreview | null> => {
    const lines = ((await readValues(stream, [column]))[column] ?? []).slice(0, PREVIEW_RECORDS);
    const format = detectFormat(lines);
    if (!format) return null;
    const response = await jstransform.test(org, {
      function: parserSource(format, column),
      events: lines.map((line) => ({ [column]: line })),
      trans_type: 0,
    });
    const results: any[] = response.data?.results ?? [];
    return {
      format,
      rows: lines.map((line, index) => ({
        line,
        added: addedFields({ [column]: line }, results[index]?.event ?? {}),
      })),
    };
  };

  const readViews = async () => {
    const rows = (await readQuery(savedViewsQuery(org), true))
      .filter((row) => viewTypeOf(row) === "logs")
      .slice(0, VIEW_READS);
    const details = await inBatches(rows, (row) =>
      readQuery(savedViewDetailQuery(org, row.view_id), true).catch(() => null),
    );
    return details.filter(Boolean);
  };

  /** A source that fails to list is left out, since the list only informs the choice. */
  const readers = async (stream: string): Promise<StreamReader[]> => {
    const [dashboardRows, alerts, savedViews, pipelineRows] = await Promise.all([
      dashboards
        .list(0, DASHBOARD_PAGE, "name", false, "", org, "", "")
        .then((response) => response.data?.dashboards ?? [])
        .catch(() => []),
      readQuery(alertsListQuery(org, ""), true).catch(() => []),
      readViews().catch(() => []),
      readQuery(pipelinesQuery(org), true).catch(() => []),
    ]);
    return streamReaders(
      { dashboards: dashboardRows, alerts, savedViews, pipelines: pipelineRows },
      stream,
    );
  };

  /** Writes the record before each create, so a failure part-way leaves something Undo can clear. */
  const confirm = async (
    { stream, column }: RawLogNotice,
    format: NginxFormat,
    installedBy?: string,
  ): Promise<PackInstallRecord> => {
    const name = repairName(stream);
    const existing = await records.read(PARSE_REPAIR_ID, name);
    if (existing && existing.status !== "removed") throw new Error("parse_repair_exists");
    const record: PackInstallRecord = {
      packId: PARSE_REPAIR_ID,
      installId: name,
      status: "installing",
      installedAt: Date.now() * 1000,
      installedBy,
      items: [
        { kind: "function", itemId: format, status: "pending", stream },
        { kind: "pipeline", itemId: format, status: "pending", stream },
      ],
    };
    await records.write(record);
    try {
      await jstransform.create(org, {
        name,
        function: parserSource(format, column),
        params: "row",
        transType: 0,
      });
      setItem(record, "function", { status: "created", id: name });
      await records.write(record);
      const response = await pipelines.createPipeline({
        org_identifier: org,
        data: repairPipeline(org, stream, name),
      });
      setItem(record, "pipeline", { status: "created", id: String(response.data?.id ?? "") });
      record.status = "complete";
    } catch (error) {
      record.items = record.items.map((item) =>
        item.status === "pending" ? { ...item, status: "failed" } : item,
      );
      record.status = "incomplete";
      // The create error is the one worth surfacing, not a failed KV write behind it.
      await records.write(record).catch(() => {});
      throw error;
    }
    await records.write(record);
    return record;
  };

  /** Deletes only what the record says this repair created; parsed records keep their fields. */
  const undo = async (record: PackInstallRecord) => {
    const pipeline = owned(record, "pipeline");
    if (pipeline) {
      await ignoreMissing(() =>
        pipelines.deletePipeline({ pipeline_id: pipeline.id!, org_id: org }),
      );
      setItem(record, "pipeline", { status: "skipped" });
      await records.write(record);
    }
    const fn = owned(record, "function");
    if (fn) {
      await ignoreMissing(() => jstransform.delete(org, fn.id!));
      setItem(record, "function", { status: "skipped" });
    }
    record.status = "removed";
    await records.write(record);
  };

  const active = async () =>
    (await records.list(PARSE_REPAIR_ID)).filter(({ status }) => status !== "removed");

  return { preview, readers, confirm, undo, active };
}
