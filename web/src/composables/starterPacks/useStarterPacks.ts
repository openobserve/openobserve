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
import { MAX_STREAM_COPIES } from "./streamCandidates";
import { contentHash, useInstallRecords } from "./useInstallRecords";
import { catalogVersion } from "./usePackCatalog";
import { StreamRewriteError } from "./streamRewriter";
import { useRewriteChecks } from "./useRewriteChecks";
import { useStreamValues } from "./useStreamValues";

interface FoundItem {
  id: string;
  folderId?: string;
}

interface PackItemAdapter {
  lookup: () => Promise<FoundItem | null>;
  /** False when someone else's import already held it, so the pack must not own it. */
  create: () => Promise<boolean | void>;
  /** The user-editable body the source hash covers. */
  snapshot: (found: FoundItem) => Promise<unknown>;
  remove: (found: FoundItem) => Promise<void>;
}

interface LibraryInstall {
  libraryId: string;
  stream?: string;
  found: FoundItem;
}

const FOLDER_TYPES: PackFolderType[] = ["dashboards", "alerts"];

// Server bookkeeping that moves without anyone editing the alert.
const ALERT_VOLATILE_FIELDS = [
  "updated_at",
  "last_edited_by",
  "last_triggered_at",
  "last_satisfied_at",
];

/** The user-editable alert body a source hash covers. */
export const alertBody = (alert: Record<string, any>) => {
  const body = { ...alert };
  for (const field of ALERT_VOLATILE_FIELDS) delete body[field];
  return body;
};

/** The dashboard body a source hash covers, from a detail read. */
const dashboardBody = (data: Record<string, any>) => {
  const { updatedAt: _updatedAt, ...body } = data[`v${data.version}`];
  return body;
};

const withFolder = (pack: StarterPack, name?: string): StarterPack =>
  name ? { ...pack, folder: { ...pack.folder, name } } : pack;

const inFlight = new Map<string, Promise<PackInstallRecord>>();

export const isNotFound = (error: any): boolean => error?.response?.status === 404;

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

