// The caller's `t` is threaded in via ctx — this validator is a plain util, so
// it can't call useI18nTyped() itself.
import { type I18nText, type TranslateFn } from "@/types/i18n";

import type { ScoreConfig, ScoreDataType } from "@/services/online-evals.service";

const VALID_DATA_TYPES: ScoreDataType[] = ["numeric", "categorical", "boolean"];

export interface ScoreConfigPayload {
  name: string;
  description?: string | null;
  dataType: ScoreDataType;
  numericRange?: { min: number; max: number };
  categories?: string[];
  healthyThreshold?: Record<string, any>;
}

export type ScoreConfigImportField =
  | "name"
  | "dataType"
  | "numericRange"
  | "categories"
  | "healthyThreshold"
  | "nameConflict"
  | "duplicate"
  | "shape";

export interface ScoreConfigImportError {
  itemIndex: number;
  field: ScoreConfigImportField;
  message: I18nText;
  fixable?: boolean;
}

export interface PreparedScoreConfigItem {
  payload: ScoreConfigPayload | null;
  errors: ScoreConfigImportError[];
}

export interface PreparedScoreConfigImport {
  items: PreparedScoreConfigItem[];
  errors: ScoreConfigImportError[];
  hasErrors: boolean;
}

// Accepts both camelCase and snake_case keys. Strips unknown fields so users
// can paste an API response that includes id/version/createdAt/etc.
export function normalizeScoreConfigInput(raw: unknown): Partial<ScoreConfigPayload> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, any>;

  const result: Partial<ScoreConfigPayload> = {};

  if (typeof r.name === "string") result.name = r.name;
  if (r.description !== undefined) result.description = r.description;

  const dataType = r.dataType ?? r.data_type;
  if (dataType !== undefined) result.dataType = dataType;

  const range = r.numericRange ?? r.numeric_range;
  if (range && typeof range === "object") {
    result.numericRange = { min: range.min, max: range.max };
  }

  if (Array.isArray(r.categories)) result.categories = r.categories;

  const ht = normalizeHealthyThreshold(r.healthyThreshold ?? r.healthy_threshold);
  if (ht) result.healthyThreshold = ht;

  return result;
}

