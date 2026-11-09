// Copyright 2026 OpenObserve Inc.

// Intel tables are ordinary enrichment tables, so one added elsewhere shows up when its name marks it as intel.

import analytics from "@/services/product_analytics";
import jsTransformService from "@/services/jstransform";
import { runSql } from "@/composables/security/useSecurityStreamPlans";
import streamService from "@/services/stream";
import {
  INTEL_COLUMNS,
  indicatorToRow,
  indicatorsToCsv,
  isBlankRow,
  isIntelTable,
  rowColumns,
  rowToIndicator,
  rowsToCsv,
  rowsWithout,
  type Indicator,
} from "@/utils/security/intel";

export interface IntelTable {
  name: string;
  /** Rows, per stream stats; stats lag uploads, so this can read 0 briefly. */
  docs: number;
  createdAt: number | null;
  /** Latest feed-URL job status, when the table is fed from a URL. */
  feed: { url: string; status: string; error: string | null } | null;
}

/** Most rows read from one table. Past this the page says the list is partial. */
export const INTEL_READ_LIMIT = 10_000;

const threatIntel = {
  async listTables(orgId: string): Promise<IntelTable[]> {
    const [streams, statuses] = await Promise.all([
      streamService.nameList(orgId, "enrichment_tables", false),
      jsTransformService.get_all_enrichment_table_statuses(orgId).catch(() => ({ data: {} })),
    ]);
    const jobs = (statuses.data ?? {}) as Record<string, any[]>;
    return (streams.data?.list ?? [])
      .filter((s: any) => isIntelTable(String(s.name)))
      .map((s: any) => {
        const tableJobs = Array.isArray(jobs[s.name]) ? jobs[s.name] : [];
        const latest = [...tableJobs].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))[0];
        return {
          name: String(s.name),
          docs: Number(s.stats?.doc_num ?? 0),
          createdAt: s.stats?.created_at ? Number(s.stats.created_at) : null,
          feed: latest
            ? {
                url: String(latest.url ?? ""),
                status: String(latest.status ?? ""),
                error: latest.error_message ?? null,
              }
            : null,
        };
      });
  },

  /** Uncached, since the result cache is not invalidated when a table is replaced. */
  async readTable(orgId: string, table: string): Promise<IntelTableRead> {
    const end = Date.now() * 1000 + 3_600_000_000;
    const name = `"${table.replace(/"/g, '""')}"`;
    const run = (sql: string, size: number) =>
      runSql(orgId, sql, 1_000_000, end, size, {
        pageType: "enrichment_tables",
        useCache: false,
      });
    const [rows, count] = await Promise.all([
      run(`SELECT * FROM ${name}`, INTEL_READ_LIMIT),
      run(`SELECT COUNT(*) AS zo_n FROM ${name}`, 1),
    ]);
    const raw: Record<string, unknown>[] = rows.hits;
    const indicators: Indicator[] = [];
    let skipped = 0;
    let blank = 0;
    for (const row of raw) {
      if (isBlankRow(row)) {
        blank += 1;
        continue;
      }
      const parsed = rowToIndicator(row, table);
      if (parsed) indicators.push(parsed);
      else skipped += 1;
    }
    const columns = rowColumns(raw);
    return {
      raw,
      indicators,
      rowCount: Number(count.hits[0]?.zo_n ?? raw.length),
      skipped,
      blank,
      columns,
      hasIndicatorColumn: columns.some((c) => ["indicator", "ioc", "value"].includes(c)),
    };
  },

  /** Appends must reuse the table's existing columns: the backend refuses an append whose columns differ. */
  upload(
    orgId: string,
    table: string,
    indicators: Omit<Indicator, "table">[],
    append: boolean,
    existingColumns: string[] = [],
  ) {
    if (!append || !existingColumns.length) {
      return uploadCsv(orgId, table, indicatorsToCsv(indicators), append).then((res) => {
        analytics.track("security_intel_indicators_uploaded", { count: indicators.length, append });
        return res;
      });
    }
    const rows = indicators.map((i) => indicatorToRow(i, existingColumns));
    if (rows.some((r) => !r)) throw new RemoveRefused("noIndicatorColumn", 0);
    return uploadCsv(
      orgId,
      table,
      rowsToCsv(existingColumns, rows as Record<string, string>[]),
      true,
    ).then((res) => {
      analytics.track("security_intel_indicators_uploaded", { count: indicators.length, append });
      return res;
    });
  },

  /** Registers a CSV feed; the server fetches it in the background. */
  importUrl(orgId: string, table: string, url: string, append: boolean) {
    return jsTransformService
      .create_enrichment_table_from_url(orgId, table, url, append)
      .then((res) => {
        analytics.track("security_intel_feed_imported", { append });
        return res;
      });
  },

  /** An emptied list stays a header-only table: deleting it would also drop attached pipelines/alerts. */
  async removeIndicator(
    orgId: string,
    target: Pick<Indicator, "type" | "indicator" | "table">,
  ): Promise<{ removed: number }> {
    const read = await this.readTable(orgId, target.table);
    if (read.rowCount !== read.raw.length) {
      throw new RemoveRefused("partial", read.rowCount);
    }
    const { kept, removed } = rowsWithout(read.raw, target);
    if (!removed) throw new RemoveRefused("notFound", 0);
    const columns = read.columns.length ? read.columns : [...INTEL_COLUMNS];
    await uploadCsv(orgId, target.table, rowsToCsv(columns, kept), false);
    analytics.track("security_intel_indicator_removed", { count: removed });
    return { removed };
  },
};

function uploadCsv(orgId: string, table: string, csv: string, append: boolean) {
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), `${table}.csv`);
  return jsTransformService.create_enrichment_table(orgId, table, form, append);
}

export class RemoveRefused extends Error {
  constructor(
    public readonly reason: "partial" | "notFound" | "noIndicatorColumn",
    public readonly rowCount: number,
  ) {
    super(reason);
  }
}

export interface IntelTableRead {
  /** Rows exactly as stored (including `_timestamp`). */
  raw: Record<string, unknown>[];
  indicators: Indicator[];
  /** True row count of the table, from COUNT(*). */
  rowCount: number;
  /** Non-blank rows that are not a recognisable indicator. */
  skipped: number;
  /** Empty rows, as left by an emptied list. */
  blank: number;
  columns: string[];
  hasIndicatorColumn: boolean;
}

export default threatIntel;
