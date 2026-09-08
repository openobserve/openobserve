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

export interface AliasEntry {
  /** What the user types (folded: lowercase, no diacritics). */
  trigger: string;
  /** Item id the trigger resolves to. */
  target: string;
  /** Minimum typed length before the trigger fires; defaults to the trigger length, capped at 3. */
  minLen?: number;
}

// Datadog-style alias index: synonyms and common typos that substring matching cannot catch.
export const PALETTE_ALIASES: AliasEntry[] = [
  { trigger: "sql", target: "page:logs" },
  { trigger: "search", target: "page:logs" },
  { trigger: "lgos", target: "page:logs" },
  { trigger: "lgs", target: "page:logs" },
  { trigger: "logz", target: "page:logs" },
  { trigger: "promql", target: "page:metrics" },
  { trigger: "prometheus", target: "page:metrics" },
  { trigger: "metrcis", target: "page:metrics" },
  { trigger: "apm", target: "page:traces" },
  { trigger: "spans", target: "page:traces" },
  { trigger: "tarces", target: "page:traces" },
  { trigger: "svc graph", target: "page:traces:service-graph" },
  { trigger: "service map", target: "page:traces:service-graph" },
  { trigger: "catalog", target: "page:traces:services-catalog" },
  { trigger: "k8s", target: "page:logstreams" },
  { trigger: "index", target: "page:logstreams" },
  { trigger: "schema", target: "page:logstreams" },
  { trigger: "alrets", target: "page:alertList" },
  { trigger: "rule", target: "page:alertList" },
  { trigger: "monitor", target: "page:alertList" },
  { trigger: "dahsboard", target: "page:dashboards" },
  { trigger: "dashbaord", target: "page:dashboards" },
  { trigger: "dash", target: "page:dashboards" },
  { trigger: "vrl", target: "page:functionList" },
  { trigger: "func", target: "page:functionList" },
  { trigger: "etl", target: "page:pipelines" },
  { trigger: "rbac", target: "page:iam" },
  { trigger: "roles", target: "page:iam" },
  { trigger: "users", target: "page:iam" },
  { trigger: "token", target: "page:iam" },
  { trigger: "sso", target: "page:settings" },
  { trigger: "smtp", target: "page:settings" },
  { trigger: "config", target: "page:settings" },
  { trigger: "ingest", target: "page:ingestion" },
  { trigger: "otel", target: "page:ingestion" },
  { trigger: "collector", target: "page:ingestion" },
  { trigger: "dark", target: "action:toggleTheme" },
  { trigger: "light", target: "action:toggleTheme" },
  { trigger: "theme", target: "action:toggleTheme" },
  { trigger: "keys", target: "action:shortcuts" },
  { trigger: "hotkeys", target: "action:shortcuts" },
  { trigger: "help", target: "external:docs" },
  { trigger: "slo", target: "page:sloList" },
  { trigger: "error budget", target: "page:sloList" },
  { trigger: "incident", target: "page:incidentList" },
  { trigger: "oncall", target: "page:incidentList" },
  { trigger: "report", target: "page:reports" },
  { trigger: "pdf", target: "page:reports" },
  { trigger: "rum", target: "page:RUM" },
  { trigger: "session", target: "page:RUM" },
  { trigger: "browser", target: "page:RUM" },
  { trigger: "synthetic", target: "page:synthetics" },
  { trigger: "uptime", target: "page:synthetics" },
  { trigger: "ping", target: "page:synthetics" },
  { trigger: "enrich", target: "page:enrichmentTables" },
  { trigger: "lookup", target: "page:enrichmentTables" },
  { trigger: "csv", target: "page:enrichmentTables" },
  { trigger: "workflow", target: "page:workflows" },
  { trigger: "automation", target: "page:workflows" },
  { trigger: "destination", target: "page:alertDestinations" },
  { trigger: "webhook", target: "page:alertDestinations" },
  { trigger: "slack", target: "page:alertDestinations" },
  { trigger: "template", target: "page:alertTemplates" },
  { trigger: "library", target: "page:alertLibrary" },
  { trigger: "catalog", target: "page:alertLibrary" },
  { trigger: "db", target: "page:dbmDatabases", minLen: 2 },
  { trigger: "postgres", target: "page:dbmDatabases" },
  { trigger: "mysql", target: "page:dbmDatabases" },
  { trigger: "query stats", target: "page:dbmDatabases" },
  { trigger: "llm", target: "page:aiObservability" },
  { trigger: "agent", target: "page:aiObservability" },
  { trigger: "eval", target: "page:aiObservability" },
  { trigger: "home", target: "page:home" },
  { trigger: "start", target: "page:home" },
  { trigger: "import", target: "action:importDashboard" },
  { trigger: "json", target: "action:importDashboard" },
  { trigger: "new alert", target: "action:newAlert" },
  { trigger: "create alert", target: "action:newAlert" },
  { trigger: "new dashboard", target: "action:newDashboard" },
  { trigger: "create dashboard", target: "action:newDashboard" },
  { trigger: "docs", target: "external:docs" },
  { trigger: "manual", target: "external:docs" },
  { trigger: "community", target: "external:slack" },
];

function minLenFor(entry: AliasEntry): number {
  return entry.minLen ?? Math.min(3, entry.trigger.length);
}

/** Item ids whose alias trigger starts with the folded query (or equals it). */
export function matchAliases(folded: string, aliases: AliasEntry[] = PALETTE_ALIASES): Set<string> {
  const hits = new Set<string>();
  if (!folded) return hits;
  for (const entry of aliases) {
    if (folded.length < minLenFor(entry)) continue;
    if (entry.trigger.startsWith(folded) || folded.startsWith(entry.trigger))
      hits.add(entry.target);
  }
  return hits;
}
