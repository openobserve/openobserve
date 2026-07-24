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

// Preset catalog: the named empty-state scenarios used across the app. Each
// preset bundles an illustration, a tone (variant), the i18n keys for its copy,
// and one or more action cards (icon + title + description) rendered as
// QuickStart-style cards. A call site is a one-liner:
//
//   <OEmptyState preset="no-dashboards" @action="onAction" />
//
// The `action` event fires with the clicked action's `id` so the page can route
// (e.g. id === "import" vs id === "create"). Copy lives in i18n
// (en.json → emptyState.*), NOT inline, so it stays translatable.
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

import type { IllustrationName } from "./illustrations";

/** Tone of an empty state — drives subtle styling and signals intent. */
export type EmptyStateVariant = "create" | "no-results" | "error" | "neutral";

/** A rich action card (icon + title + description) shown in an empty state. */
export interface EmptyStateAction {
  /** Icon shown in the card. `(string & {})` admits dynamic names while keeping autocomplete. */
  icon: IconName | (string & {});
  /** i18n key for the card title. */
  titleKey: string;
  /** i18n key for the card description (optional). */
  descriptionKey?: string;
  /** Identifier emitted with the `action` event so call sites can route. */
  id: string;
}

export interface EmptyStatePreset {
  illustration: IllustrationName;
  variant: EmptyStateVariant;
  /** i18n key for the heading. */
  titleKey: string;
  /** i18n key for the supporting line (optional). */
  descriptionKey?: string;
  /** Action cards (icon + title + description). Rendered as QuickStart cards. */
  actions?: EmptyStateAction[];
}

