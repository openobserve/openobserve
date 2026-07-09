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

// Service-entity classification — the single source of truth for how a trace
// entity is categorised (Service / Datastore / Queue / External / RPC) in the
// UI. This is the TypeScript mirror of the Rust `classify_entity`
// (o2-enterprise .../service_graph/classification.rs); both are kept in sync by
// the SAME test vector (`__fixtures__/classification_cases.json`).
//
// Rule (data-verified against otel_demo + the traces_tester topology matrix):
// a name that emits its own spans is a Service (any inferred type on it is a
// false positive — a "collision"); otherwise it is classified by its inferred
// type. RPC targets are KEPT as dependency nodes (never dropped) so genuine
// uninstrumented gRPC backends are never hidden. Unknown non-empty inferred
// types default to External (a dependency), never Service.

/** The kind an entity is classified into. RPC is a first-class dependency. */
export type EntityKind =
  | "service"
  | "datastore"
  | "queue"
  | "external"
  | "rpc";

/** The inferred types we branch on explicitly. */
export type KnownInferType = "database" | "queue" | "external" | "rpc";

/**
 * Classify a trace entity.
 *
 * @param isRealService true when the entity emits its own spans (a real
 *   instrumented service). Wins first: a real service that is also inferred (a
 *   collision) stays a Service.
 * @param inferServiceType the entity's `infer_service_type`
 *   (`database`/`queue`/`external`/`rpc`), or null/undefined/empty when none.
 *   Note the backend stores `database` (not `datastore`) as the raw type; this
 *   function maps it to the `datastore` kind. Unknown non-empty values fall
 *   through to `external` (a dependency), never `service`.
 */
export function classifyEntity(
  isRealService: boolean,
  inferServiceType?: KnownInferType | (string & {}) | null,
): EntityKind {
  if (isRealService) return "service";
  const t = (inferServiceType ?? "").trim();
  switch (t) {
    case "database":
      return "datastore";
    case "queue":
      return "queue";
    case "external":
      return "external";
    case "rpc":
      return "rpc";
    case "":
      // No inferred type at all → a bare service.
      return "service";
    default:
      // Unknown, non-empty inferred type → safe default: a dependency.
      return "external";
  }
}
