// Copyright 2026 OpenObserve Inc.
//
// dashboardTerraform.ts — renders a dashboard as an `openobserve_dashboard`
// resource for the OpenObserve Terraform provider
// (https://registry.terraform.io/providers/openobserve/openobserve/latest).
//
// A dashboard maps far more simply than an alert or an SLO: the provider takes
// the whole document as one `dashboard_json` attribute and reads the title,
// description, version and owner back out of it. So there is no attribute
// mapping to do here, and the work is instead about what to STRIP.
//
// An exported dashboard carries server-assigned bookkeeping — the id it was
// stored under, who created it, when it was updated, the hash of the version the
// server holds. None of that describes the dashboard; it describes this copy of
// it. Leaving it in would produce a configuration that claims an identity
// belonging to something else, and `dashboard_id`, `hash`, `owner`, `version`
// and `updated_at` are all computed in the provider schema anyway, so the server
// would ignore them on the way in and Terraform would report them as drift on
// the way back out.
//
// The JSON is embedded with `jsonencode()` rather than a heredoc. A heredoc
// would preserve the server's formatting, but any `${` inside a panel query —
// which is how dashboard variables are written — would be read by Terraform as
// an interpolation and either fail to parse or silently substitute. `jsonencode`
// of a parsed object has no template semantics at all, so a dashboard full of
// `$${var}` survives the round trip.
//
// One consequence worth knowing about, because it looks like a bug and is not.
// After `terraform import`, state holds the document as the SERVER stores it,
// which includes the `dashboardId` the server wrote into it. The provider
// documents that `dashboardId` should be left out of the configuration — it is
// filled in on create and preserved on update — so a correct configuration is
// always missing that one key, and the first plan after an import reports a
// single in-place update to reconcile it. Applying it changes nothing the
// server cares about and the diff does not come back. Keeping the id in the
// document would silence that one line at the cost of a configuration that
// claims another organization's identity the moment it is reused, which is a
// far worse trade. The composite alert resource has the same shape of one-time
// reconcile after import, for the same reason.

import type {
  ImportTarget,
  TerraformExport,
  TerraformIdentityOptions,
  TerraformUnsupportedItem,
} from "@/utils/terraform/hcl";
import {
  INDENT,
  attr,
  document,
  importTarget,
  literal,
  quote,
  resourceBlock,
  resourceLabel,
} from "@/utils/terraform/hcl";
import type { Node } from "@/utils/terraform/hcl";

export interface DashboardTerraformOptions extends TerraformIdentityOptions {
  /** Folder the dashboards came from. Emitted only when it is not the default. */
  folderId?: string;
}

/**
 * Server-assigned fields that identify this copy rather than describe the
 * dashboard. All of them are computed in the provider schema.
 */
const SERVER_FIELDS = [
  "dashboardId",
  "dashboard_id",
  "hash",
  "owner",
  "created",
  "created_at",
  "updated_at",
  "updatedAt",
  "role",
  "folder_id",
  "folderId",
  "version_hash",
] as const;

/** The dashboard document with this-copy bookkeeping removed. */
export function stripServerFields(dashboard: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dashboard)) {
    if ((SERVER_FIELDS as readonly string[]).includes(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * A dashboard payload can arrive either bare or wrapped in the envelope the list
 * and get endpoints use (`{ v5: {...}, version: 5 }`, `{ dashboard: {...} }`).
 * The provider wants the document itself.
 */
export function unwrapDashboard(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.dashboard && typeof payload.dashboard === "object") {
    return payload.dashboard as Record<string, unknown>;
  }
  // Versioned envelopes key the document under `v1`…`v5` and send EVERY version
  // slot, with the unused ones null: a v5 dashboard arrives as
  // `{v1: null, v2: null, v3: null, v4: null, v5: {…}}`. So the populated slot
  // has to be selected, not the first one that matches the name pattern — taking
  // `v1` and finding it null was silently reducing a real dashboard to "no title".
  const versioned = Object.keys(payload)
    .filter((key) => /^v\d+$/.test(key))
    .find((key) => payload[key] && typeof payload[key] === "object");
  if (versioned) return payload[versioned] as Record<string, unknown>;
  return payload;
}

/** The dashboard's own id, wherever the payload happens to carry it. */
export function dashboardIdOf(payload: Record<string, unknown>): string {
  const inner = unwrapDashboard(payload);
  for (const source of [payload, inner]) {
    for (const key of ["dashboardId", "dashboard_id"]) {
      const value = (source as Record<string, unknown>)[key];
      if (typeof value === "string" && value !== "") return value;
    }
  }
  return "";
}

function dashboardTitle(dashboard: Record<string, unknown>): string {
  return String(dashboard.title ?? "");
}

function dashboardResource(
  dashboard: Record<string, unknown>,
  label: string,
  options: DashboardTerraformOptions,
): string {
  const folderId = options.folderId && options.folderId !== "default" ? options.folderId : null;

  const nodes: Node[] = [
    ...attr("folder_id", folderId === null ? null : quote(folderId)),
    // The whole document, as the provider's one required attribute. Rendered at
    // one indent level in, matching the attribute it belongs to.
    ...attr("dashboard_json", `jsonencode(${literal(dashboard, INDENT)})`),
  ];

  return resourceBlock("openobserve_dashboard", label, nodes);
}

/**
 * A dashboard the provider could not accept. The document is the whole resource,
 * so an empty one has nothing to apply, and the title is what names the resource
 * both in the provider and in the generated label.
 */
function isIncomplete(dashboard: Record<string, unknown>): boolean {
  return !dashboardTitle(dashboard) || Object.keys(dashboard).length === 0;
}

/**
 * Converts dashboard payloads into `openobserve_dashboard` resources.
 *
 * Dashboards that cannot be expressed are reported in `unsupported` rather than
 * rendered as something that would not apply.
 */
export function dashboardsToTerraform(
  dashboards: Record<string, unknown>[],
  options: DashboardTerraformOptions = {},
): TerraformExport {
  const used = new Set<string>();
  const unsupported: TerraformUnsupportedItem[] = [];
  const resources: string[] = [];
  const imports: ImportTarget[] = [];

  dashboards.forEach((payload, index) => {
    if (!payload || typeof payload !== "object") return;
    const dashboard = stripServerFields(unwrapDashboard(payload));

    if (isIncomplete(dashboard)) {
      unsupported.push({ name: dashboardTitle(dashboard), reason: "incomplete" });
      return;
    }

    const label = resourceLabel(dashboardTitle(dashboard), used, "dashboard");
    resources.push(dashboardResource(dashboard, label, options));
    // The id is taken from the payload when the caller did not supply one, since
    // a dashboard document carries its own id far more often than an alert does.
    const id = options.ids?.[index] ?? dashboardIdOf(payload);
    imports.push(...importTarget("openobserve_dashboard", label, options.orgId, id));
  });

  return {
    hcl: document(resources, imports, options.orgId ?? ""),
    unsupported,
    droppedFields: [],
  };
}