const isShared = (pack: StarterPack, { kind, itemId }: PackRecordItem) =>
  kind === "dashboard" && !!pack.dashboards.find(({ id }) => id === itemId)?.shared;

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
  // Shared dashboards live where their importer puts them, so they need no pack folder.
  const folders = FOLDER_TYPES.filter(
    (type) => type === "alerts" || pack.dashboards.some(({ shared }) => !shared),
  );
  return [
    ...folders.map((itemId) => ({ ...pending, kind: "folder" as const, itemId })),
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
    // The last type read wins a shared name, so logs keeps winning as it did before traces was read.
    const types = ["traces", "metrics", "logs"];
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

  const fitLoadedDashboard = async (
    loaded: Record<string, any>,
    adaptation: PackAdaptation = NO_ADAPTATION,
  ): Promise<DashboardFit> => {
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

  const fitPackDashboard = async (dashboard: PackDashboard, adaptation?: PackAdaptation) =>
    fitLoadedDashboard(await dashboard.load(), adaptation);

  const dashboardAdapter = (
    pack: StarterPack,
    itemId: string,
    items: PackRecordItem[],
    adaptation: PackAdaptation,
  ): PackItemAdapter => {
    const dashboard = pack.dashboards.find((candidate) => candidate.id === itemId)!;
    const snapshot: PackItemAdapter["snapshot"] = async ({ id, folderId }) =>
      dashboardBody(await readQuery(dashboardDetailQuery(org, id, folderId!), true));
    const remove: PackItemAdapter["remove"] = async ({ id, folderId }) => {
      await deleteDashboard.mutateAsync({ dashboardId: id, folderId: folderId! });
    };
    const { shared } = dashboard;
    if (shared) {
      return { lookup: () => shared.find(org), create: () => shared.create(org), snapshot, remove };
    }
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
      snapshot,
      remove,
    };
  };

  /** The pack's own changes to a library alert: flavour, repairs, bindings, tags, off. */
  const decorateAlert = async (
    pack: StarterPack,
    { copyOf, itemId, stream }: PackRecordItem,
    payload: Record<string, unknown>,
    adaptation: PackAdaptation,
    flavour?: PackFlavourAlert,
    enabled = false,
    destination?: string,
  ) => {
    const flavoured = withFlavour(payload, flavour);
    const doc = await adaptAlert(flavoured, adaptation, rewriteChecks, stream);
    const own = alertTags(pack.id, copyOf ?? itemId, stream);
    const tags = [...((payload.tags as string[]) ?? []), ...own];
    return {
      ...doc,
      name: stream ? `${doc.name}_${stream}` : doc.name,
      enabled,
      destinations: destination ? [destination] : [],
      tags: [...new Set(tags)],
    };
  };

  const alertAdapter = (
    pack: StarterPack,
    item: PackRecordItem,
    items: PackRecordItem[],
    entries: Map<string, AlertLibraryEntry>,
    adaptation: PackAdaptation,
    flavour?: PackFlavourAlert,
    enabled = false,
    destination?: string,
  ): PackItemAdapter => {
    let savedId: string | undefined;
    return {
      // Alert names and client ids are not unique, so the tags are the only identity.
      lookup: async () => {
        const { copyOf, itemId, stream } = item;
        const tags = alertTags(pack.id, copyOf ?? itemId, stream);
        // The tag filter is a subset match, so the base alert must skip per-stream copies.
        const rows = (await readQuery(alertsByTagsQuery(org, tags), true)).filter(
          (row) => !!stream || !(row.tags ?? []).some((tag: string) => tag.startsWith("stream:")),
        );
        if (rows[0]) return { id: rows[0].alert_id, folderId: rows[0].folder_id };
        // The server's tag search reads a cache that trails a create, so trust the id it returned.
        return savedId ? { id: savedId, folderId: folderIdOf(items, "alerts") } : null;
      },
      create: async () => {
        const entryId = item.copyOf ?? item.itemId;
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
          decoratePayload: (payload) =>
            decorateAlert(pack, item, payload, adaptation, flavour, enabled, destination),
          onSaved: (id) => {
            savedId = id;
          },
        });
      },
      snapshot: async ({ id }) => alertBody(await readQuery(alertDetailQuery(org, id), true)),
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
    enableAlerts = false,
    destination?: string,
  ): PackItemAdapter => {
    if (item.kind === "folder") return folderAdapter(pack, item.itemId as PackFolderType);
    if (item.kind === "dashboard") return dashboardAdapter(pack, item.itemId, items, adaptation);
    if (item.kind === "alert") {
      const id = item.copyOf ?? item.itemId;
      const flavour = flavourAlert(pack, flavours[id], id);
      return alertAdapter(
        pack,
        item,
        items,
        entries,
        adaptation,
        flavour,
        enableAlerts,
        destination,
      );
    }
    return savedViewAdapter(pack, item.itemId, adaptation);
  };

  // A Library install tags only `pack:<group>` and keeps its entry id in `library_id`.
  const readLibraryInstalls = async (
    pack: StarterPack,
    entries: Map<string, AlertLibraryEntry>,
  ): Promise<LibraryInstall[]> => {
    const groups = [...new Set(pack.alerts.flatMap((id) => entries.get(id)?.pack ?? []))];
    const perGroup = await Promise.all(
      groups.map(async (group) => {
        const tags = [`pack:${group}`.toLowerCase()];
        const rows = await readQuery(alertsByTagsQuery(org, tags), true).catch(() => []);
        // A pack's own alert carries a `library:` tag, which the tag lookup already answers.
        const installed = rows.filter(
          (row) => !(row.tags ?? []).some((tag: string) => tag.startsWith("library:")),
        );
        const details = await Promise.all(
          installed.map((row) => readQuery(alertDetailQuery(org, row.alert_id)).catch(() => null)),
        );
        return installed.flatMap((row, index) => {
          const libraryId = details[index]?.context_attributes?.library_id;
          if (typeof libraryId !== "string") return [];
          const found = { id: row.alert_id, folderId: row.folder_id };
          return [{ libraryId, stream: details[index]?.stream_name, found }];
        });
      }),
    );
    return perGroup.flat();
  };

  const planItems = async (
    pack: StarterPack,
    entries: Map<string, AlertLibraryEntry>,
    copies?: PackPreview["copies"],
  ): Promise<PackRecordItem[]> => {
    const installs = await readLibraryInstalls(pack, entries);
    // A per-stream copy is only the Library alert when both read the same stream.
    const fromLibrary = ({ kind, copyOf, itemId, stream }: PackRecordItem) =>
      kind === "alert"
        ? installs.find(
            (row) => row.libraryId === (copyOf ?? itemId) && (!stream || row.stream === stream),
          )?.found
        : undefined;
    const planned: PackRecordItem[] = [];
    for (const item of packItems(pack, copies)) {
      const found =
        (await adapterFor(pack, item, planned, new Map()).lookup()) ?? fromLibrary(item);
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
      return !!found && found.lastIngested > 0;
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
    loaded: Map<string, Record<string, any> | null>,
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
    // A shared dashboard is imported as its importer ships it, so the plan never rewrites it.
    const docs = pack.dashboards.flatMap(({ id, shared }) =>
      shared ? [] : (loaded.get(id) ?? []),
    );
    const sources = await readBindingSources(org, [pack]);
    const plan = await planAdaptation({
      pack,
      streams,
      alerts: [...alerts.values()],
      panels: docs.flatMap(dashboardItems),
      sources,
      choices,
      readers: {
        columns: async (type, name) => new Set(await readSchemaColumns(org, type, name)),
        values: (stream, fields, lastIngested) => readValues(stream, fields, "logs", lastIngested),
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
    // A dashboard the gallery cannot serve is left out like a missing alert, not a failed preview.
    const loaded = new Map(
      await Promise.all(
        pack.dashboards.map(async ({ id, load }) => [id, await load().catch(() => null)] as const),
      ),
    );
    const plan = await adaptationFor(pack, listed, loaded, choices);
    const { repairs, bindings, flavours, alerts, unsupported, streams } = plan;
    const flavoured = listed.map((entry) => flavouredEntry(pack, entry, flavours[entry.id]));
    const verdicts = await matchAlerts(org, flavoured, streams, {
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
    });
    const names: Record<string, string> = {};
    for (const { id, title } of pack.dashboards) names[id] = title;
    for (const { id, name } of pack.savedViews) names[id] = name;
    for (const id of pack.alerts) names[id] = entries.get(id)?.title ?? id;
    const severities: PackPreview["severities"] = {};
    const descriptions: Record<string, string> = {};
    for (const { id } of pack.dashboards) {
      const text = loaded.get(id)?.description;
      if (typeof text === "string" && text) descriptions[id] = text;
    }
    for (const entry of listed) {
      severities[entry.id] = entry.severity;
      if (entry.description) descriptions[entry.id] = entry.description;
    }
    const copies = alertCopies(alerts, repairs);
    for (const { copyOf, stream } of copies) {
      names[copyItemId(copyOf, stream)] = `${names[copyOf]} (${stream})`;
    }

    const panels = { kept: 0, dropped: 0 };
    const noFit = new Map<string, PackNotIncludedReason>();
    for (const dashboard of pack.dashboards) {
      const doc = loaded.get(dashboard.id);
      if (!doc) {
        noFit.set(dashboard.id, "unavailable");
        continue;
      }
      const adaptation = dashboard.shared ? NO_ADAPTATION : { repairs, bindings };
      const fit = await fitLoadedDashboard(doc, adaptation).catch((error) => {
        if (error instanceof StreamRewriteError) return { doc: {}, kept: 0, dropped: 1 };
        throw error;
      });
      panels.kept += fit.kept;
      panels.dropped += fit.dropped;
      if (!fit.kept && fit.dropped) noFit.set(dashboard.id, "no_data");
    }

    const alertReason = (id: string): PackNotIncludedReason | null => {
      if (!entries.get(id)) return "unavailable";
      if (verdicts.get(id)) return null;
      return unsupported.has(id) ? "no_flavour" : "no_data";
    };

    // Install skips only what the preview leaves out, so an unanswered question must not keep it.
    const viewMissing = (itemId: string) => {
      const stream = pack.savedViews.find(({ id }) => id === itemId)?.search?.data?.stream;
      const type = String(stream?.streamType ?? "logs");
      const wanted: string[] = stream?.selectedStream ?? [];
      return wanted.some((name) => !locateStream(name, type, { streams, repairs }));
    };

    const notIncluded: PackNotIncludedItem[] = [];
    const items: PackRecordItem[] = [];
    const reported = new Set<string>();
    for (const item of await planItems(pack, entries, copies)) {
      const name = names[item.itemId] ?? item.itemId;
      const unfit =
        item.kind === "dashboard" && item.status !== "existing" && noFit.get(item.itemId);
      if (unfit) {
        notIncluded.push({ kind: "dashboard", itemId: item.itemId, name, reason: unfit });
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
      } else if (item.kind === "savedView" && viewMissing(item.itemId)) {
        notIncluded.push({ kind: "savedView", itemId: item.itemId, name, reason: "no_data" });
        continue;
      }
      items.push(item);
    }
    return {
      items,
      names,
      severities,
      descriptions,
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
    enableAlerts = false,
    destination?: string,
  ): Promise<PackRecordItem> => {
    const adaptation = { repairs: record.repairs ?? [], bindings: record.bindings ?? [] };
    const adapter = adapterFor(
      pack,
      item,
      items,
      entries,
      adaptation,
      record.flavours,
      enableAlerts,
      destination,
    );
    try {
      let found = await adapter.lookup();
      // Another surface made it first, so the pack links it and never deletes it.
      if (found && isShared(pack, item)) return { ...item, ...found, status: "existing" };
      let made: boolean | void = true;
      if (!found) {
        // A create that errored may still have committed, so only the lookup after it decides.
        made = await adapter.create().catch((error) => {
          if (error instanceof StreamRewriteError) throw error;
        });
        found = await adapter.lookup();
      }
      if (!found) return { ...item, status: "failed" };
      if (made === false) return { ...item, ...found, status: "existing" };
      const body = (await adapter.snapshot(found)) as Record<string, any>;
      const settled = { ...item, ...found, status: "created" as const };
      return { ...settled, sourceHash: contentHash(body) };
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
      enableAlerts = false,
      destination,
    }: PackInstallOptions,
  ): Promise<PackInstallRecord> => {
    const { entries } = await loadEntries(sourcePack);

    const interrupted = (await records.list(sourcePack.id)).find(
      ({ status }) => status === "installing" || status === "incomplete",
    );
    const pack = withFolder(sourcePack, interrupted?.folderName ?? folderName);
    // A resumed record still lists items the current plan leaves out; only made ones stay.
    const excluded = (item: PackRecordItem) =>
      exclude.includes(item.itemId) || exclude.includes(item.copyOf ?? item.itemId);
    const kept = (item: PackRecordItem) => item.status === "created" || !excluded(item);
    const choice = {
      ...(enableAlerts ? { enableAlerts } : {}),
      ...(destination ? { destination } : {}),
    };
    const record: PackInstallRecord = interrupted
      ? {
          ...interrupted,
          enableAlerts: undefined,
          destination: undefined,
          ...choice,
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
          catalogVersion: catalogVersion(),
          ...(repairs.length ? { repairs } : {}),
          ...(bindings.length ? { bindings } : {}),
          ...(Object.keys(flavours).length ? { flavours } : {}),
          ...(folderName ? { folderName } : {}),
          ...choice,
          items: (await planItems(pack, entries, copies)).filter((item) => !excluded(item)),
        };
    await writeFirstRecord(record);
    onProgress?.(record);
    return settleRecord(pack, record, entries, onProgress, enableAlerts, destination);
  };

  const settleRecord = async (
    pack: StarterPack,
    record: PackInstallRecord,
    entries: Map<string, AlertLibraryEntry>,
    onProgress?: PackInstallOptions["onProgress"],
    enableAlerts = false,
    destination?: string,
  ): Promise<PackInstallRecord> => {
    for (let index = 0; index < record.items.length; index += 1) {
      const item = record.items[index];
      if (item.status === "created" || item.status === "existing") continue;
      record.items[index] = await settleItem(
        pack,
        item,
        record.items,
        entries,
        record,
        enableAlerts,
        destination,
      );
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

  const flightKey = (pack: StarterPack) => `${org}\u0000${pack.id}`;

  // Removing while an install runs would leave whatever it creates after the removal read.
  const installSettled = async (pack: StarterPack) => {
    await inFlight.get(flightKey(pack))?.catch(() => null);
  };

  /** Installs the pack, or resumes this pack's interrupted install instead of starting another. */
  const installPack = (
    pack: StarterPack,
    options: PackInstallOptions = {},
  ): Promise<PackInstallRecord> => {
    const key = flightKey(pack);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const run = runInstall(pack, options).finally(() => {
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

  // Org members can edit the install record, so only server-side marks prove the pack made an item.
  const ownsItem = async (
    pack: StarterPack,
    item: PackRecordItem,
    items: PackRecordItem[],
    adapter: PackItemAdapter,
    found: FoundItem,
    body: Record<string, any>,
  ): Promise<boolean> => {
    if (item.kind === "alert") {
      const tags: string[] = body.tags ?? [];
      const own = alertTags(pack.id, item.copyOf ?? item.itemId, item.stream);
      return own.every((tag) => tags.includes(tag));
    }
    if (item.kind !== "dashboard") return true;
    if (isShared(pack, item)) return (await adapter.lookup())?.id === found.id;
    const folderId = folderIdOf(items, "dashboards");
    if (!folderId || found.folderId !== folderId) return false;
    const rows = await readQuery(dashboardsByFolderQuery(org, folderId), true);
    return rows.some((row) => row.dashboard_id === found.id);
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
      } else {
        const body = (await adapter.snapshot(found)) as Record<string, any>;
        if (contentHash(body) !== item.sourceHash) return "changed";
        if (!(await ownsItem(pack, item, items, adapter, found, body))) return "changed";
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
    await installSettled(pack);
    const record = await records.read(pack.id, installId);
    return record ? removeInstall(pack, record) : { removed: [], kept: [] };
  };

  /** Removes the unchanged items of every install of the pack and reports the rest. */
  const removePack = async (pack: StarterPack): Promise<PackRemovalResult> => {
    const result: PackRemovalResult = { removed: [], kept: [] };
    await installSettled(pack);
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

  return {
    installPack,
    previewPack,
    undoPack,
    removePack,
    listInstalls: records.list,
  };
}
