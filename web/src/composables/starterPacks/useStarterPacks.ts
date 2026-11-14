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
import { streamNameListQuery } from "@/services/stream.queries";
import type { AlertLibraryEntry, AlertLibraryFile, StreamsByType } from "@/types/alertLibrary";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
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
  type PackNotIncludedReason,
  type PackPreview,
  type PackRecordItem,
  type PackRemovalResult,
  type PackChoices,
  type PackFlavourAlert,
  type StarterPack,
} from "./types";
import { dashboardStreams, fitDashboard, queryNeeds, type DashboardFit } from "./dashboardFit";
import {
  adaptAlert,
  adaptDashboard,
  adaptSavedView,
  addStreamPickers,
  planKeptPanels,
  withFlavour,
  type PackAdaptation,
} from "./packAdapt";
import { planAdaptation } from "./packAdaptationPlan";
import { alertItem, dashboardItems, locateStream, type MatchItem } from "./packMatch";
import {
  matchAlerts,
  readBindingSources,
  readOrgStreams,
  readSchemaColumns,
} from "./packMatchData";
import { isFresh, MAX_STREAM_COPIES } from "./streamCandidates";
import { contentHash, useInstallRecords } from "./useInstallRecords";
import { StreamRewriteError } from "./streamRewriter";
import { useRewriteChecks } from "./useRewriteChecks";
import { useStreamValues } from "./useStreamValues";

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

const withFolder = (pack: StarterPack, name?: string): StarterPack =>
  name ? { ...pack, folder: { ...pack.folder, name } } : pack;

const inFlight = new Map<string, Promise<PackInstallRecord>>();

const isNotFound = (error: any): boolean => error?.response?.status === 404;

// The backend stores tags lowercased, and a filter on any other case matches nothing.
const alertTags = (packId: string, entryId: string, stream?: string): string[] => [
  `pack:${packId}`.toLowerCase(),
  `library:${entryId}`.toLowerCase(),
  ...(stream ? [`stream:${stream}`.toLowerCase()] : []),
];

const folderIdOf = (items: PackRecordItem[], type: PackFolderType): string | undefined =>
  items.find((item) => item.kind === "folder" && item.itemId === type)?.id;

const NO_ADAPTATION: PackAdaptation = { repairs: [], bindings: [] };

const copyItemId = (copyOf: string, stream: string) => `${copyOf}@${stream}`;

const flavourAlert = (pack: StarterPack, flavourId: string | undefined, alertId: string) =>
  pack.flavours?.find(({ id }) => id === flavourId)?.alerts[alertId];

const packItems = (pack: StarterPack, copies: PackPreview["copies"] = []): PackRecordItem[] => {
  const pending = { status: "pending" } as const;
  const alertRows = pack.alerts.flatMap((itemId) => {
    const own = copies.filter(({ copyOf }) => copyOf === itemId);
    if (!own.length) return [{ ...pending, kind: "alert" as const, itemId }];
    return own.map(({ copyOf, stream }) => ({
      ...pending,
      kind: "alert" as const,
      itemId: copyItemId(copyOf, stream),
      copyOf,
      stream,
    }));
  });
  return [
    ...FOLDER_TYPES.map((itemId) => ({ ...pending, kind: "folder" as const, itemId })),
    ...pack.dashboards.map(({ id }) => ({ ...pending, kind: "dashboard" as const, itemId: id })),
    ...alertRows,
    ...pack.savedViews.map(({ id }) => ({ ...pending, kind: "savedView" as const, itemId: id })),
  ];
};