export const emptyStatePresets = {
  // --- no results (a search/filter/time-range returned nothing) ------------
  "no-search-results": {
    illustration: "no-results",
    variant: "no-results",
    titleKey: "emptyState.noSearchResults.title",
    descriptionKey: "emptyState.noSearchResults.description",
    actions: [
      {
        id: "clear-filters",
        icon: "filter-list",
        titleKey: "emptyState.noSearchResults.action",
        descriptionKey: "emptyState.noSearchResults.actionDesc",
      },
    ],
  },
  "no-logs": {
    illustration: "logs",
    variant: "no-results",
    titleKey: "emptyState.noLogs.title",
    descriptionKey: "emptyState.noLogs.description",
    actions: [
      {
        id: "widen-range",
        icon: "schedule",
        titleKey: "emptyState.noLogs.action",
        descriptionKey: "emptyState.noLogs.actionDesc",
      },
    ],
  },
  "no-patterns": {
    illustration: "wave-bars",
    variant: "no-results",
    titleKey: "emptyState.noPatterns.title",
    descriptionKey: "emptyState.noPatterns.description",
  },
  "no-stream-selected": {
    illustration: "query",
    variant: "neutral",
    titleKey: "emptyState.noStreamSelected.title",
    descriptionKey: "emptyState.noStreamSelected.description",
  },
  "no-query-applied": {
    illustration: "query",
    variant: "neutral",
    titleKey: "emptyState.noQueryApplied.title",
    descriptionKey: "emptyState.noQueryApplied.description",
    actions: [
      {
        id: "run",
        icon: "play-arrow",
        titleKey: "emptyState.noQueryApplied.action",
        descriptionKey: "emptyState.noQueryApplied.actionDesc",
      },
    ],
  },

  // --- first-run "create your first X" -------------------------------------
  "no-dashboards": {
    illustration: "board",
    variant: "create",
    titleKey: "emptyState.noDashboards.title",
    descriptionKey: "emptyState.noDashboards.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noDashboards.action",
        descriptionKey: "emptyState.noDashboards.actionDesc",
      },
      {
        id: "import",
        icon: "upload-file",
        titleKey: "emptyState.noDashboards.import",
        descriptionKey: "emptyState.noDashboards.importDesc",
      },
      {
        id: "templates",
        icon: "dashboard-customize",
        titleKey: "emptyState.noDashboards.templates",
        descriptionKey: "emptyState.noDashboards.templatesDesc",
      },
    ],
  },
  "no-pipelines": {
    illustration: "pipeline",
    variant: "create",
    titleKey: "emptyState.noPipelines.title",
    descriptionKey: "emptyState.noPipelines.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noPipelines.action",
        descriptionKey: "emptyState.noPipelines.actionDesc",
      },
      {
        id: "import",
        icon: "upload-file",
        titleKey: "emptyState.noPipelines.import",
        descriptionKey: "emptyState.noPipelines.importDesc",
      },
    ],
  },
  "no-functions": {
    illustration: "function",
    variant: "create",
    titleKey: "emptyState.noFunctions.title",
    descriptionKey: "emptyState.noFunctions.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noFunctions.action",
        descriptionKey: "emptyState.noFunctions.actionDesc",
      },
    ],
  },
  "no-workflows": {
    illustration: "pipeline",
    variant: "create",
    titleKey: "emptyState.noWorkflows.title",
    descriptionKey: "emptyState.noWorkflows.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noWorkflows.action",
        descriptionKey: "emptyState.noWorkflows.actionDesc",
      },
    ],
  },

  // --- no ingestion / no data flowing in -----------------------------------
  "no-streams": {
    illustration: "connect",
    variant: "create",
    titleKey: "emptyState.noStreams.title",
    descriptionKey: "emptyState.noStreams.description",
    actions: [
      {
        id: "setup-ingestion",
        icon: "cloud-upload",
        titleKey: "emptyState.noStreams.action",
        descriptionKey: "emptyState.noStreams.actionDesc",
      },
    ],
  },

  // --- no synthetic monitors -------------------------------------------------
  "no-synthetic-monitors": {
    illustration: "browser-check",
    variant: "create",
    titleKey: "emptyState.noMonitors.title",
    descriptionKey: "emptyState.noMonitors.description",
    actions: [
      {
        id: "create-browser",
        icon: "open-in-browser",
        titleKey: "synthetics.newCheck.browser",
        descriptionKey: "synthetics.newCheck.browserDesc",
      },
      {
        id: "create-http",
        icon: "network-check",
        titleKey: "synthetics.newCheck.http",
        descriptionKey: "synthetics.newCheck.httpDesc",
      },
      {
        id: "create-tcp",
        icon: "bolt",
        titleKey: "synthetics.newCheck.tcp",
        descriptionKey: "synthetics.newCheck.tcpDesc",
      },
      {
        id: "create-tls",
        icon: "shield",
        titleKey: "synthetics.newCheck.tls",
        descriptionKey: "synthetics.newCheck.tlsDesc",
      },
      {
        id: "create-ssh",
        icon: "keyboard",
        titleKey: "synthetics.newCheck.ssh",
        descriptionKey: "synthetics.newCheck.sshDesc",
      },
    ],
  },

  // --- all caught up -------------------------------------------------------
  "no-alerts": {
    illustration: "alert",
    variant: "create",
    titleKey: "emptyState.noAlerts.title",
    descriptionKey: "emptyState.noAlerts.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noAlerts.action",
        descriptionKey: "emptyState.noAlerts.actionDesc",
      },
    ],
  },

  // --- failed to load ------------------------------------------------------
  "load-error": {
    illustration: "broken-panel",
    variant: "error",
    titleKey: "emptyState.loadError.title",
    descriptionKey: "emptyState.loadError.description",
    actions: [
      {
        id: "retry",
        icon: "refresh",
        titleKey: "emptyState.loadError.action",
        descriptionKey: "emptyState.loadError.actionDesc",
      },
    ],
  },

  // --- generic fallback (used by NoData / OTableEmpty when no preset given) -
  "no-data": {
    illustration: "box",
    variant: "neutral",
    titleKey: "emptyState.noData.title",
    descriptionKey: "emptyState.noData.description",
  },

  // --- additional list scenarios -------------------------------------------
  "no-traces": {
    illustration: "trace",
    variant: "no-results",
    titleKey: "emptyState.noTraces.title",
    descriptionKey: "emptyState.noTraces.description",
  },
  "no-service-graph": {
    illustration: "service-graph",
    variant: "no-results",
    titleKey: "emptyState.noServiceGraph.title",
    descriptionKey: "emptyState.noServiceGraph.description",
  },
  "no-services-catalog": {
    illustration: "services-catalog",
    variant: "no-results",
    titleKey: "emptyState.noServicesCatalog.title",
    descriptionKey: "emptyState.noServicesCatalog.description",
  },
  "no-search-history": {
    illustration: "history",
    variant: "neutral",
    titleKey: "emptyState.noSearchHistory.title",
    descriptionKey: "emptyState.noSearchHistory.description",
  },
  "no-search-jobs": {
    illustration: "schedule",
    variant: "neutral",
    titleKey: "emptyState.noSearchJobs.title",
    descriptionKey: "emptyState.noSearchJobs.description",
  },
  "no-users": {
    illustration: "users",
    variant: "create",
    titleKey: "emptyState.noUsers.title",
    descriptionKey: "emptyState.noUsers.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noUsers.action",
        descriptionKey: "emptyState.noUsers.actionDesc",
      },
    ],
  },
  "no-reports": {
    illustration: "report",
    variant: "create",
    titleKey: "emptyState.noReports.title",
    descriptionKey: "emptyState.noReports.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noReports.action",
        descriptionKey: "emptyState.noReports.actionDesc",
      },
    ],
  },
  "no-queries": {
    illustration: "query",
    variant: "neutral",
    titleKey: "emptyState.noQueries.title",
    descriptionKey: "emptyState.noQueries.description",
  },
  "no-incidents": {
    illustration: "check",
    variant: "neutral",
    titleKey: "emptyState.noIncidents.title",
    descriptionKey: "emptyState.noIncidents.description",
  },
  "no-service-accounts": {
    illustration: "users",
    variant: "create",
    titleKey: "emptyState.noServiceAccounts.title",
    descriptionKey: "emptyState.noServiceAccounts.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noServiceAccounts.action",
        descriptionKey: "emptyState.noServiceAccounts.actionDesc",
      },
    ],
  },
  "no-invitations": {
    illustration: "users",
    variant: "neutral",
    titleKey: "emptyState.noInvitations.title",
    descriptionKey: "emptyState.noInvitations.description",
  },
  "no-dashboards-in-folder": {
    illustration: "board",
    variant: "create",
    titleKey: "emptyState.noDashboardsInFolder.title",
    descriptionKey: "emptyState.noDashboardsInFolder.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noDashboardsInFolder.action",
        descriptionKey: "emptyState.noDashboardsInFolder.actionDesc",
      },
      {
        id: "import",
        icon: "upload-file",
        titleKey: "emptyState.noDashboardsInFolder.import",
        descriptionKey: "emptyState.noDashboardsInFolder.importDesc",
      },
      {
        id: "templates",
        icon: "dashboard-customize",
        titleKey: "emptyState.noDashboardsInFolder.templates",
        descriptionKey: "emptyState.noDashboardsInFolder.templatesDesc",
      },
    ],
  },
  "no-groups": {
    illustration: "users",
    variant: "create",
    titleKey: "emptyState.noGroups.title",
    descriptionKey: "emptyState.noGroups.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noGroups.action",
        descriptionKey: "emptyState.noGroups.actionDesc",
      },
    ],
  },
  "no-roles": {
    illustration: "users",
    variant: "create",
    titleKey: "emptyState.noRoles.title",
    descriptionKey: "emptyState.noRoles.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noRoles.action",
        descriptionKey: "emptyState.noRoles.actionDesc",
      },
    ],
  },
  "no-anomaly-configs": {
    illustration: "alert",
    variant: "create",
    titleKey: "emptyState.noAnomalyConfigs.title",
    descriptionKey: "emptyState.noAnomalyConfigs.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noAnomalyConfigs.action",
        descriptionKey: "emptyState.noAnomalyConfigs.actionDesc",
      },
    ],
  },
  "no-api-limits": {
    illustration: "box",
    variant: "neutral",
    titleKey: "emptyState.noApiLimits.title",
    descriptionKey: "emptyState.noApiLimits.description",
  },
  "no-role-limits": {
    illustration: "box",
    variant: "neutral",
    titleKey: "emptyState.noRoleLimits.title",
    descriptionKey: "emptyState.noRoleLimits.description",
  },
  "no-ingestion-tokens": {
    illustration: "box",
    variant: "create",
    titleKey: "emptyState.noIngestionTokens.title",
    descriptionKey: "emptyState.noIngestionTokens.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noIngestionTokens.action",
        descriptionKey: "emptyState.noIngestionTokens.actionDesc",
      },
    ],
  },
  "no-organizations": {
    illustration: "users",
    variant: "neutral",
    titleKey: "emptyState.noOrganizations.title",
    descriptionKey: "emptyState.noOrganizations.description",
  },
  "no-alert-destinations": {
    illustration: "alert",
    variant: "create",
    titleKey: "emptyState.noAlertDestinations.title",
    descriptionKey: "emptyState.noAlertDestinations.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noAlertDestinations.action",
        descriptionKey: "emptyState.noAlertDestinations.actionDesc",
      },
    ],
  },
  "no-pipeline-destinations": {
    illustration: "pipeline",
    variant: "create",
    titleKey: "emptyState.noPipelineDestinations.title",
    descriptionKey: "emptyState.noPipelineDestinations.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noPipelineDestinations.action",
        descriptionKey: "emptyState.noPipelineDestinations.actionDesc",
      },
    ],
  },
  "no-alert-templates": {
    illustration: "alert",
    variant: "create",
    titleKey: "emptyState.noAlertTemplates.title",
    descriptionKey: "emptyState.noAlertTemplates.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noAlertTemplates.action",
        descriptionKey: "emptyState.noAlertTemplates.actionDesc",
      },
    ],
  },
  "no-eval-templates": {
    illustration: "box",
    variant: "create",
    titleKey: "emptyState.noEvalTemplates.title",
    descriptionKey: "emptyState.noEvalTemplates.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noEvalTemplates.action",
        descriptionKey: "emptyState.noEvalTemplates.actionDesc",
      },
    ],
  },
  "no-enrichment-tables": {
    illustration: "box",
    variant: "create",
    titleKey: "emptyState.noEnrichmentTables.title",
    descriptionKey: "emptyState.noEnrichmentTables.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noEnrichmentTables.action",
        descriptionKey: "emptyState.noEnrichmentTables.actionDesc",
      },
    ],
  },
  "no-cipher-keys": {
    illustration: "box",
    variant: "create",
    titleKey: "emptyState.noCipherKeys.title",
    descriptionKey: "emptyState.noCipherKeys.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noCipherKeys.action",
        descriptionKey: "emptyState.noCipherKeys.actionDesc",
      },
    ],
  },
  "no-ai-toolsets": {
    illustration: "box",
    variant: "create",
    titleKey: "emptyState.noAiToolsets.title",
    descriptionKey: "emptyState.noAiToolsets.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noAiToolsets.action",
        descriptionKey: "emptyState.noAiToolsets.actionDesc",
      },
    ],
  },
  "no-llm-providers": {
    illustration: "box",
    variant: "create",
    titleKey: "emptyState.noLlmProviders.title",
    descriptionKey: "emptyState.noLlmProviders.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noLlmProviders.action",
        descriptionKey: "emptyState.noLlmProviders.actionDesc",
      },
    ],
  },
  "no-discovered-services": {
    illustration: "trace",
    variant: "neutral",
    titleKey: "emptyState.noDiscoveredServices.title",
    descriptionKey: "emptyState.noDiscoveredServices.description",
  },
  "no-nodes": {
    illustration: "box",
    variant: "neutral",
    titleKey: "emptyState.noNodes.title",
    descriptionKey: "emptyState.noNodes.description",
  },
  "no-source-maps": {
    illustration: "box",
    variant: "create",
    titleKey: "emptyState.noSourceMaps.title",
    descriptionKey: "emptyState.noSourceMaps.description",
    actions: [
      {
        id: "upload",
        icon: "upload-file",
        titleKey: "emptyState.noSourceMaps.action",
        descriptionKey: "emptyState.noSourceMaps.actionDesc",
      },
    ],
  },
  "no-backfill-jobs": {
    illustration: "box",
    variant: "neutral",
    titleKey: "emptyState.noBackfillJobs.title",
    descriptionKey: "emptyState.noBackfillJobs.description",
  },
  "no-regex-patterns": {
    illustration: "box",
    variant: "create",
    titleKey: "emptyState.noRegexPatterns.title",
    descriptionKey: "emptyState.noRegexPatterns.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noRegexPatterns.action",
        descriptionKey: "emptyState.noRegexPatterns.actionDesc",
      },
      {
        id: "import",
        icon: "upload-file",
        titleKey: "emptyState.noRegexPatterns.import",
        descriptionKey: "emptyState.noRegexPatterns.importDesc",
      },
    ],
  },
  "no-storage-config": {
    illustration: "box",
    variant: "create",
    titleKey: "emptyState.noStorageConfig.title",
    descriptionKey: "emptyState.noStorageConfig.description",
    actions: [
      {
        id: "configure",
        icon: "cloud-upload",
        titleKey: "emptyState.noStorageConfig.action",
        descriptionKey: "emptyState.noStorageConfig.actionDesc",
      },
    ],
  },
  "no-model-pricing": {
    illustration: "box",
    variant: "create",
    titleKey: "emptyState.noModelPricing.title",
    descriptionKey: "emptyState.noModelPricing.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noModelPricing.action",
        descriptionKey: "emptyState.noModelPricing.actionDesc",
      },
    ],
  },

  // LLM Insights dashboard — single empty-state shape (used for all three
  // "no data" cases: no LLM streams in the org, the active stream has no
  // gen_ai_* fields, or the window came up empty). Filtered branch is
  // intentionally not used (the page exposes no filter UI to clear).
  "no-llm-insights": {
    illustration: "constellation",
    variant: "create",
    titleKey: "emptyState.noLLMInsights.title",
    descriptionKey: "emptyState.noLLMInsights.description",
    actions: [
      {
        id: "instrument",
        icon: "auto-awesome",
        titleKey: "emptyState.noLLMInsights.action",
        descriptionKey: "emptyState.noLLMInsights.actionDesc",
      },
    ],
  },

  // LLM Sessions list — sibling of `no-llm-insights`. Same three "no data"
  // cases (no LLM streams in the org, the active stream has no
  // gen_ai_conversation_id, or the window returned no sessions). No
  // filtered branch — the page only has time + stream + page-size knobs.
  "no-llm-sessions": {
    illustration: "constellation",
    variant: "create",
    titleKey: "emptyState.noLLMSessions.title",
    descriptionKey: "emptyState.noLLMSessions.description",
    actions: [
      {
        id: "instrument",
        icon: "auto-awesome",
        titleKey: "emptyState.noLLMSessions.action",
        descriptionKey: "emptyState.noLLMSessions.actionDesc",
      },
    ],
  },

  // Evaluate-tab list presets. Each list has real search/filter widgets in
  // its toolbar, so `:filtered` is wired up — clicking "Clear filters" in
  // the filtered state resets the list's search + dropdown.
  "no-scorers": {
    illustration: "constellation",
    variant: "create",
    titleKey: "emptyState.noScorers.title",
    descriptionKey: "emptyState.noScorers.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noScorers.action",
        descriptionKey: "emptyState.noScorers.actionDesc",
      },
    ],
  },
  "no-eval-jobs": {
    illustration: "schedule",
    variant: "create",
    titleKey: "emptyState.noEvalJobs.title",
    descriptionKey: "emptyState.noEvalJobs.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noEvalJobs.action",
        descriptionKey: "emptyState.noEvalJobs.actionDesc",
      },
    ],
  },
  "no-score-configs": {
    illustration: "board",
    variant: "create",
    titleKey: "emptyState.noScoreConfigs.title",
    descriptionKey: "emptyState.noScoreConfigs.description",
    actions: [
      {
        id: "create",
        icon: "add",
        titleKey: "emptyState.noScoreConfigs.action",
        descriptionKey: "emptyState.noScoreConfigs.actionDesc",
      },
    ],
  },
  "no-pipeline-history": {
    illustration: "history",
    variant: "neutral",
    titleKey: "emptyState.noPipelineHistory.title",
    descriptionKey: "emptyState.noPipelineHistory.description",
  },
} satisfies Record<string, EmptyStatePreset>;