function normalizeHealthyThreshold(ht: any): Record<string, any> | undefined {
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

export function validateScoreConfig(
  normalized: Partial<ScoreConfigPayload> | null,
  ctx: {
    itemIndex: number;
    existingNames: Set<string>;
    nameCounts: Map<string, number>;
    t: TranslateFn;
  },
): ScoreConfigImportError[] {
  const errors: ScoreConfigImportError[] = [];
  const t = ctx.t;
  const idx = ctx.itemIndex;
  const display = idx + 1;

  if (!normalized) {
    errors.push({
      itemIndex: idx,
      field: "shape",
      message: t("onlineEvals.scoreConfigImport.mustBeJsonObject", { index: display }),
    });
    return errors;
  }

  const name = normalized.name;
  if (!name || typeof name !== "string" || !name.trim()) {
    errors.push({
      itemIndex: idx,
      field: "name",
      message: t("onlineEvals.scoreConfigImport.nameRequired", { index: display }),
      fixable: true,
    });
  }

  const dataType = normalized.dataType;
  if (!dataType || !VALID_DATA_TYPES.includes(dataType as ScoreDataType)) {
    errors.push({
      itemIndex: idx,
      field: "dataType",
      message: t("onlineEvals.scoreConfigImport.dataTypeInvalid", {
        index: display,
        types: VALID_DATA_TYPES.join(", "),
      }),
      fixable: true,
    });
  }

  if (dataType === "numeric") {
    const r = normalized.numericRange;
    if (!r || typeof r.min !== "number" || typeof r.max !== "number") {
      errors.push({
        itemIndex: idx,
        field: "numericRange",
        message: t("onlineEvals.scoreConfigImport.numericRangeRequired", { index: display }),
      });
    } else if (!(r.min < r.max)) {
      errors.push({
        itemIndex: idx,
        field: "numericRange",
        message: t("onlineEvals.scoreConfigImport.numericRangeOrder", { index: display }),
      });
    }
  } else if (dataType === "categorical") {
    const cats = normalized.categories;
    if (!Array.isArray(cats) || cats.length === 0) {
      errors.push({
        itemIndex: idx,
        field: "categories",
        message: t("onlineEvals.scoreConfigImport.categoriesRequired", { index: display }),
      });
    } else if (!cats.every((c) => typeof c === "string" && c.length > 0)) {
      errors.push({
        itemIndex: idx,
        field: "categories",
        message: t("onlineEvals.scoreConfigImport.categoryMustBeString", { index: display }),
      });
    } else if (new Set(cats).size !== cats.length) {
      errors.push({
        itemIndex: idx,
        field: "categories",
        message: t("onlineEvals.scoreConfigImport.categoriesUnique", { index: display }),
      });
    }
  }

  const ht = normalized.healthyThreshold;
  if (ht) {
    if (dataType === "numeric") {
      if (ht.direction !== "gte" && ht.direction !== "lte") {
        errors.push({
          itemIndex: idx,
          field: "healthyThreshold",
          message: t("onlineEvals.scoreConfigImport.numericDirectionInvalid", { index: display }),
        });
      }
      if (typeof ht.value !== "number") {
        errors.push({
          itemIndex: idx,
          field: "healthyThreshold",
          message: t("onlineEvals.scoreConfigImport.numericValueInvalid", { index: display }),
        });
      }
    } else if (dataType === "categorical") {
      const list = ht.healthy_categories;
      if (!Array.isArray(list) || list.length === 0) {
        errors.push({
          itemIndex: idx,
          field: "healthyThreshold",
          message: t("onlineEvals.scoreConfigImport.categoricalHealthyCategoriesRequired", {
            index: display,
          }),
        });
      }
    } else if (dataType === "boolean") {
      if (typeof ht.healthy_value !== "boolean") {
        errors.push({
          itemIndex: idx,
          field: "healthyThreshold",
          message: t("onlineEvals.scoreConfigImport.booleanHealthyValueInvalid", {
            index: display,
          }),
        });
      }
    }
  }

  if (name && typeof name === "string" && name.trim()) {
    const trimmed = name.trim();
    if (ctx.existingNames.has(trimmed)) {
      errors.push({
        itemIndex: idx,
        field: "nameConflict",
        message: t("onlineEvals.scoreConfigImport.nameExists", {
          index: display,
          name: trimmed,
        }),
        fixable: true,
      });
    }
    if ((ctx.nameCounts.get(trimmed) ?? 0) > 1) {
      errors.push({
        itemIndex: idx,
        field: "duplicate",
        message: t("onlineEvals.scoreConfigImport.nameDuplicate", {
          index: display,
          name: trimmed,
        }),
      });
    }
  }

  return errors;
}

// Top-level entry: takes raw input from the JSON editor, returns per-item
// results and a global error list ready to render. When `hasErrors` is true,
// caller must NOT POST any payloads — the user fixes errors and retries.
export function prepareScoreConfigImport(
  rawItems: unknown[],
  existingScoreConfigs: ReadonlyArray<Pick<ScoreConfig, "name">>,
  t: TranslateFn,
): PreparedScoreConfigImport {
  const existingNames = new Set(
    existingScoreConfigs.map((c) => (c.name ?? "").trim()).filter(Boolean),
  );

  const normalized = rawItems.map((r) => normalizeScoreConfigInput(r));

  const nameCounts = new Map<string, number>();
  for (const n of normalized) {
    const name = typeof n?.name === "string" ? n.name.trim() : "";
    if (!name) continue;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  const items: PreparedScoreConfigItem[] = normalized.map((n, i) => {
    const errors = validateScoreConfig(n, { itemIndex: i, existingNames, nameCounts, t });
    if (errors.length || !n) return { payload: null, errors };
    return { payload: buildPayload(n), errors };
  });

  const errors = items.flatMap((i) => i.errors);
  return { items, errors, hasErrors: errors.length > 0 };
}

function buildPayload(n: Partial<ScoreConfigPayload>): ScoreConfigPayload {
  const out: ScoreConfigPayload = {
    name: (n.name as string).trim(),
    dataType: n.dataType as ScoreDataType,
  };
  if (n.description !== undefined) out.description = n.description;
  if (n.numericRange) out.numericRange = n.numericRange;
  if (n.categories) out.categories = n.categories;
  if (n.healthyThreshold) out.healthyThreshold = n.healthyThreshold;
  return out;
}
