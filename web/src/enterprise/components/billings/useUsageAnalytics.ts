import SearchService from "@/services/search";
import {
  buildLast24hSql,
  buildPerStreamSql,
  buildDailyTrendSql,
  distinctDays,
} from "./usageAnalytics";

export interface PerStreamRow {
  stream_name: string;
  total_mb: number;
  records: number;
  days: number;
}
export interface TrendPoint {
  day: string;
  total_mb: number;
}
export interface UsageAnalyticsResult {
  hasData: boolean;
  last24hMb: number;
  avgDailyMb: number;
  daysOfData: number;
  perStream: PerStreamRow[];
  trend: TrendPoint[];
}

async function runQuery(
  orgId: string,
  sql: string,
  start: number,
  end: number,
): Promise<any[]> {
  const res: any = await SearchService.search(
    {
      org_identifier: orgId,
      query: { query: { sql, start_time: start, end_time: end, size: -1 } },
      page_type: "logs",
    },
    "ui",
  );
  return res?.data?.hits ?? [];
}

export async function fetchUsageAnalytics(
  orgId: string,
  startTimeMicros: number,
  endTimeMicros: number,
): Promise<UsageAnalyticsResult> {
  const [last24hHits, perStreamHits, trendHits] = await Promise.all([
    runQuery(orgId, buildLast24hSql(), startTimeMicros, endTimeMicros),
    runQuery(orgId, buildPerStreamSql(), startTimeMicros, endTimeMicros),
    runQuery(orgId, buildDailyTrendSql(), startTimeMicros, endTimeMicros),
  ]);

  const last24hMb = Number(last24hHits?.[0]?.total_mb ?? 0);
  const perStream: PerStreamRow[] = (perStreamHits ?? []).map((h) => ({
    stream_name: String(h.stream_name ?? ""),
    total_mb: Number(h.total_mb ?? 0),
    records: Number(h.records ?? 0),
    days: Number(h.days ?? 0),
  }));
  const trend: TrendPoint[] = (trendHits ?? []).map((h) => ({
    day: String(h.day ?? ""),
    total_mb: Number(h.total_mb ?? 0),
  }));

  const daysOfData = distinctDays(trend);
  const totalTrendMb = trend.reduce((sum, p) => sum + p.total_mb, 0);
  const avgDailyMb = daysOfData > 0 ? totalTrendMb / daysOfData : 0;
  const hasData =
    last24hMb > 0 || perStream.length > 0 || trend.length > 0;

  return { hasData, last24hMb, avgDailyMb, daysOfData, perStream, trend };
}