export type EmptyStatePresetName = keyof typeof emptyStatePresets;

// i18n key for the noun used in the filtered ("No {noun} found") copy, per
// preset. Presets not listed fall back to a generic "results".
export const presetNouns: Partial<Record<EmptyStatePresetName, string>> = {
  "no-logs": "emptyState.nouns.logs",
  "no-patterns": "emptyState.nouns.patterns",
  "no-dashboards": "emptyState.nouns.dashboards",
  "no-pipelines": "emptyState.nouns.pipelines",
  "no-workflows": "emptyState.nouns.workflows",
  "no-functions": "emptyState.nouns.functions",
  "no-streams": "emptyState.nouns.streams",
  "no-alerts": "emptyState.nouns.alerts",
  "no-incidents": "emptyState.nouns.incidents",
  "no-traces": "emptyState.nouns.traces",
  "no-search-history": "emptyState.nouns.searches",
  "no-search-jobs": "emptyState.nouns.searchJobs",
  "no-users": "emptyState.nouns.users",
  "no-reports": "emptyState.nouns.reports",
  "no-queries": "emptyState.nouns.queries",
  "no-service-accounts": "emptyState.nouns.serviceAccounts",
  "no-invitations": "emptyState.nouns.invitations",
  "no-dashboards-in-folder": "emptyState.nouns.dashboards",
  "no-groups": "emptyState.nouns.groups",
  "no-roles": "emptyState.nouns.roles",
  "no-anomaly-configs": "emptyState.nouns.anomalyConfigs",
  "no-api-limits": "emptyState.nouns.apiLimits",
  "no-role-limits": "emptyState.nouns.roleLimits",
  "no-ingestion-tokens": "emptyState.nouns.ingestionTokens",
  "no-organizations": "emptyState.nouns.organizations",
  "no-alert-destinations": "emptyState.nouns.alertDestinations",
  "no-pipeline-destinations": "emptyState.nouns.pipelineDestinations",
  "no-alert-templates": "emptyState.nouns.alertTemplates",
  "no-eval-templates": "emptyState.nouns.evalTemplates",
  "no-enrichment-tables": "emptyState.nouns.enrichmentTables",
  "no-cipher-keys": "emptyState.nouns.cipherKeys",
  "no-ai-toolsets": "emptyState.nouns.aiToolsets",
  "no-llm-providers": "emptyState.nouns.llmProviders",
  "no-source-maps": "emptyState.nouns.sourceMaps",
  "no-backfill-jobs": "emptyState.nouns.backfillJobs",
  "no-regex-patterns": "emptyState.nouns.regexPatterns",
  "no-scorers": "emptyState.nouns.scorers",
  "no-eval-jobs": "emptyState.nouns.evalJobs",
  "no-score-configs": "emptyState.nouns.scoreConfigs",
  "no-pipeline-history": "emptyState.nouns.pipelineHistory",
  "no-synthetic-monitors": "emptyState.nouns.monitors",
  "no-model-pricing": "emptyState.nouns.modelPricing",
};
