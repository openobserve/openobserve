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
import type { AlertLibraryEntry } from "@/types/alertLibrary";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import { buildSavedViewPayload } from "@/utils/logs/savedViewPayload";
import { getUUID } from "@/utils/uuid";

import {
  StarterPackPermissionError,
  type PackFolderType,
  type PackInstallRecord,
  type PackKeptItem,
  type PackKeptReason,
  type PackRecordItem,
  type PackRemovalResult,
  type StarterPack,
} from "./types";
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
  const { loadManifest } = useAlertLibrary();
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
        const doc = convertDashboardSchemaVersion(structuredClone(await dashboard.load()));
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
  ): PackItemAdapter => ({
    // Alert names and client ids are not unique, so the tags are the only identity.
    lookup: async () => {
      const rows = await readQuery(alertsByTagsQuery(org, alertTags(pack.id, itemId)), true);
      return rows[0] ? { id: rows[0].alert_id, folderId: rows[0].folder_id } : null;
    },
    create: async () => {
      const entry = entries.get(itemId);
      if (!entry) throw new Error(`Alert Library has no entry ${itemId}`);
      await installOne(entry, {
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
  });

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

  const runInstall = async (pack: StarterPack): Promise<PackInstallRecord> => {
    const manifest = await loadManifest();
    const entries = new Map(manifest.alerts.map((entry) => [entry.id, entry]));

    const interrupted = (await records.list(pack.id)).find(
      ({ status }) => status === "installing" || status === "incomplete",
    );
    const record: PackInstallRecord = interrupted
      ? { ...interrupted, status: "installing" }
      : {
          packId: pack.id,
          installId: getUUID(),
          status: "installing",
          items: await planItems(pack),
        };
    await writeFirstRecord(record);

    for (let index = 0; index < record.items.length; index += 1) {
      const item = record.items[index];
      if (item.status === "created" || item.status === "existing") continue;
      record.items[index] = await settleItem(pack, item, record.items, entries);
      await records.write(record);
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
  const installPack = (pack: StarterPack): Promise<PackInstallRecord> => {
    const key = `${org}\u0000${pack.id}`;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const run = runInstall(pack).finally(() => inFlight.delete(key));
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

  return { installPack, undoPack, removePack, listInstalls: records.list };
}
