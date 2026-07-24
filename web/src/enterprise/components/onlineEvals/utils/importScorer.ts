import type { Provider, ScoreConfig, ScorerType } from "@/services/online-evals.service";

const VALID_SCORER_TYPES: ScorerType[] = ["llm_judge", "remote"];

export interface ScorerPayload {
  name: string;
  description?: string | null;
  scorer: {
    type: ScorerType;
    producesScoreConfigId: string;
    producesScoreConfigVersion?: number | null;
    template: string;
    params: Record<string, any>;
  };
}

export interface NormalizedScorerInput {
  name?: string;
  description?: string | null;
  scorer?: {
    type?: ScorerType;
    producesScoreConfigId?: string;
    producesScoreConfigName?: string;
    producesScoreConfigVersion?: number | null;
    template?: string;
    params?: Record<string, any> & {
      provider_id?: string;
      providerName?: string;
    };
  };
}

export type ScorerImportField =
  | "name"
  | "type"
  | "scoreConfigRef"
  | "providerRef"
  | "template"
  | "nameConflict"
  | "duplicate"
  | "shape";

export interface ScorerImportError {
  itemIndex: number;
  field: ScorerImportField;
  message: string;
  fixable?: boolean;
}

export interface PreparedScorerItem {
  payload: ScorerPayload | null;
  errors: ScorerImportError[];
}

export interface PreparedScorerImport {
  items: PreparedScorerItem[];
  errors: ScorerImportError[];
  hasErrors: boolean;
}

// Accept camelCase and snake_case at every level (top, scorer envelope, params).
// Strip unknown top-level fields so a full API response pastes cleanly.
export function normalizeScorerInput(raw: unknown): NormalizedScorerInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, any>;
  const result: NormalizedScorerInput = {};

  if (typeof r.name === "string") result.name = r.name;
  if (r.description !== undefined) result.description = r.description;

  const scorerRaw = r.scorer && typeof r.scorer === "object" ? r.scorer : null;
  // Some exports / older payloads may have flattened the scorer fields onto the
  // top-level object. Accept both shapes.
  const src: Record<string, any> = scorerRaw ?? r;

  const scorer: NormalizedScorerInput["scorer"] = {};

  const type = src.type ?? src.scorerType ?? src.scorer_type;
  if (type !== undefined) scorer.type = type as ScorerType;

  const scId = src.producesScoreConfigId ?? src.produces_score_config_id;
  if (typeof scId === "string" && scId) scorer.producesScoreConfigId = scId;

  const scName = src.producesScoreConfigName ?? src.produces_score_config_name;
  if (typeof scName === "string" && scName) scorer.producesScoreConfigName = scName;

  const scVer = src.producesScoreConfigVersion ?? src.produces_score_config_version;
  if (scVer !== undefined) scorer.producesScoreConfigVersion = scVer;

  if (typeof src.template === "string") scorer.template = src.template;

  const params = src.params && typeof src.params === "object" ? { ...src.params } : undefined;
  if (params) {
    // Normalize provider hint keys but keep all other params as-is (remote
    // scorers have free-form params we shouldn't touch).
    const provId = params.provider_id ?? params.providerId;
    const provName = params.providerName ?? params.provider_name;
    if (provId !== undefined) {
      params.provider_id = provId;
      delete params.providerId;
    }
    if (provName !== undefined) {
      params.providerName = provName;
      delete params.provider_name;
    }
    scorer.params = params;
  }

  if (Object.keys(scorer).length > 0) result.scorer = scorer;
  return result;
}

interface ResolveCtx {
  scoreConfigs: ReadonlyArray<ScoreConfig>;
  providers: ReadonlyArray<Provider>;
}

function scoreConfigEntityId(row: ScoreConfig): string {
  return String((row as any).entityId ?? (row as any).entity_id ?? row.id);
}

