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

import { useMutation } from "@tanstack/vue-query";
import { useStore } from "vuex";

import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { fileForInstall } from "@/components/alertLibrary/libraryTunables";
import { useLibraryInstall } from "@/components/alertLibrary/useLibraryInstall";
import { readQuery } from "@/composables/query/readQuery";
import {
  alertDetailQuery,
  alertsByTagsQuery,
  alertsListQuery,
  deleteAlertMutation,
} from "@/services/alerts.queries";
import {
  createFolderMutation,
  deleteFolderMutation,
  permittedFoldersQuery,
} from "@/services/common.queries";
import {
  createDashboardMutation,
  dashboardDetailQuery,
  dashboardsByFolderQuery,
  deleteDashboardMutation,
} from "@/services/dashboards.queries";
import {
  createSavedViewMutation,
  deleteSavedViewMutation,
  savedViewDetailQuery,
  savedViewsQuery,
} from "@/services/saved_views.queries";
import { viewTypeOf } from "@/services/saved_views";
import { streamNameListQuery, streamSchemaQuery } from "@/services/stream.queries";
import type { AlertLibraryEntry } from "@/types/alertLibrary";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import { buildSavedViewPayload } from "@/utils/logs/savedViewPayload";
import { getUUID } from "@/utils/uuid";

import {
  StarterPackPermissionError,
  type PackFolderType,
  type PackDashboard,
  type PackInstallOptions,
  type PackInstallRecord,
  type PackKeptItem,
  type PackKeptReason,
  type PackNotIncludedItem,
  type PackPreview,
  type PackRecordItem,
  type PackRemovalResult,
  type StarterPack,
} from "./types";
import { dashboardStreams, fitDashboard, type DashboardFit } from "./dashboardFit";
import { contentHash, useInstallRecords } from "./useInstallRecords";

interface FoundItem {
  id: string;
  folderId?: string;
}

interface PackItemAdapter {
  lookup: () => Promise<FoundItem | null>;
  create: () => Promise<void>;
  /** The user-editable body the source hash covers. */
  snapshot: (found: FoundItem) => Promise<unknown>;
  remove: (found: FoundItem) => Promise<void>;
}

const FOLDER_TYPES: PackFolderType[] = ["dashboards", "alerts"];

// Server bookkeeping that moves without anyone editing the alert.
const ALERT_VOLATILE_FIELDS = [
  "updated_at",
  "last_edited_by",
  "last_triggered_at",
  "last_satisfied_at",
];

const inFlight = new Map<string, Promise<PackInstallRecord>>();

const isNotFound = (error: any): boolean => error?.response?.status === 404;

// The backend stores tags lowercased, and a filter on any other case matches nothing.
const alertTags = (packId: string, entryId: string): string[] => [
  `pack:${packId}`.toLowerCase(),
  `library:${entryId}`.toLowerCase(),
];

const folderIdOf = (items: PackRecordItem[], type: PackFolderType): string | undefined =>
  items.find((item) => item.kind === "folder" && item.itemId === type)?.id;

const packItems = (pack: StarterPack): PackRecordItem[] => {
  const pending = { status: "pending" } as const;
  return [
    ...FOLDER_TYPES.map((itemId) => ({ ...pending, kind: "folder" as const, itemId })),
    ...pack.dashboards.map(({ id }) => ({ ...pending, kind: "dashboard" as const, itemId: id })),
    ...pack.alerts.map((itemId) => ({ ...pending, kind: "alert" as const, itemId })),
    ...pack.savedViews.map(({ id }) => ({ ...pending, kind: "savedView" as const, itemId: id })),
  ];
};

