import type { Provider, ScoreConfig, Scorer, ScorerType } from "@/services/online-evals.service";

// Canonical export shape. Embeds BOTH the ID (for same-org re-import speed) and
// the name (for cross-org portability). The importer resolves IDs first, then
// falls back to names.
export interface ExportedScorer {
  name: string;
  description?: string | null;
  scorer: {
    type: ScorerType;
    producesScoreConfigId?: string;
    producesScoreConfigName?: string;
    producesScoreConfigVersion?: number | null;
    template: string;
    params: Record<string, any>;
  };
}

function scoreConfigEntityId(row: ScoreConfig): string {
  return String((row as any).entityId ?? (row as any).entity_id ?? row.id);
}

function valueOf(row: any, camel: string, snake: string): any {
  return row?.[camel] ?? row?.[snake];
}

// Look up score config by either entityId/entity_id or raw id. The Scorer row
// stores `producesScoreConfigId` which is typically the entityId of the score
// config, but we accept both for robustness.
function findScoreConfigFor(
  scoreConfigs: ReadonlyArray<ScoreConfig>,
  rawId: string,
): ScoreConfig | null {
  return (
    scoreConfigs.find((c) => scoreConfigEntityId(c) === rawId || String(c.id) === rawId) ?? null
  );
}

function findProviderById(providers: ReadonlyArray<Provider>, rawId: string): Provider | null {
  return providers.find((p) => String(p.id) === rawId) ?? null;
}

export function stripScorerForExport(
  row: Scorer,
  ctx: {
    scoreConfigs: ReadonlyArray<ScoreConfig>;
    providers: ReadonlyArray<Provider>;
  },
): ExportedScorer {
  const r = row as Record<string, any>;
  const name = typeof r.name === "string" ? r.name : "";
  const type = (valueOf(row, "scorerType", "scorer_type") || "llm_judge") as ScorerType;

  const scoreConfigId = String(
    valueOf(row, "producesScoreConfigId", "produces_score_config_id") || "",
  );
  const scoreConfigVersion = valueOf(
    row,
    "producesScoreConfigVersion",
    "produces_score_config_version",
  );

  const scorer: ExportedScorer["scorer"] = {
    type,
    template: typeof r.template === "string" ? r.template : "",
    params: {},
  };

  if (scoreConfigId) {
    scorer.producesScoreConfigId = scoreConfigId;
    const local = findScoreConfigFor(ctx.scoreConfigs, scoreConfigId);
    if (local?.name) scorer.producesScoreConfigName = local.name;
  }
  if (scoreConfigVersion !== undefined && scoreConfigVersion !== null) {
    scorer.producesScoreConfigVersion = scoreConfigVersion;
  }

  // Params: keep server shape but enrich provider_id with providerName for
  // cross-org portability. Leave other free-form keys (model, include_reasoning,
  // remote-specific URL/headers, etc.) untouched.
  const params = r.params && typeof r.params === "object" ? { ...r.params } : {};
  if (type === "llm_judge" && typeof params.provider_id === "string" && params.provider_id) {
    const prov = findProviderById(ctx.providers, params.provider_id);
    if (prov?.name) params.providerName = prov.name;
  }
  scorer.params = params;

  const out: ExportedScorer = { name, scorer };
  if (r.description !== undefined && r.description !== null) {
    out.description = r.description;
  }
  return out;
}

export function exportScorerFileName(row: Scorer): string {
  const r = row as Record<string, any>;
  const raw = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "scorer";
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${safe}.json`;
}

export function bulkExportFileName(date: Date = new Date()): string {
  const stamp = date.toISOString().split("T")[0];
  return `scorers-${stamp}.json`;
}