export function useStarterPacks(org: string) {
  const store = useStore();
  const records = useInstallRecords(org);
  const rewriteChecks = useRewriteChecks(org);
  const { readValues } = useStreamValues(org);
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
          const columns = await readSchemaColumns(org, typeOf.get(name)!, name, true);
          if (columns.length) schemas.set(name, new Set(columns));
        }),
    );
    return schemas;
  };

  const fitPackDashboard = async (
    dashboard: PackDashboard,
    adaptation: PackAdaptation = NO_ADAPTATION,
  ): Promise<DashboardFit> => {
    const loaded = await dashboard.load();
    if (!adaptation.repairs.length && !adaptation.bindings.length) {
      return fitDashboard(loaded, await readDashboardSchemas(loaded));
    }
    // A panel the fit drops anyway must not fail the whole dashboard, so planning waits for the fit.
    const unplanned = { ...rewriteChecks, sql: async () => {} };
    const doc = await adaptDashboard(loaded, adaptation, unplanned);
    const fit = fitDashboard(doc, await readDashboardSchemas(doc));
    await planKeptPanels(fit.doc, rewriteChecks);
    return fit;
  };

  const dashboardAdapter = (
    pack: StarterPack,
    itemId: string,
    items: PackRecordItem[],
    adaptation: PackAdaptation,
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
        const { doc: fitted } = await fitPackDashboard(dashboard, adaptation);
        const picked = await addStreamPickers(structuredClone(fitted), adaptation.repairs);
        const doc = convertDashboardSchemaVersion(picked);
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
    { copyOf, itemId, stream }: PackRecordItem,
    items: PackRecordItem[],
    entries: Map<string, AlertLibraryEntry>,
    adaptation: PackAdaptation,
    flavour?: PackFlavourAlert,
  ): PackItemAdapter => {
    let savedId: string | undefined;
    return {
      // Alert names and client ids are not unique, so the tags are the only identity.
      lookup: async () => {
        const tags = alertTags(pack.id, copyOf ?? itemId, stream);
        const rows = await readQuery(alertsByTagsQuery(org, tags), true);
        if (rows[0]) return { id: rows[0].alert_id, folderId: rows[0].folder_id };
        // The server's tag search reads a cache that trails a create, so trust the id it returned.
        return savedId ? { id: savedId, folderId: folderIdOf(items, "alerts") } : null;
      },
      create: async () => {
        const entryId = copyOf ?? itemId;
        const entry = entries.get(entryId);
        if (!entry) throw new Error(`Alert Library has no entry ${entryId}`);
        const bundled = pack.bundledAlerts?.find((alert) => alert.entry.id === entryId);
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
          decoratePayload: async (payload) => {
            const flavoured = withFlavour(payload, flavour);
            const doc = await adaptAlert(flavoured, adaptation, rewriteChecks, stream);
            const tags = [...(payload.tags as string[]), ...alertTags(pack.id, entryId, stream)];
            return {
              ...doc,
              name: stream ? `${doc.name}_${stream}` : doc.name,
              enabled: false,
              destinations: [],
              tags: [...new Set(tags)],
            };
          },
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

  const savedViewAdapter = (
    pack: StarterPack,
    itemId: string,
    adaptation: PackAdaptation,
  ): PackItemAdapter => {
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
          data: buildSavedViewPayload(adaptSavedView(view.search, adaptation.repairs), {
            timezone: store.state.timezone,
          }),
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
    adaptation: PackAdaptation = NO_ADAPTATION,
    flavours: Record<string, string> = {},
  ): PackItemAdapter => {
    if (item.kind === "folder") return folderAdapter(pack, item.itemId as PackFolderType);
    if (item.kind === "dashboard") return dashboardAdapter(pack, item.itemId, items, adaptation);
    if (item.kind === "alert") {
      const id = item.copyOf ?? item.itemId;
      const flavour = flavourAlert(pack, flavours[id], id);
      return alertAdapter(pack, item, items, entries, adaptation, flavour);
    }
    return savedViewAdapter(pack, item.itemId, adaptation);
  };

  const planItems = async (
    pack: StarterPack,
    copies?: PackPreview["copies"],
  ): Promise<PackRecordItem[]> => {
    const planned: PackRecordItem[] = [];
    for (const item of packItems(pack, copies)) {
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

  const alertFile = (pack: StarterPack, entry: AlertLibraryEntry) =>
    loadAlertFile(entry).catch(
      () => pack.bundledAlerts?.find((alert) => alert.entry.id === entry.id)?.file ?? null,
    );

  /** An alert whose shipped names are absent takes the variant its data can answer. */
  const pickFlavours = (
    pack: StarterPack,
    alerts: Map<string, MatchItem>,
    streams: StreamsByType,
  ) => {
    const here = (name: string) => {
      const found = locateStream(name, "metrics", { streams, repairs: [] });
      return !!found && isFresh(found.lastIngested, Date.now());
    };
    const flavours: Record<string, string> = {};
    const unsupported = new Set<string>();
    for (const [id, item] of alerts) {
      if (item.streams.every(here)) continue;
      const chosen = pack.flavours?.find(({ alerts: own }) => own[id]?.streams.every(here));
      if (chosen) {
        const variant = chosen.alerts[id];
        flavours[id] = chosen.id;
        const needs = queryNeeds(variant.promql, "promql");
        alerts.set(id, { ...item, streams: variant.streams, fields: [...needs.fields] });
      } else if (pack.flavours?.some((row) => !row.alerts[id] && row.detect.some(here))) {
        unsupported.add(id);
      }
    }
    return { flavours, unsupported };
  };

  const adaptationFor = async (
    pack: StarterPack,
    listed: AlertLibraryEntry[],
    choices?: PackChoices,
  ) => {
    const streams = await readOrgStreams(org);
    const alerts = new Map<string, MatchItem>();
    await Promise.all(
      listed.map(async (entry) => {
        const item = alertItem(entry, await alertFile(pack, entry));
        if (item) alerts.set(entry.id, item);
      }),
    );
    const { flavours, unsupported } = pickFlavours(pack, alerts, streams);
    const docs = await Promise.all(pack.dashboards.map((dashboard) => dashboard.load()));
    const sources = await readBindingSources(org, [pack]);
    const plan = await planAdaptation({
      pack,
      streams,
      alerts: [...alerts.values()],
      panels: docs.flatMap(dashboardItems),
      sources,
      choices,
      nowMs: Date.now(),
      readers: {
        columns: async (type, name) => new Set(await readSchemaColumns(org, type, name)),
        values: (stream, fields) => readValues(stream, fields),
      },
    });
    return { ...plan, alerts, flavours, unsupported, streams, titles: sources.titles };
  };

  const alertCopies = (alerts: Map<string, MatchItem>, repairs: PackPreview["repairs"]) =>
    repairs.flatMap(({ from, to, also }) => {
      if (!also?.length) return [];
      const streams = [to, ...also].slice(0, MAX_STREAM_COPIES);
      const reading = [...alerts].filter(([, item]) => item.streams.includes(from));
      return reading.flatMap(([copyOf]) => streams.map((stream) => ({ copyOf, stream })));
    });

  const flavouredEntry = (pack: StarterPack, entry: AlertLibraryEntry, flavourId?: string) => {
    const variant = flavourAlert(pack, flavourId, entry.id);
    return variant ? { ...entry, required_streams: variant.streams } : entry;
  };

  /** The names, the plan and what is left out, read before anything is created. */
  const previewPack = async (pack: StarterPack, choices?: PackChoices): Promise<PackPreview> => {
    const { entries, offline } = await loadEntries(pack);
    const listed = pack.alerts.flatMap((id) => entries.get(id) ?? []);
    const plan = await adaptationFor(pack, listed, choices);
    const { repairs, bindings, flavours, alerts, unsupported, streams } = plan;
    const flavoured = listed.map((entry) => flavouredEntry(pack, entry, flavours[entry.id]));
    const verdicts = STARTER_PACKS_ENABLED
      ? await matchAlerts(org, flavoured, streams, {
          loadFile: async (entry) => {
            const file = await alertFile(pack, entry);
            const variant = flavourAlert(pack, flavours[entry.id], entry.id);
            if (!file || !variant) return file as AlertLibraryFile;
            const original = file.query_condition as Record<string, unknown> | undefined;
            const condition = { ...original, promql: variant.promql };
            return { ...file, query_condition: condition } as AlertLibraryFile;
          },
          packs: [pack],
          repairs,
        })
      : null;
    const names: Record<string, string> = {};
    for (const { id, title } of pack.dashboards) names[id] = title;
    for (const { id, name } of pack.savedViews) names[id] = name;
    for (const id of pack.alerts) names[id] = entries.get(id)?.title ?? id;
    const copies = alertCopies(alerts, repairs);
    for (const { copyOf, stream } of copies) {
      names[copyItemId(copyOf, stream)] = `${names[copyOf]} (${stream})`;
    }

    const panels = { kept: 0, dropped: 0 };
    const noFit = new Set<string>();
    for (const dashboard of pack.dashboards) {
      const fit = await fitPackDashboard(dashboard, { repairs, bindings }).catch((error) => {
        if (error instanceof StreamRewriteError) return { doc: {}, kept: 0, dropped: 1 };
        throw error;
      });
      panels.kept += fit.kept;
      panels.dropped += fit.dropped;
      if (!fit.kept && fit.dropped) noFit.add(dashboard.id);
    }

    const alertReason = (id: string): PackNotIncludedReason | null => {
      const entry = entries.get(id);
      if (!entry) return "unavailable";
      const fits = verdicts
        ? verdicts.get(id)
        : flavouredEntry(pack, entry, flavours[id]).required_streams.every((name) =>
            locateStream(name, entry.stream_type, { streams, repairs }),
          );
      if (fits) return null;
      return unsupported.has(id) ? "no_flavour" : "no_data";
    };

    const notIncluded: PackNotIncludedItem[] = [];
    const items: PackRecordItem[] = [];
    const reported = new Set<string>();
    for (const item of await planItems(pack, copies)) {
      const name = names[item.itemId] ?? item.itemId;
      if (item.kind === "dashboard" && item.status !== "existing" && noFit.has(item.itemId)) {
        notIncluded.push({ kind: "dashboard", itemId: item.itemId, name, reason: "no_data" });
        continue;
      }
      const id = item.copyOf ?? item.itemId;
      const missing = item.kind === "alert" ? alertReason(id) : null;
      if (item.kind !== "folder" && item.status === "existing") {
        notIncluded.push({ kind: item.kind, itemId: item.itemId, name, reason: "already_have" });
      } else if (missing) {
        if (!reported.has(id))
          notIncluded.push({ kind: "alert", itemId: id, name: names[id] ?? id, reason: missing });
        reported.add(id);
        continue;
      }
      items.push(item);
    }
    return {
      items,
      names,
      notIncluded,
      offline,
      panels,
      repairs,
      bindings,
      questions: plan.questions,
      columns: plan.columns,
      groupTitles: plan.titles,
      flavours,
      copies,
    };
  };

  const settleItem = async (
    pack: StarterPack,
    item: PackRecordItem,
    items: PackRecordItem[],
    entries: Map<string, AlertLibraryEntry>,
    record: PackInstallRecord,
  ): Promise<PackRecordItem> => {
    const adaptation = { repairs: record.repairs ?? [], bindings: record.bindings ?? [] };
    const adapter = adapterFor(pack, item, items, entries, adaptation, record.flavours);
    try {
      let found = await adapter.lookup();
      if (!found) {
        // A create that errored may still have committed, so only the lookup after it decides.
        await adapter.create().catch((error) => {
          if (error instanceof StreamRewriteError) throw error;
        });
        found = await adapter.lookup();
      }
      if (!found) return { ...item, status: "failed" };
      const sourceHash = contentHash(await adapter.snapshot(found));
      return { ...item, ...found, status: "created", sourceHash };
    } catch (error) {
      return { ...item, status: error instanceof StreamRewriteError ? "skipped" : "failed" };
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
    sourcePack: StarterPack,
    {
      exclude = [],
      onProgress,
      repairs = [],
      bindings = [],
      flavours = {},
      copies,
      folderName,
    }: PackInstallOptions,
  ): Promise<PackInstallRecord> => {
    const { entries } = await loadEntries(sourcePack);

    const interrupted = (await records.list(sourcePack.id)).find(
      ({ status }) => status === "installing" || status === "incomplete",
    );
    const pack = withFolder(sourcePack, interrupted?.folderName ?? folderName);
    // A resumed record still lists items the current plan leaves out; only made ones stay.
    const kept = (item: PackRecordItem) =>
      item.status === "created" || !exclude.includes(item.copyOf ?? item.itemId);
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
          version: pack.version,
          ...(repairs.length ? { repairs } : {}),
          ...(bindings.length ? { bindings } : {}),
          ...(Object.keys(flavours).length ? { flavours } : {}),
          ...(folderName ? { folderName } : {}),
          items: (await planItems(pack, copies)).filter(
            (item) => !exclude.includes(item.copyOf ?? item.itemId),
          ),
        };
    await writeFirstRecord(record);
    onProgress?.(record);
    return settleRecord(pack, record, entries, onProgress);
  };

  const settleRecord = async (
    pack: StarterPack,
    record: PackInstallRecord,
    entries: Map<string, AlertLibraryEntry>,
    onProgress?: PackInstallOptions["onProgress"],
  ): Promise<PackInstallRecord> => {
    for (let index = 0; index < record.items.length; index += 1) {
      const item = record.items[index];
      if (item.status === "created" || item.status === "existing") continue;
      record.items[index] = await settleItem(pack, item, record.items, entries, record);
      await records.write(record);
      onProgress?.(record);
      // Everything after a folder needs its id.
      if (item.kind === "folder" && record.items[index].status === "failed") break;
    }

    const settled = record.items.every(({ status }) =>
      ["created", "existing", "skipped"].includes(status),
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
    const run = runInstall(pack, options).finally(() => {
      if (inFlight.get(key) === run) inFlight.delete(key);
    });
    inFlight.set(key, run);
    return run;
  };

  const runAppend = async (
    sourcePack: StarterPack,
    installId: string,
    itemIds: string[],
    { repairs = [], bindings = [], flavours = {}, onProgress }: PackInstallOptions,
  ): Promise<PackInstallRecord> => {
    const { entries } = await loadEntries(sourcePack);
    const stored = await records.read(sourcePack.id, installId);
    if (!stored) throw new Error(`No install record ${installId}`);
    const pack = withFolder(sourcePack, stored.folderName);
    const all = await planItems(pack);
    const asked = all.filter((item) => item.kind !== "folder" && itemIds.includes(item.itemId));
    // A first Add may have left a folder out; the new items need theirs.
    const needed = all.filter(
      ({ kind, itemId }) =>
        kind === "folder" &&
        asked.some((item) => item.kind === (itemId === "alerts" ? "alert" : "dashboard")),
    );
    const plan = new Map([...needed, ...asked].map((item) => [item.itemId, item]));
    // A recorded item someone deleted since is made again rather than counted as installed.
    const items = stored.items.map((item) => {
      const fresh = plan.get(item.itemId);
      if (!fresh) return item;
      plan.delete(item.itemId);
      return fresh.status === "pending" ? fresh : item;
    });
    const planned = [...plan.values()];
    const merged = <T>(old: T[] = [], add: T[], keyOf: (row: T) => string) => [
      ...new Map([...old, ...add].map((row) => [keyOf(row), row])).values(),
    ];
    const record: PackInstallRecord = {
      ...stored,
      status: "installing",
      repairs: merged(stored.repairs, repairs, ({ from }) => from),
      bindings: merged(stored.bindings, bindings, (row) => `${row.stream}/${row.from}`),
      flavours: { ...stored.flavours, ...flavours },
      items: [...items, ...planned],
    };
    await writeFirstRecord(record);
    onProgress?.(record);
    return settleRecord(pack, record, entries, onProgress);
  };

  /** Adds new items to an install's own record, so its Undo and Remove cover them. */
  const appendToInstall = (
    pack: StarterPack,
    installId: string,
    itemIds: string[],
    options: PackInstallOptions = {},
  ): Promise<PackInstallRecord> => {
    const key = `${org}\u0000${pack.id}`;
    // Waits for a running install or append of this pack instead of joining it.
    const before = inFlight.get(key)?.catch(() => null) ?? Promise.resolve(null);
    const run = before
      .then(() => runAppend(pack, installId, itemIds, options))
      .finally(() => {
        if (inFlight.get(key) === run) inFlight.delete(key);
      });
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
      const owner = withFolder(pack, record.folderName);
      const reason = await disposeItem(owner, item, record.items);
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

  /** Removes only these items of one install, for an Undo of items appended to it. */
  const undoItems = async (
    sourcePack: StarterPack,
    installId: string,
    itemIds: string[],
  ): Promise<PackRemovalResult> => {
    const record = await records.read(sourcePack.id, installId);
    if (!record) return { removed: [], kept: [] };
    const pack = withFolder(sourcePack, record.folderName);
    const removed: PackRecordItem[] = [];
    const kept: PackKeptItem[] = [];
    const items: PackRecordItem[] = [];
    for (const item of record.items) {
      if (!itemIds.includes(item.copyOf ?? item.itemId) || item.status === "existing") {
        items.push(item);
        continue;
      }
      const reason = await disposeItem(pack, item, record.items);
      if (reason) {
        kept.push({ kind: item.kind, itemId: item.itemId, reason });
        items.push(item);
      } else if (item.id) {
        removed.push(item);
      }
    }
    await records.write({ ...record, items });
    return { removed, kept };
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

  // Null once the alert is gone, which must not stop edits to the alerts that remain.
  const hashOf = async (pack: StarterPack, item: PackRecordItem): Promise<string | null> => {
    const found = { id: item.id!, folderId: item.folderId };
    try {
      return contentHash(await adapterFor(pack, item, [], new Map()).snapshot(found));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  };

  /** Runs a pack's own edit of these alerts so Undo still sees them as unchanged; user edits stay detected. */
  const trackAlertEdit = async <T>(
    pack: StarterPack,
    alertIds: string[],
    work: () => Promise<T>,
  ): Promise<T> => {
    const live = (await records.list(pack.id)).filter(({ status }) => status !== "removed");
    const owned = await Promise.all(
      live.map(async (record) => {
        const alerts = record.items.filter(
          ({ kind, id }) => kind === "alert" && !!id && alertIds.includes(id),
        );
        const hashes = await Promise.all(alerts.map((item) => hashOf(pack, item)));
        return alerts.filter((item, index) => hashes[index] === item.sourceHash);
      }),
    );
    const result = await work();
    await Promise.all(
      live.map(async (record, index) => {
        if (!owned[index].length) return;
        for (const item of owned[index]) {
          item.sourceHash = (await hashOf(pack, item)) ?? item.sourceHash;
        }
        await records.write(record);
      }),
    );
    return result;
  };

  return {
    installPack,
    appendToInstall,
    undoItems,
    previewPack,
    undoPack,
    removePack,
    trackAlertEdit,
    writeRecord: records.write,
    listInstalls: records.list,
  };
}
