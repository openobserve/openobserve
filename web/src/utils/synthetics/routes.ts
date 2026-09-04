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

/**
 * The single place that knows what a Synthetics URL carries.
 *
 * Every Synthetics page hop used to hand-build its own `router.push` target, and
 * they disagreed on both of the params that matter:
 *
 *  - `org_identifier` — the app-wide convention (see `AlertList.vue`,
 *    `CheckAlerts.vue`) is to stamp it from the store on every push. Synthetics
 *    stamped it on exactly one hop and read it back off `route.query` elsewhere,
 *    so a single link that omitted it broke the whole downstream chain: the
 *    header back button landed on `/synthetics` bare, and refreshing or sharing
 *    a create/edit URL silently resolved against the localStorage org instead of
 *    the one in the link.
 *
 *  - `folder` — the backend documents this as the folder **ID** (KSUID) and
 *    gates RBAC on it (`?folder=` in `src/api/management/src/request/synthetics/mod.rs`:
 *    "Current folder ID of the synthetic (for RBAC)"). The monitor-row hop was
 *    sending the display *name* instead, which is a different value for every
 *    non-default folder and degrades to the literal "—" when the folder list has
 *    not loaded. Consumers then fed that straight back to the API.
 *
 * Call sites name a destination; this module owns both params. Folder IDs and
 * org identifiers are omitted when empty rather than serialised as `""`, because
 * the server treats a present-but-empty `?folder=` as authoritative.
 */
import type { RouteLocationRaw } from "vue-router";
import type { SyntheticCheckType } from "@/types/synthetics";

/**
 * Ambient state every Synthetics URL carries. `orgIdentifier` comes from
 * `store.state.selectedOrganization.identifier`; `folderId` is the *ID*, never
 * the display name.
 */
export interface SyntheticsNavContext {
  orgIdentifier?: string;
  folderId?: string;
}

/** Drops empty/absent values so they never reach the URL as `?folder=`. */
function baseQuery(ctx: SyntheticsNavContext): Record<string, string> {
  const query: Record<string, string> = {};
  if (ctx.orgIdentifier) query.org_identifier = ctx.orgIdentifier;
  if (ctx.folderId) query.folder = ctx.folderId;
  return query;
}

/** The checks list. `section: "private"` opens the Private Locations tab. */
export function syntheticsListRoute(
  ctx: SyntheticsNavContext,
  opts: { section?: "checks" | "private" } = {},
): RouteLocationRaw {
  const query = baseQuery(ctx);
  if (opts.section === "private") query.section = "private";
  return { name: "synthetics", query };
}

/** The create wizard, pre-seeded with the folder the author came from. */
export function syntheticsCreateRoute(
  ctx: SyntheticsNavContext,
  type: SyntheticCheckType,
): RouteLocationRaw {
  return { name: "synthetics-add", query: { ...baseQuery(ctx), type } };
}

/** The edit wizard. `folderId` is required for the RBAC gate on load and save. */
export function syntheticsEditRoute(ctx: SyntheticsNavContext, id: string): RouteLocationRaw {
  return { name: "synthetics-edit", params: { id }, query: baseQuery(ctx) };
}

/** The full-page status-page editor. Carries the org so a shared link resolves it. */
export function statusPageEditRoute(ctx: SyntheticsNavContext, id: string): RouteLocationRaw {
  return { name: "synthetics-status-page-edit", params: { id }, query: baseQuery(ctx) };
}

/**
 * A monitor's results page.
 *
 * `name` is display-only — the page renders it as the title while the check
 * fetch is in flight, so the header is not blank on first paint.
 */
export function syntheticsResultsRoute(
  ctx: SyntheticsNavContext,
  id: string,
  opts: { name?: string; lastTriggeredAt?: number } = {},
): RouteLocationRaw {
  const query = baseQuery(ctx);
  if (opts.name) query.name = opts.name;
  if (opts.lastTriggeredAt && opts.lastTriggeredAt > 0) {
    query.last_triggered_at = String(opts.lastTriggeredAt);
  }
  return { name: "synthetic-monitor-results", params: { id }, query };
}

/** A private location's detail page. Back from it returns to the private tab. */
export function syntheticsPrivateLocationRoute(
  ctx: SyntheticsNavContext,
  id: string,
): RouteLocationRaw {
  return { name: "synthetic-private-location", params: { id }, query: baseQuery(ctx) };
}

/**
 * Read the ambient context back out of the current route.
 *
 * Used by pages that are themselves a hop in the chain: they forward what they
 * were given rather than re-deriving it. `org_identifier` is still preferred
 * from the store by callers that have it — this is the fallback for pages that
 * only ever see the URL.
 */
export function syntheticsNavContextFromRoute(route: {
  query: Record<string, unknown>;
}): SyntheticsNavContext {
  const org = route.query.org_identifier;
  const folder = route.query.folder;
  return {
    orgIdentifier: typeof org === "string" && org ? org : undefined,
    folderId: typeof folder === "string" && folder ? folder : undefined,
  };
}

/**
 * Resolve a folder ID to its display name using the Vuex-cached folder list.
 *
 * The URL carries the ID (the server needs it); headers want the name. Falls
 * back to the ID so a folder deleted since the link was made still renders
 * something meaningful instead of an empty subtitle.
 */
export function syntheticsFolderName(
  folders: { folderId: string; name: string }[],
  folderId: string | undefined,
): string {
  if (!folderId) return "";
  return folders.find((f) => f.folderId === folderId)?.name ?? folderId;
}
