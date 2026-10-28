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

import { computed, readonly, ref, type ComputedRef, type Ref } from "vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { Resource, Entity, PermissionType } from "@/ts/interfaces";
import { raw, type TranslateFn } from "@/types/i18n";
import { useRoleScopes } from "@/composables/iam/useRoleScopes";
import { splitGrantKey } from "@/composables/iam/useRoleGrants";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import { STREAM_PARENT_KEY } from "@/components/iam/roles/roleModules";
import { findCompanionGaps, type CompanionGap } from "@/components/iam/roles/roleCompanions";
import { JOB_PRESETS, type JobPreset } from "@/components/iam/roles/jobPresets";
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
import {
  RUM_ANALYTICS_RESOURCE,
  RUM_ANALYTICS_WRITE_PERMS,
  RUM_PRESETS,
  RUM_SOURCEMAPS_PERMS,
  RUM_SOURCEMAPS_RESOURCE,
  RUM_STREAMS,
  RUM_STREAM_ROW_PERMS,
  RUM_TYPE_NODE_PERMS,
  type RumPreset,
} from "@/components/iam/roles/rumPresets";

export type PresetSection = "builtin" | "job";

export type PresetInfo = {
  id: string;
  section: PresetSection;
  titleKey: string;
  descriptionKey: string;
  icon: string;
  tone: string;
};

export type PresetPreview = {
  status: "ready" | "loading" | "failed";
  /** Grant keys Add will stage, including saved keys now staged for removal. */
  adds: string[];
  /** The part of `adds` that undoes a staged removal of a saved grant, so it is no change to the payload. */
  restores: string[];
  /** Grants already effective, directly or through a wider scope. */
  skipped: number;
  stillMissing: CompanionGap[];
  noMatchingStreams?: boolean;
};

type Row = Resource | Entity;
type Grant = { row: Row; permission: PermissionType };

const READONLY_PERMS: readonly PermissionType[] = ["AllowList", "AllowGet"];

// db_monitoring is checked as a plain GET (never LIST), and has no child
// entities for a wildcard relation to reach — unlike the `metrics` type node,
// AllowGet on it grants nothing beyond the module itself.
const DBM_MODULE_PERMS: readonly PermissionType[] = ["AllowList", "AllowGet"];

const ACTION_ORDER = ["AllowAll", "AllowList", "AllowGet", "AllowPost", "AllowPut", "AllowDelete"];

// The ids AddRole's "Start from" and the `?preset=` link send.
const BUILTIN_PRESETS: Omit<JobPreset, "grants">[] = [
  {
    id: "readonly",
    titleKey: "iam.editRole.presetReadonlyTitle",
    descriptionKey: "iam.editRole.presetReadonlyDescription",
    icon: "visibility",
    tone: "other",
  },
  {
    id: "dbm",
    titleKey: "iam.editRole.presetDbmTitle",
    descriptionKey: "iam.editRole.presetDbmDescription",
    icon: "database",
    tone: "monitoring",
  },
  {
    id: "k8s",
    titleKey: "iam.editRole.presetK8sTitle",
    descriptionKey: "iam.editRole.presetK8sDescription",
    icon: "cloud",
    tone: "monitoring",
  },
  {
    id: "rum_viewer",
    titleKey: "iam.editRole.presetRumViewerTitle",
    descriptionKey: "iam.editRole.presetRumViewerDescription",
    icon: "devices",
    tone: "monitoring",
  },
  {
    id: "rum_editor",
    titleKey: "iam.editRole.presetRumEditorTitle",
    descriptionKey: "iam.editRole.presetRumEditorDescription",
    icon: "insights",
    tone: "data",
  },
];

// The stream type whose curated names each stream preset ticks; its list alone decides the preset's status.
const STREAM_TYPE_OF = new Map([
  ["dbm", "metrics"],
  ["k8s", "metrics"],
  ["rum_viewer", "logs"],
  ["rum_editor", "logs"],
]);

const toInfo = (preset: Omit<JobPreset, "grants">, section: PresetSection): PresetInfo => ({
  id: preset.id,
  section,
  titleKey: preset.titleKey,
  descriptionKey: preset.descriptionKey,
  icon: preset.icon,
  tone: preset.tone,
});

