import type { ScoreConfig, ScoreDataType } from "@/services/online-evals.service";

// Shape we emit on export. Mirrors the canonical import payload so an exported
// JSON re-imports cleanly without any user-side editing.
export interface ExportedScoreConfig {
  name: string;
  description?: string | null;
  dataType: ScoreDataType;
  numericRange?: { min: number; max: number };
  categories?: string[];
  healthyThreshold?: Record<string, any>;
}

// Strip server-managed fields (id, version, timestamps, org) from a score
// config row and emit a canonical, camelCase payload.
//
// API responses can include either camelCase or snake_case keys depending on
// the field — see ScoreConfig in online-evals.service.ts. We accept both on
// input and always emit camelCase on output.
export function stripScoreConfigForExport(row: ScoreConfig): ExportedScoreConfig {
  const r = row as Record<string, any>;

  const name = typeof r.name === "string" ? r.name : "";
  const dataType = (r.dataType ?? r.data_type) as ScoreDataType;

  const out: ExportedScoreConfig = { name, dataType };

  if (r.description !== undefined && r.description !== null) {
    out.description = r.description;
  }

  const range = r.numericRange ?? r.numeric_range;
  if (range && typeof range === "object") {
    if (typeof range.min === "number" && typeof range.max === "number") {
      out.numericRange = { min: range.min, max: range.max };
    }
  }

  if (Array.isArray(r.categories) && r.categories.length > 0) {
    out.categories = r.categories;
  }

  const ht = normalizeExportHealthyThreshold(r.healthyThreshold ?? r.healthy_threshold);
  if (ht) out.healthyThreshold = ht;

  return out;
}

function normalizeExportHealthyThreshold(ht: any): Record<string, any> | undefined {
  if (!ht || typeof ht !== "object") return undefined;
  const out: Record<string, any> = {};

  if (ht.direction !== undefined) out.direction = ht.direction;
  if (ht.value !== undefined) out.value = ht.value;

  const cats = ht.healthy_categories ?? ht.healthyCategories;
  if (cats !== undefined) out.healthy_categories = cats;

  const val = ht.healthy_value ?? ht.healthyValue;
  if (val !== undefined) out.healthy_value = val;

  return Object.keys(out).length ? out : undefined;
}

export function exportScoreConfigFileName(row: ScoreConfig): string {
  const r = row as Record<string, any>;
  const raw = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "score-config";
  // File-system safe: keep letters, digits, dash, underscore, dot; replace the rest.
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${safe}.json`;
}

export function bulkExportFileName(date: Date = new Date()): string {
  const stamp = date.toISOString().split("T")[0];
  return `score-configs-${stamp}.json`;
}
