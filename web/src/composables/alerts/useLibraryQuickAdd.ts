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

import { ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { alertTypeOf, packLabel } from "@/components/alertLibrary/libraryFacets";
import { buildAnomalyInstallPayload } from "@/components/alertLibrary/libraryInstall";
import {
  buildQuickAddPayload,
  countEstimatedFires,
  estimateQuery,
  NOISY_FIRE_LIMIT,
  type RangeSeries,
} from "@/components/alertLibrary/libraryQuickAdd";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import {
  ORG_DEFAULT_DESTINATION_KEY,
  orgDefaultDestinationOf,
} from "@/composables/alerts/useEmailMeDestination";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import { destinationsQuery } from "@/services/alert_destination.queries";
import alertsService from "@/services/alerts";
import { alertKeys } from "@/services/alerts.querykeys";
import anomalyService from "@/services/anomaly_detection";
import { anomalyKeys } from "@/services/anomaly_detection.querykeys";
import searchService from "@/services/search";
import { settingQuery } from "@/services/settings.queries";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { createFolderByType, getFoldersListByType } from "@/utils/commons";

const DAY_MICROS = 24 * 60 * 60 * 1_000_000;

export interface QuickAddDeps {
  /** A library entry now has an alert in this org. */
  onAdded: (entryId: string) => void;
  /** Undo removed the alert an add created. */
  onRemoved: (entryId: string) => void;
}

/** A caller that already knows the route or the estimate, as a pack review does. */
export interface InstallOptions {
  /** A destination name, or "" for none; the org default when absent. */
  destination?: string;
  /** Yesterday's fires; estimated here when absent. */
  fires?: number | null;
}

interface CreatedAlert {
  entry: AlertLibraryEntry;
  alertId: string;
  folderId: string;
  name: string;
  anomaly: boolean;
}

interface Installed {
  created: CreatedAlert;
  fires: number | null;
  folderName: string;
}

const serverMessage = (error: any): string | undefined =>
  error?.response?.data?.message ?? error?.response?.data?.error;

/** Anomaly rules learn their own band, so they install without an estimate. */
export const isAnomalyRule = (entry: AlertLibraryEntry, file: AlertLibraryFile): boolean =>
  alertTypeOf(entry) === "anomaly" || file.alert_type === "anomaly_detection";

/** One-click library add: 24 h estimate, org defaults, pack folder, and a toast with Undo and Edit. */
export function useLibraryQuickAdd(deps: QuickAddDeps) {
  const store = useStore();
  const router = useRouter();
  const { t } = useI18nTyped();
  const { loadAlertFile } = useAlertLibrary();
  const org = (): string => store.state.selectedOrganization?.identifier ?? "";

  const adding = ref<Set<string>>(new Set());
  // Two adds from one pack racing must not create its folder twice.
  const foldersInFlight = new Map<string, Promise<{ id: string; name: string }>>();

  const setAdding = (id: string, busy: boolean) => {
    const next = new Set(adding.value);
    if (busy) next.add(id);
    else next.delete(id);
    adding.value = next;
  };

  const isAdding = (id: string): boolean => adding.value.has(id);

  // An estimate that cannot be read is no estimate: the add proceeds as the file says.
  const estimateFires = async (file: Record<string, unknown>): Promise<number | null> => {
    const query = estimateQuery(file);
    if (!query) return null;
    const end = Date.now() * 1000;
    try {
      const response = await searchService.metrics_query_range({
        org_identifier: org(),
        query: query.expression,
        start_time: end - DAY_MICROS,
        end_time: end,
        step: `${Math.max(1, query.frequencyMinutes) * 60}s`,
      });
      const body = response?.data;
      if (body?.status !== "success" || !Array.isArray(body?.data?.result)) return null;
      return countEstimatedFires(
        body.data.result as RangeSeries[],
        query.frequencyMinutes,
        query.silenceMinutes,
      );
    } catch {
      return null;
    }
  };

  const defaultDestination = async (): Promise<string> => {
    try {
      const [list, setting] = await Promise.all([
        queryClient.fetchQuery(destinationsQuery(org(), "alert")),
        queryClient.fetchQuery(settingQuery(org(), ORG_DEFAULT_DESTINATION_KEY)),
      ]);
      const name = orgDefaultDestinationOf(setting);
      return name && list.some((destination: any) => destination?.name === name) ? name : "";
    } catch {
      return "";
    }
  };

  const findOrCreateFolder = async (name: string): Promise<{ id: string; name: string }> => {
    const folders = ((await getFoldersListByType(store, "alerts")) ?? []) as Array<{
      name?: string;
      folderId?: string;
    }>;
    const existing = folders.find(
      (folder) => folder?.folderId && folder.name?.trim().toLowerCase() === name.toLowerCase(),
    );
    if (existing?.folderId) return { id: existing.folderId, name: existing.name ?? name };
    const created: any = await createFolderByType(store, { name, description: "" }, "alerts");
    const folderId = created?.data?.folderId ?? created?.folderId;
    if (!folderId) throw new Error(name);
    return { id: folderId, name };
  };

  const packFolder = (entry: AlertLibraryEntry): Promise<{ id: string; name: string }> => {
    const name = String(packLabel(entry.pack));
    const key = name.toLowerCase();
    const pending = foldersInFlight.get(key) ?? findOrCreateFolder(name);
    foldersInFlight.set(key, pending);
    return pending.finally(() => {
      if (foldersInFlight.get(key) === pending) foldersInFlight.delete(key);
    });
  };

  const addedMessage = (title: I18nText, folder: I18nText, installed: Installed): I18nText => {
    const { fires } = installed;
    if (installed.created.anomaly)
      return t("alert_library.quickAdd.addedAnomaly", { title, folder });
    if (fires === null) return t("alert_library.quickAdd.addedNotEstimated", { title, folder });
    if (fires > NOISY_FIRE_LIMIT) {
      return t("alert_library.quickAdd.addedPaused", { title, folder, count: fires });
    }
    return t("alert_library.quickAdd.addedEstimated", { title, folder, count: fires }, fires);
  };

  const undo = async (created: CreatedAlert) => {
    const title = raw(created.entry.title);
    try {
      if (created.anomaly) await anomalyService.delete(org(), created.alertId);
      else await alertsService.delete_by_alert_id(org(), created.alertId, created.folderId);
      await invalidate(created.anomaly);
      deps.onRemoved(created.entry.id);
      toast({ variant: "success", message: t("alert_library.quickAdd.removed", { title }) });
    } catch (error) {
      toast({
        variant: "error",
        message: raw(serverMessage(error)) || t("alert_library.quickAdd.removeFailed", { title }),
      });
    }
  };

  const edit = (created: CreatedAlert) => {
    if (created.anomaly) {
      void router.push({
        name: "editAnomalyDetection",
        params: { anomaly_id: created.alertId },
        query: { org_identifier: org(), folder: created.folderId },
      });
      return;
    }
    void router.push({
      name: "alertList",
      query: {
        alert_id: created.alertId,
        action: "update",
        name: created.name,
        org_identifier: org(),
        folder: created.folderId,
      },
    });
  };

  // The Alerts list shows anomaly configs too, so both scopes drop after an anomaly write.
  const invalidate = async (anomaly: boolean) => {
    await queryClient.invalidateQueries({ queryKey: alertKeys.all(org()) });
    if (anomaly) await queryClient.invalidateQueries({ queryKey: anomalyKeys.all(org()) });
  };

  // Anomaly rules learn their own band, so there is no 24 h estimate to run.
  const installAnomaly = async (
    entry: AlertLibraryEntry,
    file: AlertLibraryFile,
    options: InstallOptions,
  ): Promise<Installed> => {
    const [destination, folder] = await Promise.all([
      options.destination ?? defaultDestination(),
      packFolder(entry),
    ]);
    const payload = buildAnomalyInstallPayload({ entry, file, folderId: folder.id, destination });
    const response: any = await anomalyService.create(org(), payload, folder.id);
    await invalidate(true);
    const created: CreatedAlert = {
      entry,
      alertId: String(response?.data?.anomaly_id ?? response?.data?.id ?? ""),
      folderId: folder.id,
      name: String(payload.name ?? ""),
      anomaly: true,
    };
    return { created, fires: null, folderName: folder.name };
  };

  /** Creates the rule in its pack folder, paused when noisy; throws the server's error. */
  const install = async (
    entry: AlertLibraryEntry,
    options: InstallOptions = {},
  ): Promise<Installed> => {
    const file = await loadAlertFile(entry);
    // The file is checked too: the wizard does the same, since the manifest list is what stamps the type.
    if (isAnomalyRule(entry, file)) return installAnomaly(entry, file, options);
    const [fires, destination, folder] = await Promise.all([
      options.fires !== undefined ? options.fires : estimateFires(file),
      options.destination ?? defaultDestination(),
      packFolder(entry),
    ]);
    const payload = buildQuickAddPayload(
      {
        entry,
        file,
        folderId: folder.id,
        destination,
        owner: store.state.userInfo?.email ?? "",
        timezone: store.state.timezone,
      },
      fires,
    );
    const response: any = await alertsService.create_by_alert_id(org(), payload, folder.id);
    await invalidate(false);
    const created: CreatedAlert = {
      entry,
      alertId: String(response?.data?.id ?? ""),
      folderId: folder.id,
      name: String(payload.name ?? ""),
      anomaly: false,
    };
    return { created, fires, folderName: folder.name };
  };

  /** Adds one library rule with defaults; failures toast the server's reason. */
  const add = async (entry: AlertLibraryEntry): Promise<void> => {
    if (isAdding(entry.id)) return;
    setAdding(entry.id, true);
    const title = raw(entry.title);
    try {
      const installed = await install(entry);
      const { created } = installed;
      deps.onAdded(entry.id);
      toast({
        variant: "success",
        message: addedMessage(title, raw(installed.folderName), installed),
        timeout: 10000,
        action: { label: t("alert_library.quickAdd.undo"), handler: () => void undo(created) },
        secondaryAction: { label: t("common.edit"), handler: () => edit(created) },
      });
    } catch (error) {
      toast({
        variant: "error",
        message: raw(serverMessage(error)) || t("alert_library.quickAdd.failed", { title }),
      });
    } finally {
      setAdding(entry.id, false);
    }
  };

  return { add, isAdding, install, estimateFires };
}