type PresetDeps = {
  permissionsState: { permissions: Resource[] };
  resourceMapper: Ref<{ [key: string]: Resource }>;
  heavyResourceEntities: Ref<{ [key: string]: Entity[] }>;
  /** Presets judge "already held" on the live grants, since staging a held key again would revoke it. */
  grants: {
    has: (key: string) => boolean;
    current: Ref<Set<string>>;
    removed: Ref<Record<string, unknown>>;
  };
  permissionHashFor: (row: Row, permission: string) => string;
  /** Unused since presets stage in one batch; optional so EditRole can stop passing it. */
  handlePermissionChange?: (row: Row, permission: string) => void;
  handlePermissionBatchChange: (
    changes: { row: Row; permission: string; newValue: boolean }[],
  ) => void;
  /** Opens a node and loads its children, which the `?preset=` link needs before it can tick a stream. */
  expandPermission: (resource: Row) => Promise<unknown>;
  /** Loads a node's children without opening it, so the panel can count the stream presets. */
  getResourceEntities?: (resource: Row) => Promise<unknown>;
  /** Reads a stream list with or without the loading toast; `force` skips the cached list. */
  getStreams?: (
    type: string,
    schema: boolean,
    notify?: boolean,
    force?: boolean,
  ) => Promise<unknown>;
  t: TranslateFn;
};

