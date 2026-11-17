import type { CompareResponse, ErrorTypeCount, SharedErrorType } from "@/services/service_versions";
import { meetsFloor } from "./VersionSummaryTiles.format";
export type ErrorKind = "introduced" | "fixed" | "shared";
export interface ErrorCounts {
  before: number;
  after: number;
}
// Introduced and fixed rows carry only the arm they were seen in; shared rows carry both.
export function errorCounts(kind: ErrorKind, row: ErrorTypeCount | SharedErrorType): ErrorCounts {
  if (kind === "shared") {
    const shared = row as SharedErrorType;
    return { before: shared.count_b ?? 0, after: shared.count_a ?? 0 };
  }
  const count = (row as ErrorTypeCount).count ?? 0;
  return kind === "introduced" ? { before: 0, after: count } : { before: count, after: 0 };
}
// Unknown view counts cannot prove the error floor, so they read as early.
export function rumEarly(result: CompareResponse) {
  const views = result.rum?.views;
  return (
    Boolean(result.rum?.error_types?.early) ||
    !meetsFloor("error_view_rate", views ? Math.min(views.a, views.b) : undefined)
  );
}