export function useStarterPacks(org: string) {
  const store = useStore();
  const records = useInstallRecords(org);
  const { loadManifest, loadAlertFile } = useAlertLibrary();
  const { installOne } = useLibraryInstall(() => org);

  const createFolderFor = {
    dashboards: useMutation(() => createFolderMutation(org, "dashboards")),
    alerts: useMutation(() => createFolderMutation(org, "alerts")),
  };
  const deleteFolderFor = {
    dashboards: useMutation(() => deleteFolderMutation(org, "dashboards")),
    alerts: useMutation(() => deleteFolderMutation(org, "alerts")),
  };
  const createDashboard = useMutation(() => createDashboardMutation(org));
  const deleteDashboard = useMutation(() => deleteDashboardMutation(org));
  const deleteAlert = useMutation(() => deleteAlertMutation(org));
  const createSavedView = useMutation(() => createSavedViewMutation(org));
  const deleteSavedView = useMutation(() => deleteSavedViewMutation(org));

  const folderAdapter = (pack: StarterPack, type: PackFolderType): PackItemAdapter => ({
    lookup: async () => {
      const folders = await readQuery(permittedFoldersQuery(org, type), true);
      const folder = folders.find((candidate) => candidate.name === pack.folder.name);
      return folder ? { id: folder.folderId } : null;
    },
    create: async () => {
      await createFolderFor[type].mutateAsync(pack.folder);
    },
    snapshot: async () => null,
    remove: async ({ id }) => {
      await deleteFolderFor[type].mutateAsync(id);
    },
  });

  const readDashboardSchemas = async (doc: Record<string, any>) => {
    const wanted = dashboardStreams(doc);
    const schemas = new Map<string, Set<string>>();
    if (!wanted.length) return schemas;
    const types = ["metrics", "logs"];
    const lists = await Promise.all(
      types.map((type) => readQuery(streamNameListQuery(org, type), true)),
    );
    const typeOf = new Map(
      lists.flatMap((rows, index) => rows.map((row) => [row.name, types[index]] as const)),
    );
    await Promise.all(
      wanted
        .filter((name) => typeOf.has(name))
        .map(async (name) => {
          const data = await readQuery(streamSchemaQuery(org, name, typeOf.get(name)!), true);
          const columns = (data?.schema ?? []) as Array<{ name: string }>;
          if (columns.length) schemas.set(name, new Set(columns.map((field) => field.name)));
        }),
    );
    return schemas;
  };

  const fitPackDashboard = async (dashboard: PackDashboard): Promise<DashboardFit> => {
    const doc = await dashboard.load();
    return fitDashboard(doc, await readDashboardSchemas(doc));
  };

  const dashboardAdapter = (
    pack: StarterPack,
    itemId: string,
    items: PackRecordItem[],
  ): PackItemAdapter => {
    const dashboard = pack.dashboards.find((candidate) => candidate.id === itemId)!;
    return {
      lookup: async () => {
        const folderId = folderIdOf(items, "dashboards");
        if (!folderId) return null;
        const rows = await readQuery(dashboardsByFolderQuery(org, folderId), true);
        const row = rows.find((candidate) => candidate.title === dashboard.title);
        return row ? { id: row.dashboard_id, folderId } : null;
      },
      create: async () => {
        const { doc: fitted } = await fitPackDashboard(dashboard);
        const doc = convertDashboardSchemaVersion(structuredClone(fitted));
        await createDashboard.mutateAsync({
          json: { ...doc, title: dashboard.title, created: new Date().toISOString() },
          folderId: folderIdOf(items, "dashboards")!,
        });
      },
      snapshot: async ({ id, folderId }) => {
        const data = await readQuery(dashboardDetailQuery(org, id, folderId!), true);
        const { updatedAt: _updatedAt, ...body } = data[`v${data.version}`];
        return body;
      },
      remove: async ({ id, folderId }) => {
        await deleteDashboard.mutateAsync({ dashboardId: id, folderId: folderId! });
      },
    };
  };

  const alertAdapter = (
    pack: StarterPack,
    itemId: string,
    items: PackRecordItem[],
    entries: Map<string, AlertLibraryEntry>,
  ): PackItemAdapter => {
    let savedId: string | undefined;
    return {
      // Alert names and client ids are not unique, so the tags are the only identity.
      lookup: async () => {
        const rows = await readQuery(alertsByTagsQuery(org, alertTags(pack.id, itemId)), true);
        if (rows[0]) return { id: rows[0].alert_id, folderId: rows[0].folder_id };
        // The server's tag search reads a cache that trails a create, so trust the id it returned.
        return savedId ? { id: savedId, folderId: folderIdOf(items, "alerts") } : null;
      },
      create: async () => {
        const entry = entries.get(itemId);
        if (!entry) throw new Error(`Alert Library has no entry ${itemId}`);
        const bundled = pack.bundledAlerts?.find((alert) => alert.entry.id === itemId);
        const file = await loadAlertFile(entry).catch((error) => {
          if (!bundled) throw error;
          return bundled.file;
        });
        await installOne(entry, {
          seed: { entry, file: fileForInstall(entry, file) },
          folderId: folderIdOf(items, "alerts")!,
          owner: store.state.userInfo?.email ?? "",
          timezone: store.state.timezone,
          scheduledOnly: true,
          decoratePayload: (payload) => ({
            ...payload,
            enabled: false,
            destinations: [],
            tags: [...new Set([...(payload.tags as string[]), ...alertTags(pack.id, itemId)])],
          }),
          onSaved: (id) => {
            savedId = id;
          },
        });
      },
      snapshot: async ({ id }) => {
        const alert = { ...(await readQuery(alertDetailQuery(org, id), true)) };
        for (const field of ALERT_VOLATILE_FIELDS) delete alert[field];
        return alert;
      },
      remove: async ({ id, folderId }) => {
        await deleteAlert.mutateAsync({ alertId: id, folderId });
      },
    };
  };

  const savedViewAdapter = (pack: StarterPack, itemId: string): PackItemAdapter => {
    const view = pack.savedViews.find((candidate) => candidate.id === itemId)!;
    return {
      lookup: async () => {
        const rows = await readQuery(savedViewsQuery(org), true);
        const row = rows.find(
          (candidate) => candidate.view_name === view.name && viewTypeOf(candidate) === "logs",
        );
        return row ? { id: row.view_id } : null;
      },
      create: async () => {
        await createSavedView.mutateAsync({
          data: buildSavedViewPayload(view.search, { timezone: store.state.timezone }),
          view_name: view.name,
          view_type: "logs",
        });
      },
      snapshot: ({ id }) => readQuery(savedViewDetailQuery(org, id), true),
      remove: async ({ id }) => {
        await deleteSavedView.mutateAsync(id);
      },
    };
  };

  const adapterFor = (
    pack: StarterPack,
    item: PackRecordItem,
    items: PackRecordItem[],
    entries: Map<string, AlertLibraryEntry>,
  ): PackItemAdapter => {
    if (item.kind === "folder") return folderAdapter(pack, item.itemId as PackFolderType);
    if (item.kind === "dashboard") return dashboardAdapter(pack, item.itemId, items);
    if (item.kind === "alert") return alertAdapter(pack, item.itemId, items, entries);
    return savedViewAdapter(pack, item.itemId);
  };

  const planItems = async (pack: StarterPack): Promise<PackRecordItem[]> => {
    const planned: PackRecordItem[] = [];
    for (const item of packItems(pack)) {
      const found = await adapterFor(pack, item, planned, new Map()).lookup();
      planned.push(found ? { ...item, ...found, status: "existing" } : item);
    }
    return planned;
  };

  const loadEntries = async (pack: StarterPack) => {
    try {
      const manifest = await loadManifest();
      return {
        entries: new Map(manifest.alerts.map((entry) => [entry.id, entry])),
        offline: false,
      };
    } catch (error) {
      if (!pack.bundledAlerts?.length) throw error;
      const entries = new Map(pack.bundledAlerts.map(({ entry }) => [entry.id, entry]));
      return { entries, offline: true };
    }
  };

  const notIncludedAlert = (
    entry: AlertLibraryEntry | undefined,
    streams: Record<string, Set<string>>,
  ): PackNotIncludedItem["reason"] | null => {
    if (!entry) return "unavailable";
    const names = streams[entry.stream_type];
    return entry.required_streams.every((name) => names?.has(name)) ? null : "no_data";
  };

  const readStreamNames = async (type: string): Promise<Set<string>> => {
    const rows = await readQuery(streamNameListQuery(org, type), true);
    return new Set(rows.map((row) => row.name));
  };

  /** The names, the plan and what is left out, read before anything is created. */
  const previewPack = async (pack: StarterPack): Promise<PackPreview> => {
    const { entries, offline } = await loadEntries(pack);
    const wanted = pack.alerts.flatMap((id) => entries.get(id)?.stream_type ?? []);
    const types = [...new Set(wanted)];
    const lists = await Promise.all(types.map(readStreamNames));
    const streams = Object.fromEntries(types.map((type, index) => [type, lists[index]]));
    const names: Record<string, string> = {};
    for (const { id, title } of pack.dashboards) names[id] = title;
    for (const { id, name } of pack.savedViews) names[id] = name;
    for (const id of pack.alerts) names[id] = entries.get(id)?.title ?? id;

    const panels = { kept: 0, dropped: 0 };
    const noFit = new Set<string>();
    for (const dashboard of pack.dashboards) {
      const fit = await fitPackDashboard(dashboard);
      panels.kept += fit.kept;
      panels.dropped += fit.dropped;
      if (!fit.kept && fit.dropped) noFit.add(dashboard.id);
    }

    const notIncluded: PackNotIncludedItem[] = [];
    const items: PackRecordItem[] = [];
    for (const item of await planItems(pack)) {
      const name = names[item.itemId] ?? item.itemId;
      if (item.kind === "dashboard" && item.status !== "existing" && noFit.has(item.itemId)) {
        notIncluded.push({ kind: "dashboard", itemId: item.itemId, name, reason: "no_data" });
        continue;
      }
      const missing =
        item.kind === "alert" ? notIncludedAlert(entries.get(item.itemId), streams) : null;
      if (item.kind !== "folder" && item.status === "existing") {
        notIncluded.push({ kind: item.kind, itemId: item.itemId, name, reason: "already_have" });
      } else if (missing) {
        notIncluded.push({ kind: "alert", itemId: item.itemId, name, reason: missing });
        continue;
      }
      items.push(item);
    }
    return { items, names, notIncluded, offline, panels };
  };

  const settleItem = async (
    pack: StarterPack,
    item: PackRecordItem,
    items: PackRecordItem[],
    entries: Map<string, AlertLibraryEntry>,
  ): Promise<PackRecordItem> => {
    const adapter = adapterFor(pack, item, items, entries);
    try {
      let found = await adapter.lookup();
      if (!found) {
        // A create that errored may still have committed, so only the lookup after it decides.
        await adapter.create().catch(() => undefined);
        found = await adapter.lookup();
      }
      if (!found) return { ...item, status: "failed" };
      const sourceHash = contentHash(await adapter.snapshot(found));
      return { ...item, ...found, status: "created", sourceHash };
    } catch {
      return { ...item, status: "failed" };
    }
  };

  const writeFirstRecord = async (record: PackInstallRecord) => {
    try {
      await records.write(record);
    } catch (error: any) {
      if (error?.response?.status === 403) throw new StarterPackPermissionError();
      throw error;
    }
  };

  const runInstall = async (
    pack: StarterPack,
    { exclude = [], onProgress }: PackInstallOptions,
  ): Promise<PackInstallRecord> => {
    const { entries } = await loadEntries(pack);

    const interrupted = (await records.list(pack.id)).find(
      ({ status }) => status === "installing" || status === "incomplete",
    );
    // A resumed record still lists items the current plan leaves out; only made ones stay.
    const kept = (item: PackRecordItem) =>
      item.status === "created" || !exclude.includes(item.itemId);
    const record: PackInstallRecord = interrupted
      ? {
          ...interrupted,
          status: "installing",
          installedAt: Date.now() * 1000,
          items: interrupted.items.filter(kept),
        }
      : {
          packId: pack.id,
          installId: getUUID(),
          status: "installing",
          installedAt: Date.now() * 1000,
          installedBy: store.state.userInfo?.email ?? "",
          items: (await planItems(pack)).filter((item) => !exclude.includes(item.itemId)),
        };
    await writeFirstRecord(record);
    onProgress?.(record);

    for (let index = 0; index < record.items.length; index += 1) {
      const item = record.items[index];
      if (item.status === "created" || item.status === "existing") continue;
      record.items[index] = await settleItem(pack, item, record.items, entries);
      await records.write(record);
      onProgress?.(record);
      // Everything after a folder needs its id.
      if (item.kind === "folder" && record.items[index].status === "failed") break;
    }

    const settled = record.items.every(
      ({ status }) => status === "created" || status === "existing",
    );
    record.status = settled ? "complete" : "incomplete";
    await records.write(record);
    return record;
  };

  /** Installs the pack, or resumes this pack's interrupted install instead of starting another. */
  const installPack = (
    pack: StarterPack,
    options: PackInstallOptions = {},
  ): Promise<PackInstallRecord> => {
    const key = `${org}\u0000${pack.id}`;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const run = runInstall(pack, options).finally(() => inFlight.delete(key));
    inFlight.set(key, run);
    return run;
  };

  const isFolderEmpty = async (type: PackFolderType, folderId: string): Promise<boolean> => {
    const rows =
      type === "alerts"
        ? await readQuery(alertsListQuery(org, folderId), true)
        : await readQuery(dashboardsByFolderQuery(org, folderId), true);
    return rows.length === 0;
  };

  /** The reason an item stays, or null once it is gone. */
  const disposeItem = async (
    pack: StarterPack,
    item: PackRecordItem,
    items: PackRecordItem[],
  ): Promise<PackKeptReason | null> => {
    const adapter = adapterFor(pack, item, items, new Map());
    try {
      if (!item.id) return (await adapter.lookup()) ? "unrecorded" : null;
      const found = { id: item.id, folderId: item.folderId };
      if (item.kind === "folder") {
        if (!(await isFolderEmpty(item.itemId as PackFolderType, item.id))) return "not_empty";
      } else if (contentHash(await adapter.snapshot(found)) !== item.sourceHash) {
        return "changed";
      }
      await adapter.remove(found);
      return null;
    } catch (error) {
      return isNotFound(error) ? null : "delete_failed";
    }
  };

  const removeInstall = async (
    pack: StarterPack,
    record: PackInstallRecord,
  ): Promise<PackRemovalResult> => {
    const removed: PackRecordItem[] = [];
    const kept: PackKeptItem[] = [];
    const remaining: PackRecordItem[] = [];

    // Reverse install order, so a folder is checked after what lived inside it.
    for (const item of [...record.items].reverse()) {
      if (item.status === "existing") continue;
      const reason = await disposeItem(pack, item, record.items);
      if (reason) {
        kept.push({ kind: item.kind, itemId: item.itemId, reason });
        remaining.unshift(item);
      } else if (item.id) {
        removed.push(item);
      }
    }

    if (remaining.length === 0) await records.remove(record);
    else await records.write({ ...record, status: "removed", items: remaining });
    return { removed, kept };
  };

  /** Removes one install's unchanged items and reports the rest. */
  const undoPack = async (pack: StarterPack, installId: string): Promise<PackRemovalResult> => {
    const record = await records.read(pack.id, installId);
    return record ? removeInstall(pack, record) : { removed: [], kept: [] };
  };

  /** Removes the unchanged items of every install of the pack and reports the rest. */
  const removePack = async (pack: StarterPack): Promise<PackRemovalResult> => {
    const result: PackRemovalResult = { removed: [], kept: [] };
    for (const record of await records.list(pack.id)) {
      const { removed, kept } = await removeInstall(pack, record);
      result.removed.push(...removed);
      result.kept.push(...kept);
    }
    // Tags prove pack ownership, so a tagged alert no record covers is still reported.
    for (const itemId of pack.alerts) {
      if (result.kept.some((item) => item.kind === "alert" && item.itemId === itemId)) continue;
      const reason = await disposeItem(pack, { kind: "alert", itemId, status: "pending" }, []);
      if (reason) result.kept.push({ kind: "alert", itemId, reason });
    }
    return result;
  };

  return { installPack, previewPack, undoPack, removePack, listInstalls: records.list };
}