/** The starting points a role can be built from, previewed and staged exactly as clicking would. */
export const useRolePresets = (deps: PresetDeps) => {
  const {
    permissionsState,
    resourceMapper,
    heavyResourceEntities,
    grants,
    permissionHashFor,
    handlePermissionBatchChange,
    expandPermission,
    getResourceEntities,
    getStreams,
    t,
  } = deps;

  const isGranted = (node: Row, action: string) =>
    grants.current.value.has(permissionHashFor(node, action));

  // model.fga defines every action as `ALLOW_ALL or ALLOW_<ACTION>`.
  const holds = (node: Row, action: string) =>
    isGranted(node, action) || isGranted(node, "AllowAll");

  // Only each scope's `covers` and `node` are read here, so its labels are never shown.
  const { moduleScopes, streamTypeScopes } = useRoleScopes({
    resourceMapper,
    isGranted,
    resourceLabel: (key) => key,
    moduleLabel: raw,
    t,
    ACTION_ORDER,
  });

  // permissionHashFor writes `_all_<org>` on every catalogue node, so the org id is read back from the same source.
  const orgId = () => {
    const [node] = Object.values(resourceMapper.value);
    return node ? splitGrantKey(permissionHashFor(node, "")).entity.slice("_all_".length) : "";
  };

  const streamTypeNodes = () => resourceMapper.value[STREAM_PARENT_KEY]?.entities ?? [];

  const streamTypeNode = (type: string) => streamTypeNodes().find((node) => node.name === type);

  // Stream types and streams are the only preset rows under a wider scope; a module row has none.
  const widerScopes = (row: Row) => {
    if (streamTypeNodes().some((node) => node === row)) return moduleScopes(STREAM_PARENT_KEY);
    const typeNode = streamTypeNode(row.resourceName);
    return typeNode ? streamTypeScopes(typeNode) : [];
  };

  // The pane's lock rule (ModulePane isInherited) on the live grants, so a wider grant staged for removal no longer counts.
  const isEffective = ({ row, permission }: Grant) =>
    holds(row, permission) ||
    widerScopes(row).some(
      (scope) =>
        !!scope.node && scope.covers.includes(row.resourceName) && holds(scope.node, permission),
    );

  // A hidden checkbox is an action FGA rejects, and one rejected tuple fails the whole save.
  const visible = (row: Row | undefined, perms: readonly PermissionType[]): Grant[] =>
    row
      ? perms
          .filter((permission) => row.permission?.[permission]?.show)
          .map((permission) => ({ row, permission }))
      : [];

  const collectVisibleReadGrants = (row: Entity, perms: readonly PermissionType[]) =>
    visible(row, perms)
      .filter((grant) => !grants.has(permissionHashFor(grant.row, grant.permission)))
      .map((grant) => ({ ...grant, newValue: true }));

  // `typeNode.entities` holds only rows under the current filter, so curated names are matched on the full list.
  const curatedStreamGrants = (
    type: string,
    streams: string[],
    rowPerms: readonly PermissionType[],
    typePerms: readonly PermissionType[],
  ) => {
    const typeNode = streamTypeNode(type);
    const curated = new Set(streams);
    const rows = typeNode
      ? (heavyResourceEntities.value[type] ?? []).filter((row) => curated.has(row.name))
      : [];
    // GET /{org}/streams is checked against the type node and LIST rejects ALLOW_GET there; ALLOW_GET would wildcard every stream of the type, so the node is LIST-only and only after a match.
    return {
      matched: rows.length,
      grants: [
        ...rows.flatMap((row) => visible(row, rowPerms)),
        ...(rows.length ? visible(typeNode, typePerms) : []),
      ],
    };
  };

  // Module grants are staged even with no matching stream; the matched count feeds the toast.
  const resolvePreset = (presetId: string): { grants: Grant[]; matched?: number } | null => {
    if (presetId === "readonly")
      return {
        grants: permissionsState.permissions.flatMap((resource) =>
          visible(resource, READONLY_PERMS),
        ),
      };
    if (presetId === "dbm") {
      const streams = curatedStreamGrants(
        "metrics",
        DBM_VIEWER_STREAMS,
        DBM_VIEWER_STREAM_ROW_PERMS,
        DBM_VIEWER_TYPE_NODE_PERMS,
      );
      return {
        matched: streams.matched,
        grants: [
          ...visible(resourceMapper.value[DBM_MODULE_RESOURCE], DBM_MODULE_PERMS),
          ...streams.grants,
        ],
      };
    }
    if (presetId === "k8s")
      return curatedStreamGrants(
        "metrics",
        K8S_VIEWER_STREAMS,
        K8S_VIEWER_STREAM_ROW_PERMS,
        K8S_VIEWER_TYPE_NODE_PERMS,
      );
    if (presetId === "rum_viewer" || presetId === "rum_editor") {
      const streams = curatedStreamGrants(
        "logs",
        RUM_STREAMS,
        RUM_STREAM_ROW_PERMS,
        RUM_TYPE_NODE_PERMS,
      );
      return {
        matched: streams.matched,
        grants: [
          ...visible(resourceMapper.value[RUM_SOURCEMAPS_RESOURCE], RUM_SOURCEMAPS_PERMS),
          ...(RUM_PRESETS[presetId].withWrite
            ? visible(resourceMapper.value[RUM_ANALYTICS_RESOURCE], RUM_ANALYTICS_WRITE_PERMS)
            : []),
          ...streams.grants,
        ],
      };
    }
    const job = JOB_PRESETS.find((preset) => preset.id === presetId);
    return job
      ? {
          grants: Object.entries(job.grants).flatMap(([key, perms]) =>
            visible(resourceMapper.value[key], perms),
          ),
        }
      : null;
  };

  // Toggle revokes a held key and a repeated key cancels itself, so only new keys reach it, once each.
  const pendingGrants = (list: Grant[]) => {
    const seen = new Set<string>();
    const adds = list.filter((grant) => {
      const key = permissionHashFor(grant.row, grant.permission);
      if (seen.has(key)) return false;
      seen.add(key);
      return !isEffective(grant);
    });
    return { adds, unique: seen.size };
  };

  const isRestore = (key: string) => key in grants.removed.value;

  const stage = (list: Grant[]) => {
    const { adds } = pendingGrants(list);
    // Read before staging, since the toggle clears the removal.
    const restored = adds.filter((grant) =>
      isRestore(permissionHashFor(grant.row, grant.permission)),
    ).length;
    if (adds.length)
      handlePermissionBatchChange(adds.map((grant) => ({ ...grant, newValue: true })));
    return { added: adds.length - restored, restored };
  };

  const applying = ref(false);

  // A double click or a panel Add racing the `?preset=` seed must not run a second apply over the first.
  const locked = async (run: () => Promise<void> | void) => {
    if (applying.value) return;
    applying.value = true;
    try {
      await run();
    } finally {
      applying.value = false;
    }
  };

  // Respects the lock but never takes it: it is synchronous, so nothing can race it.
  const seedReadonlyPreset = () => {
    if (applying.value) return;
    stage(resolvePreset("readonly")?.grants ?? []);
  };

  // Per stream type, so a 403 on logs leaves the metrics presets usable.
  const streamStatus = ref<Record<string, "loading" | "loaded" | "failed">>({});
  const streamLoads = new Map<string, { load: Promise<void>; at: number }>();

  // The `?preset=` link opens the nodes so the ticked rows show; expandPermission toggles, so only a collapsed node is opened.
  const openStreamType = async (type: string) => {
    const streamResource = resourceMapper.value[STREAM_PARENT_KEY];
    if (!streamResource) return;
    if (!streamResource.expand) await expandPermission(streamResource);
    const typeNode = streamTypeNode(type);
    if (typeNode && !typeNode.expand) await expandPermission(typeNode);
  };

  const reportDbmViewerSeeding = (matched: number, total: number) => {
    toast(
      matched
        ? { variant: "info", message: t("iam.editRole.dbmPresetSeeded", { matched, total }) }
        : { variant: "warning", message: t("iam.editRole.dbmPresetNoMatch", { total }) },
    );
  };

  const reportK8sViewerSeeding = (matched: number, total: number) => {
    toast(
      matched
        ? { variant: "info", message: t("iam.editRole.k8sPresetSeeded", { matched, total }) }
        : { variant: "warning", message: t("iam.editRole.k8sPresetNoMatch", { total }) },
    );
  };

  // A loaded list is the one the panel previewed, so Add stages from it before opening the type, whose reload could add streams the button never counted; the link has no list yet, so it opens first.
  const stageStreamPreset = async (presetId: string, type: string) => {
    const previewed = streamStatus.value[type] === "loaded";
    if (!previewed) await openStreamType(type);
    const resolved = resolvePreset(presetId);
    stage(resolved?.grants ?? []);
    if (previewed) await openStreamType(type);
    return resolved;
  };

  const seedDbmViewerPreset = () =>
    locked(async () => {
      const resolved = await stageStreamPreset("dbm", "metrics");
      reportDbmViewerSeeding(resolved?.matched ?? 0, DBM_VIEWER_STREAMS.length);
    });

  const seedK8sViewerPreset = () =>
    locked(async () => {
      const resolved = await stageStreamPreset("k8s", "metrics");
      // With no metrics node there is no stream list to match, so there is nothing to report.
      if (!streamTypeNode("metrics")) return;
      reportK8sViewerSeeding(resolved?.matched ?? 0, K8S_VIEWER_STREAMS.length);
    });

  const seedRumPreset = (preset: RumPreset) =>
    locked(async () => {
      const resolved = await stageStreamPreset(preset, "logs");
      const total = RUM_STREAMS.length;
      toast(
        resolved?.matched
          ? {
              variant: "info",
              message: t("iam.editRole.rumPresetSeeded", { matched: resolved.matched, total }),
            }
          : { variant: "warning", message: t("iam.editRole.rumPresetNoMatch", { total }) },
      );
    });

  const applyPreset = (presetId: string, opts: { announce?: boolean } = {}): Promise<void> => {
    if (presetId === "dbm") return seedDbmViewerPreset();
    if (presetId === "k8s") return seedK8sViewerPreset();
    if (presetId === "rum_viewer" || presetId === "rum_editor") return seedRumPreset(presetId);
    return locked(() => {
      const resolved = resolvePreset(presetId);
      if (!resolved) return;
      const { added, restored } = stage(resolved.grants);
      const preset = [...BUILTIN_PRESETS, ...JOB_PRESETS].find((item) => item.id === presetId);
      const count = added || restored;
      if (!opts.announce || !count || !preset) return;
      // An undone removal is no change to the saved role, so it is never counted as added.
      toast({
        variant: "success",
        message: t(added ? "iam.editRole.presetApplied" : "iam.editRole.presetRestored", {
          title: t(preset.titleKey),
          permissions: t("iam.editRole.presetPermissionCount", { count }, count),
        }),
      });
    });
  };

  // A job preset needing a module this org lacks would stage a tuple FGA rejects, so it is not offered.
  const presets: ComputedRef<PresetInfo[]> = computed(() => [
    ...BUILTIN_PRESETS.map((preset) => toInfo(preset, "builtin")),
    ...JOB_PRESETS.filter((preset) =>
      Object.keys(preset.grants).every((key) => resourceMapper.value[key]),
    ).map((preset) => toInfo(preset, "job")),
  ]);

  const loadStreamType = async (type: string, force: boolean) => {
    streamStatus.value[type] = "loading";
    try {
      const streamResource = resourceMapper.value[STREAM_PARENT_KEY];
      if (streamResource) {
        if (!getResourceEntities) throw new Error("No entity loader to read the stream lists");
        await getResourceEntities(streamResource);
        // A cold read toasts "Please wait while loading streams"; a quiet read first lets the loader answer from cache.
        await getStreams?.(type, false, false, force);
        const typeNode = streamTypeNode(type);
        // The loader skips a node that already has rows, so they are emptied to rebuild from this read; checkboxes come from the grant store.
        if (typeNode) {
          typeNode.entities = [];
          await getResourceEntities(typeNode);
        }
      }
      streamStatus.value[type] = "loaded";
    } catch {
      // A 403 on stream List lands here too: the badge shows nothing and the next call retries.
      streamStatus.value[type] = "failed";
    }
  };

  // Streams ingested after a lookup that matched none, or after the stream list query went stale, show only on a fresh read.
  const needsFreshRead = (type: string, at: number) =>
    Date.now() - at >= MEDIUM_STALE_TIME ||
    [...STREAM_TYPE_OF].some(([id, of]) => of === type && !resolvePreset(id)?.matched);

  /** Loads the metrics and logs lists the stream presets match against, without a toast; a failed, stale or matchless one reads again past the cache. */
  const loadPresetStreams = async () => {
    await Promise.all(
      [...new Set(STREAM_TYPE_OF.values())].map((type) => {
        const last = streamLoads.get(type);
        const status = streamStatus.value[type];
        if (
          last &&
          (status === "loading" || (status === "loaded" && !needsFreshRead(type, last.at)))
        )
          return last.load;
        const load = loadStreamType(type, !!last);
        streamLoads.set(type, { load, at: Date.now() });
        return load;
      }),
    );
  };

  // Computed on call, never cached, so a grant changed elsewhere shows on the next render.
  const previewPreset = (presetId: string): PresetPreview => {
    const streamType = STREAM_TYPE_OF.get(presetId);
    const listStatus = streamType ? streamStatus.value[streamType] : "loaded";
    if (listStatus !== "loaded")
      return {
        status: listStatus === "failed" ? "failed" : "loading",
        adds: [],
        restores: [],
        skipped: 0,
        stillMissing: [],
      };
    const resolved = resolvePreset(presetId);
    const { adds, unique } = pendingGrants(resolved?.grants ?? []);
    const addKeys = adds.map((grant) => permissionHashFor(grant.row, grant.permission));
    return {
      status: "ready",
      adds: addKeys,
      restores: addKeys.filter(isRestore),
      skipped: unique - addKeys.length,
      stillMissing: findCompanionGaps(
        new Set([...grants.current.value, ...addKeys]),
        new Set(Object.keys(resourceMapper.value)),
        orgId(),
      ),
      ...(streamType ? { noMatchingStreams: !resolved?.matched } : {}),
    };
  };

  return {
    seedReadonlyPreset,
    collectVisibleReadGrants,
    seedDbmViewerPreset,
    reportDbmViewerSeeding,
    seedK8sViewerPreset,
    reportK8sViewerSeeding,
    seedRumPreset,
    applyPreset,
    presets,
    previewPreset,
    loadPresetStreams,
    /** True while a preset is being staged; Add stays disabled meanwhile. */
    applyingPreset: readonly(applying),
  };
};