function findScoreConfigById(rows: ReadonlyArray<ScoreConfig>, id: string) {
  return rows.find((r) => scoreConfigEntityId(r) === id || String(r.id) === id) ?? null;
}

function findScoreConfigByName(rows: ReadonlyArray<ScoreConfig>, name: string) {
  const target = name.trim();
  return rows.find((r) => (r.name ?? "").trim() === target) ?? null;
}

function findProviderById(rows: ReadonlyArray<Provider>, id: string) {
  return rows.find((r) => String(r.id) === id) ?? null;
}

function findProviderByName(rows: ReadonlyArray<Provider>, name: string) {
  const target = name.trim();
  return rows.find((r) => (r.name ?? "").trim() === target) ?? null;
}

// Resolution ladder: try ID first (same-org re-import), then name (cross-org),
// then bail with a fixable error.
function resolveScoreConfigRef(
  scorer: NonNullable<NormalizedScorerInput["scorer"]>,
  ctx: ResolveCtx,
): { id: string } | { error: "missing" | "unresolved" } {
  const byId = scorer.producesScoreConfigId
    ? findScoreConfigById(ctx.scoreConfigs, scorer.producesScoreConfigId)
    : null;
  if (byId) return { id: scoreConfigEntityId(byId) };

  const byName = scorer.producesScoreConfigName
    ? findScoreConfigByName(ctx.scoreConfigs, scorer.producesScoreConfigName)
    : null;
  if (byName) return { id: scoreConfigEntityId(byName) };

  if (!scorer.producesScoreConfigId && !scorer.producesScoreConfigName) {
    return { error: "missing" };
  }
  return { error: "unresolved" };
}

function resolveProviderRef(
  params: NonNullable<NonNullable<NormalizedScorerInput["scorer"]>["params"]>,
  ctx: ResolveCtx,
): { id: string } | { error: "missing" | "unresolved" } {
  const byId = params.provider_id ? findProviderById(ctx.providers, params.provider_id) : null;
  if (byId) return { id: byId.id };

  const byName = params.providerName
    ? findProviderByName(ctx.providers, params.providerName)
    : null;
  if (byName) return { id: byName.id };

  if (!params.provider_id && !params.providerName) {
    return { error: "missing" };
  }
  return { error: "unresolved" };
}

export interface ValidateScorerCtx extends ResolveCtx {
  itemIndex: number;
  existingNames: Set<string>;
  nameCounts: Map<string, number>;
}

