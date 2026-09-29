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

import type { Ref } from "vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { Resource, Entity } from "@/ts/interfaces";
import type { I18nText } from "@/types/i18n";
import {
  DBM_MODULE_RESOURCE,
  DBM_VIEWER_STREAM_ROW_PERMS,
  DBM_VIEWER_STREAMS,
  DBM_VIEWER_TYPE_NODE_PERMS,
} from "@/components/iam/roles/dbmViewerPreset";
import {
  K8S_VIEWER_STREAM_ROW_PERMS,
  K8S_VIEWER_STREAMS,
  K8S_VIEWER_TYPE_NODE_PERMS,
} from "@/components/iam/roles/k8sViewerPreset";

// db_monitoring is checked as a plain GET (never LIST), and has no child
// entities for a wildcard relation to reach — unlike the `metrics` type node,
// AllowGet on it grants nothing beyond the module itself.
const DBM_MODULE_PERMS = ["AllowList", "AllowGet"] as const;

type PresetDeps = {
  permissionsState: { permissions: Resource[] };
  resourceMapper: Ref<{ [key: string]: Resource }>;
  heavyResourceEntities: Ref<{ [key: string]: Entity[] }>;
  /** Presets skip a grant the role already holds, since staging it again would revoke it. */
  grants: { has: (key: string) => boolean };
  permissionHashFor: (row: any, permission: string) => string;
  handlePermissionChange: (row: any, permission: string) => void;
  handlePermissionBatchChange: (
    changes: { row: any; permission: string; newValue: boolean }[],
  ) => void;
  /** Loads a node's children, which the stream presets need before they can tick a stream. */
  expandPermission: (resource: any) => Promise<unknown>;
  t: (key: string, named?: Record<string, unknown>) => I18nText;
};

