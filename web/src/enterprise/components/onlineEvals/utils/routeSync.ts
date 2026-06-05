// Pure helpers for the OnlineEvals.vue URL ↔ view-state machine. Extracted
// from the component so the state transitions are testable without mounting
// Vue / vuex / vue-router.
//
// The URL is the source of truth. Given a route query and the loaded data,
// computeViewState() returns what the page should be showing. The component
// is just a thin applier of that state.

import type {
  EvalJob,
  ScoreConfig,
  Scorer,
  ScorerType,
} from "@/services/online-evals.service";
import { entityId } from "./evalEntity";

export type ActiveTab = "quality" | "jobs" | "scorers" | "scoreConfigs";
export type FullPageEntity = Exclude<ActiveTab, "scoreConfigs" | "quality">;
export type AnyRow = EvalJob | Scorer | ScoreConfig;

export const VALID_TABS: ActiveTab[] = ["quality", "jobs", "scorers", "scoreConfigs"];

export function parseTabFromRoute(value: unknown): ActiveTab {
  if (typeof value === "string" && (VALID_TABS as string[]).includes(value)) {
    return value as ActiveTab;
  }
  return "quality";
}

export function rowIdOf(row: AnyRow, tab: ActiveTab): string {
  if (tab === "jobs") return String((row as EvalJob).id);
  return entityId(row as ScoreConfig | Scorer);
}

export type RowTab = Exclude<ActiveTab, "quality">;
export type RowsByTab = Record<RowTab, AnyRow[]>;

export function findRowById(
  tab: ActiveTab,
  id: string,
  rowsByTab: RowsByTab,
): AnyRow | null {
  if (tab === "quality") return null;
  const rows = rowsByTab[tab];
  if (tab === "jobs") {
    return (rows.find((r) => String((r as EvalJob).id) === id) as AnyRow) ?? null;
  }
  return (rows.find((r) => entityId(r as ScoreConfig | Scorer) === id) as AnyRow) ?? null;
}

// A discriminated union describing what the page should render. `none` means
// no drawer / dialog / form page is open — just the list. All other variants
// imply a specific UI element should be visible.
export type ViewState =
  | { kind: "none" }
  | { kind: "viewScoreConfig"; row: ScoreConfig }
  | { kind: "viewScorer"; row: Scorer }
  | { kind: "viewJob"; row: EvalJob }
  | { kind: "scoreConfigCreate" }
  | { kind: "scoreConfigEdit"; row: ScoreConfig }
  | { kind: "scorerTypeDialog" }
  | { kind: "scorerFormCreate"; scorerType: ScorerType }
  | { kind: "scorerFormEdit"; row: Scorer }
  | { kind: "jobFormCreate" }
  | { kind: "jobFormEdit"; row: EvalJob };

export interface RouteQuery {
  tab?: unknown;
  action?: unknown;
  id?: unknown;
  scorer_type?: unknown;
}

export function computeViewState(
  query: RouteQuery,
  rowsByTab: RowsByTab,
): ViewState {
  const tab = parseTabFromRoute(query.tab);
  const action = query.action;
  const id = query.id;

  if (action !== "add" && action !== "update" && action !== "view") {
    return { kind: "none" };
  }

  // View — read-only detail drawer for the active tab. Requires a known id.
  if (action === "view" && typeof id === "string") {
    const row = findRowById(tab, id, rowsByTab);
    if (!row) return { kind: "none" };
    if (tab === "scoreConfigs") return { kind: "viewScoreConfig", row: row as ScoreConfig };
    if (tab === "scorers") return { kind: "viewScorer", row: row as Scorer };
    if (tab === "jobs") return { kind: "viewJob", row: row as EvalJob };
    return { kind: "none" };
  }

  // Score configs use an in-page dialog (not the full-page form).
  if (tab === "scoreConfigs") {
    if (action === "add") return { kind: "scoreConfigCreate" };
    if (typeof id === "string") {
      const row = findRowById("scoreConfigs", id, rowsByTab) as ScoreConfig | null;
      if (row) return { kind: "scoreConfigEdit", row };
    }
    return { kind: "none" };
  }

  // Scorers — add flow has a type-picker dialog OR jumps straight into the
  // form page when ?scorer_type=… is already in the URL.
  if (tab === "scorers" && action === "add") {
    const type = query.scorer_type;
    if (typeof type === "string") {
      return { kind: "scorerFormCreate", scorerType: type as ScorerType };
    }
    return { kind: "scorerTypeDialog" };
  }

  // Jobs — add action goes to the full-page form.
  if (tab === "jobs" && action === "add") {
    return { kind: "jobFormCreate" };
  }

  // Edit — full-page form for the active tab.
  if (action === "update" && typeof id === "string") {
    const row = findRowById(tab, id, rowsByTab);
    if (!row) return { kind: "none" };
    if (tab === "scorers") return { kind: "scorerFormEdit", row: row as Scorer };
    if (tab === "jobs") return { kind: "jobFormEdit", row: row as EvalJob };
  }

  return { kind: "none" };
}

// Used by cross-navigation: from inside a detail drawer (e.g. ScorerDetail),
// jump to a different entity's drawer. The URL must change `tab`, `action`,
// and `id` together so the URL → state watcher syncs cleanly.
export function buildCrossNavigationQuery(
  currentQuery: Record<string, any>,
  targetTab: RowTab,
  targetId: string,
): Record<string, any> {
  return {
    ...currentQuery,
    tab: targetTab,
    action: "view",
    id: targetId,
  };
}