export function validateScorer(
  normalized: NormalizedScorerInput | null,
  ctx: ValidateScorerCtx,
): { payload: ScorerPayload | null; errors: ScorerImportError[] } {
  const errors: ScorerImportError[] = [];
  const idx = ctx.itemIndex;
  const display = idx + 1;

  if (!normalized) {
    errors.push({
      itemIndex: idx,
      field: "shape",
      message: `Scorer ${display}: must be a JSON object`,
    });
    return { payload: null, errors };
  }

  const name = normalized.name;
  if (!name || typeof name !== "string" || !name.trim()) {
    errors.push({
      itemIndex: idx,
      field: "name",
      message: `Scorer ${display}: name is required and must be a non-empty string`,
      fixable: true,
    });
  }

  const scorer = normalized.scorer;
  if (!scorer || !scorer.type) {
    errors.push({
      itemIndex: idx,
      field: "type",
      message: `Scorer ${display}: scorer.type must be one of ${VALID_SCORER_TYPES.join(", ")}`,
      fixable: true,
    });
  } else if (!VALID_SCORER_TYPES.includes(scorer.type)) {
    errors.push({
      itemIndex: idx,
      field: "type",
      message: `Scorer ${display}: scorer.type must be one of ${VALID_SCORER_TYPES.join(", ")}`,
      fixable: true,
    });
  }

  let resolvedScoreConfigId: string | null = null;
  if (scorer) {
    const ref = resolveScoreConfigRef(scorer, ctx);
    if ("id" in ref) {
      resolvedScoreConfigId = ref.id;
    } else {
      errors.push({
        itemIndex: idx,
        field: "scoreConfigRef",
        message:
          ref.error === "missing"
            ? `Scorer ${display}: producesScoreConfigId or producesScoreConfigName is required`
            : `Scorer ${display}: referenced score config not found in this org`,
        fixable: true,
      });
    }
  }

  let resolvedProviderId: string | null = null;
  if (scorer?.type === "llm_judge") {
    const params = scorer.params ?? {};
    const ref = resolveProviderRef(params, ctx);
    if ("id" in ref) {
      resolvedProviderId = ref.id;
    } else {
      errors.push({
        itemIndex: idx,
        field: "providerRef",
        message:
          ref.error === "missing"
            ? `Scorer ${display}: provider_id or providerName is required for llm_judge scorers`
            : `Scorer ${display}: referenced provider not found in this org`,
        fixable: true,
      });
    }

    if (typeof scorer.template !== "string" || !scorer.template.trim()) {
      errors.push({
        itemIndex: idx,
        field: "template",
        message: `Scorer ${display}: scorer.template is required for llm_judge scorers`,
      });
    }
  }

  if (name && typeof name === "string" && name.trim()) {
    const trimmed = name.trim();
    if (ctx.existingNames.has(trimmed)) {
      errors.push({
        itemIndex: idx,
        field: "nameConflict",
        message: `Scorer ${display}: name "${trimmed}" already exists in this org`,
        fixable: true,
      });
    }
    if ((ctx.nameCounts.get(trimmed) ?? 0) > 1) {
      errors.push({
        itemIndex: idx,
        field: "duplicate",
        message: `Scorer ${display}: name "${trimmed}" is used more than once in this import`,
      });
    }
  }

  if (errors.length > 0 || !scorer || !name || !resolvedScoreConfigId || !scorer.type) {
    return { payload: null, errors };
  }

  // Build canonical payload. Strip resolution-hint keys so we send a clean
  // body to the server.
  const cleanParams: Record<string, any> = { ...(scorer.params ?? {}) };
  delete cleanParams.providerName;
  if (scorer.type === "llm_judge" && resolvedProviderId) {
    cleanParams.provider_id = resolvedProviderId;
  }

  const payload: ScorerPayload = {
    name: name.trim(),
    scorer: {
      type: scorer.type,
      producesScoreConfigId: resolvedScoreConfigId,
      template: scorer.template ?? "",
      params: cleanParams,
    },
  };
  if (normalized.description !== undefined) payload.description = normalized.description;
  if (scorer.producesScoreConfigVersion !== undefined) {
    payload.scorer.producesScoreConfigVersion = scorer.producesScoreConfigVersion;
  }

  return { payload, errors: [] };
}

export function prepareScorerImport(
  rawItems: unknown[],
  ctx: {
    existingScorerNames: ReadonlyArray<{ name: string }>;
    scoreConfigs: ReadonlyArray<ScoreConfig>;
    providers: ReadonlyArray<Provider>;
  },
): PreparedScorerImport {
  const existingNames = new Set(
    ctx.existingScorerNames.map((s) => (s.name ?? "").trim()).filter(Boolean),
  );

  const normalized = rawItems.map((r) => normalizeScorerInput(r));

  const nameCounts = new Map<string, number>();
  for (const n of normalized) {
    const name = typeof n?.name === "string" ? n.name.trim() : "";
    if (!name) continue;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  const items: PreparedScorerItem[] = normalized.map((n, i) =>
    validateScorer(n, {
      itemIndex: i,
      existingNames,
      nameCounts,
      scoreConfigs: ctx.scoreConfigs,
      providers: ctx.providers,
    }),
  );

  const errors = items.flatMap((i) => i.errors);
  return { items, errors, hasErrors: errors.length > 0 };
}