/** The three starting points a new role can be seeded from, staged exactly as clicking would. */
export const useRolePresets = (deps: PresetDeps) => {
  const {
    permissionsState,
    resourceMapper,
    heavyResourceEntities,
    grants,
    permissionHashFor,
    handlePermissionChange,
    handlePermissionBatchChange,
    expandPermission,
    t,
  } = deps;

  // Seed AllowList + AllowGet on every visible top-level resource. Mirrors a
  // user manually checking those two columns, so the changes flow through the
  // normal added/removed-permission bookkeeping and the Save payload.
  const seedReadonlyPreset = () => {
    const readonlyPerms = ["AllowList", "AllowGet"];
    permissionsState.permissions.forEach((resource: Resource) => {
      readonlyPerms.forEach((perm) => {
        const permDetail = resource.permission?.[perm as "AllowList"];
        // Held grants are the source of truth: `value` survives an undo and would make the preset a no-op.
        if (!permDetail || !permDetail.show || grants.has(permissionHashFor(resource, perm)))
          return;
        permDetail.value = true;
        handlePermissionChange(resource, perm);
      });
    });
  };

  const collectVisibleReadGrants = (row: Entity, perms: readonly (keyof Entity["permission"])[]) =>
    perms
      .filter((perm) => {
        const permDetail = row.permission?.[perm];
        return (
          !!permDetail && permDetail.show && !grants.has(permissionHashFor(row, perm as string))
        );
      })
      .map((perm) => ({ row, permission: perm as string, newValue: true }));

  // Stream rows are lazily loaded CHILDREN of the `stream` resource, so both the
  // `stream` node and its `metrics` child must be expanded (which fetches the
  // org's streams) before any row exists to tick. `db_monitoring` is a separate,
  // module-level toggle resource with no entities of its own — it is ticked
  // directly off resourceMapper, no expand needed.
  const seedDbmViewerPreset = async () => {
    const changes: { row: any; permission: string; newValue: boolean }[] = [];

    const dbMonitoringResource = resourceMapper.value[DBM_MODULE_RESOURCE];
    if (dbMonitoringResource) {
      changes.push(...collectVisibleReadGrants(dbMonitoringResource, DBM_MODULE_PERMS));
    }

    const streamResource = resourceMapper.value["stream"];
    let matched = 0;
    if (streamResource) {
      if (!streamResource.expand) await expandPermission(streamResource);

      const metricsEntity = streamResource.entities?.find(
        (entity: Entity) => entity.name === "metrics",
      );
      if (metricsEntity) {
        if (!metricsEntity.expand) await expandPermission(metricsEntity);

        // `metrics.entities` only holds rows visible under the current filter, so seeding off it would silently miss streams.
        const rows = heavyResourceEntities.value["metrics"] ?? [];
        const curated = new Set(DBM_VIEWER_STREAMS);
        const matchedRows = rows.filter((row: Entity) => curated.has(row.name));
        matched = matchedRows.length;
        changes.push(
          ...matchedRows.flatMap((row: Entity) =>
            collectVisibleReadGrants(row, DBM_VIEWER_STREAM_ROW_PERMS),
          ),
        );

        // GET /{org}/streams is checked against `metrics:_all_<org>`, never the per-stream objects, and FGA's LIST relation does not accept ALLOW_GET; ALLOW_GET here would instead wildcard every metric stream in the org, so the type node is LIST-only.
        if (matchedRows.length) {
          changes.push(...collectVisibleReadGrants(metricsEntity, DBM_VIEWER_TYPE_NODE_PERMS));
        }
      }
    }

    if (changes.length) {
      handlePermissionBatchChange(changes);
    }

    reportDbmViewerSeeding(matched, DBM_VIEWER_STREAMS.length);
  };

  const reportDbmViewerSeeding = (matched: number, total: number) => {
    toast(
      matched
        ? { variant: "info", message: t("iam.editRole.dbmPresetSeeded", { matched, total }) }
        : { variant: "warning", message: t("iam.editRole.dbmPresetNoMatch", { total }) },
    );
  };

  // Stream rows are lazily loaded CHILDREN of the `stream` resource, so both the `stream` node and its `metrics` child must be expanded (which fetches the org's streams) before any row exists to tick.
  const seedK8sViewerPreset = async () => {
    const streamResource = resourceMapper.value["stream"];
    if (!streamResource) return;

    // expandPermission toggles, so only call it on a node that is still collapsed.
    if (!streamResource.expand) await expandPermission(streamResource);

    const metricsEntity = streamResource.entities?.find(
      (entity: Entity) => entity.name === "metrics",
    );
    if (!metricsEntity) return;

    if (!metricsEntity.expand) await expandPermission(metricsEntity);

    // `metrics.entities` only holds rows visible under the current filter, so seeding off it would silently miss streams.
    const rows = heavyResourceEntities.value["metrics"] ?? [];
    const curated = new Set(K8S_VIEWER_STREAMS);
    const matched = rows.filter((row: Entity) => curated.has(row.name));
    const changes = matched.flatMap((row: Entity) =>
      collectVisibleReadGrants(row, K8S_VIEWER_STREAM_ROW_PERMS),
    );

    // GET /{org}/streams is checked against `metrics:_all_<org>`, never the per-stream objects, and FGA's LIST relation does not accept ALLOW_GET; ALLOW_GET here would instead wildcard every metric stream in the org, so the type node is LIST-only.
    if (matched.length) {
      changes.push(...collectVisibleReadGrants(metricsEntity, K8S_VIEWER_TYPE_NODE_PERMS));
    }

    if (changes.length) {
      handlePermissionBatchChange(changes);
    }

    reportK8sViewerSeeding(matched.length, K8S_VIEWER_STREAMS.length);
  };

  const reportK8sViewerSeeding = (matched: number, total: number) => {
    toast(
      matched
        ? { variant: "info", message: t("iam.editRole.k8sPresetSeeded", { matched, total }) }
        : { variant: "warning", message: t("iam.editRole.k8sPresetNoMatch", { total }) },
    );
  };

  const applyPreset = async (presetId: string) => {
    if (presetId === "readonly") seedReadonlyPreset();
    else if (presetId === "dbm") await seedDbmViewerPreset();
    else if (presetId === "k8s") await seedK8sViewerPreset();
  };

  return {
    seedReadonlyPreset,
    collectVisibleReadGrants,
    seedDbmViewerPreset,
    reportDbmViewerSeeding,
    seedK8sViewerPreset,
    reportK8sViewerSeeding,
    applyPreset,
  };
};
