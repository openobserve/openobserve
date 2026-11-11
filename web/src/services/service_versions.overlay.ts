import streamService from "./stream";
import type { CompareResponse } from "./service_versions";
import { streamTraceRows } from "@/plugins/correlation/correlationStream";
// Bucket widths that divide a day, so the search keeps them as asked.
const OVERLAY_STEPS = [
  1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400,
];
const OVERLAY_POINTS = 60;

/** The compare chart series of both arms, read over the streaming search from every stamped trace stream. */
export async function readCompareOverlay(
  org: string,
  comparison: CompareResponse,
  signal: AbortSignal,
  metric: "requests" | "error_rate" | "p95" | "p99" = "requests",
) {
  const sources = new Map<string, { hasParent: boolean; hasImage: boolean }>();
  for (let offset = 0; ; offset += 100) {
    signal.throwIfAborted();
    const response = await streamService.nameList(org, "traces", true, offset, 100);
    signal.throwIfAborted();
    const data: { list: { name: string; schema: { name: string }[] }[]; total?: number } =
      response.data;
    for (const stream of data.list) {
      if (
        ["o2_service_where", "o2_service_version", "service_name", "span_kind", "_timestamp"].every(
          (field) => stream.schema.some((item) => item.name === field),
        )
      )
        sources.set(stream.name, {
          hasParent: stream.schema.some((field) => field.name === "reference_parent_span_id"),
          hasImage: stream.schema.some((field) => field.name === "o2_service_image"),
        });
    }
    if (
      data.list.length < 100 ||
      (data.total !== undefined && offset + data.list.length >= data.total)
    )
      break;
  }
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const step = overlayStep(comparison);
  const read = async (arm: CompareResponse["arms"]["a"], where: string) => {
    // A stream without the image field holds only imageless spans, so it cannot serve a build's arm.
    const readable = [...sources].filter(([, source]) => !arm.image || source.hasImage);
    if (!readable.length) return [];
    const image = !arm.image
      ? " AND NULLIF(o2_service_image, '') IS NULL"
      : ` AND NULLIF(o2_service_image, '') = ${literal(arm.image)}`;
    const union = readable
      .map(
        ([stream, { hasParent, hasImage }]) =>
          `SELECT _timestamp${metric === "error_rate" ? ", span_status" : metric === "requests" ? "" : ", duration"} FROM "${stream.replace(/"/g, '""')}" WHERE service_name=${literal(comparison.service)} AND o2_service_where=${literal(where)} AND o2_service_version=${literal(arm.version)}${hasImage ? image : ""} AND (CAST(span_kind AS VARCHAR) IN ('2','5')${hasParent ? " OR reference_parent_span_id IS NULL OR reference_parent_span_id = ''" : ""})`,
      )
      .join(" UNION ALL ");
    const expression =
      metric === "requests"
        ? "COUNT(*)"
        : metric === "error_rate"
          ? "1.0 * COUNT(*) FILTER (WHERE span_status = 'ERROR') / COUNT(*)"
          : `approx_percentile_cont(duration, ${metric === "p95" ? "0.95" : "0.99"})`;
    const sql = `SELECT histogram(_timestamp, '${step} seconds') AS ts, ${expression} AS value FROM (${union}) GROUP BY ts ORDER BY ts`;
    // A partial or failed stream rejects, so a gap never draws as zero traffic.
    const results = await streamTraceRows<{ ts: number | string; value: number }>({
      org,
      sql,
      startTime: arm.start_time,
      endTime: arm.end_time,
      size: 10000,
      signal,
    });
    signal.throwIfAborted();
    const totals = new Map<number, number>();
    for (const row of results) {
      // Histogram buckets come back as zone-less UTC strings, which Date.parse would read as local time.
      const timestamp =
        typeof row.ts === "number"
          ? row.ts / 1000
          : Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(row.ts) ? row.ts : `${row.ts}Z`);
      if (row.value == null || !Number.isFinite(timestamp) || !Number.isFinite(Number(row.value)))
        throw new Error("Invalid overlay point");
      // A bucket opening before the arm's window is plotted at the window start, never before it.
      const x = Math.max(timestamp, arm.start_time / 1000);
      if (totals.has(x)) throw new Error("Duplicate overlay bucket");
      totals.set(x, Number(row.value));
    }
    const points = [...totals].sort(([a], [b]) => a - b).map(([x, y]) => ({ x, y }));
    // A count bucket the window ends inside holds only part of its span, so its rate would read as a drop.
    const last = points.at(-1);
    if (
      metric === "requests" &&
      points.length > 1 &&
      last &&
      last.x + step * 1000 > arm.end_time / 1000
    )
      points.pop();
    return points;
  };
  const [a, b] = await Promise.all([
    read(comparison.arms.a, comparison.where_key),
    read(comparison.arms.b, comparison.arms.b.where_key || comparison.where_key),
  ]);
  return { a, b };
}

/** The overlay bucket width in seconds: about sixty points across the longer arm window. */
export function overlayStep(comparison: CompareResponse) {
  const { a, b } = comparison.arms;
  const seconds = Math.max(a.end_time - a.start_time, b.end_time - b.start_time, 0) / 1e6;
  return (
    OVERLAY_STEPS.find((step) => seconds / step <= OVERLAY_POINTS) ??
    OVERLAY_STEPS[OVERLAY_STEPS.length - 1]
  );
}

/** The wall-clock span both arm windows cover, in milliseconds. */
export function overlayRange(comparison: CompareResponse) {
  const { a, b } = comparison.arms;
  return {
    min: Math.min(a.start_time, b.start_time) / 1000,
    max: Math.max(a.end_time, b.end_time) / 1000,
  };
}
