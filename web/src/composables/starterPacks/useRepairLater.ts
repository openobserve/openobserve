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
import { ref, shallowRef } from "vue";

import { readQuery } from "@/composables/query/readQuery";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import { alertDetailQuery, saveAlertMutation } from "@/services/alerts.queries";
import dashboards from "@/services/dashboards";
import { dashboardDetailQuery } from "@/services/dashboards.queries";
import { streamNameListQuery } from "@/services/stream.queries";

import { dashboardStreams, queryNeeds } from "./dashboardFit";
import { STARTER_PACKS } from "./kubernetesPack";
import { readSchemaColumns } from "./packMatchData";
import {
  panelHash,
  panelReads,
  pickReplacement,
  repointDashboard,
  startedSince,
  streamStats,
  type StreamStat,
} from "./repairLater";
import { rewriteAlert, type StreamRename } from "./streamRewriter";
import type { PackInstallRecord, PackRecordItem, PackRepair, StarterPack } from "./types";
import { contentHash, useInstallRecords } from "./useInstallRecords";
import { STALE_AFTER_US } from "./usePackHealth";
import { UNDO_WINDOW_US } from "./useStarterPackFlow";
import { useRewriteChecks } from "./useRewriteChecks";
import { alertBody, dashboardBody, nullIfMissing } from "./useStarterPacks";

type Doc = Record<string, any>;

export interface RepairScope {
  packId?: string;
  dashboardId?: string;
}

export interface RepairIssue {
  pack: StarterPack;
  record: PackInstallRecord;
  from: string;
  to: string;
  lastUs: number;
  startedUs: number;
  panels: number;
  alerts: number;
}

interface InstallRef {
  pack: StarterPack;
  record: PackInstallRecord;
}

interface Touched {
  panels: Record<string, string[]>;
  alerts: string[];
}

const STREAM_TYPES = ["logs", "metrics", "traces"];

const panelsOf = (doc: Doc): Doc[] => (doc.tabs ?? []).flatMap((tab: Doc) => tab.panels ?? []);

// The server never updates `stream_name`, so the query says what a repaired alert reads.
export const alertStreams = ({ query_condition: condition }: Doc): Set<string> => {
  if (condition?.type === "promql") return queryNeeds(condition.promql ?? "", "promql").streams;
  return queryNeeds(condition?.sql ?? "", "sql").streams;
};

const minus = (done: Touched, back: Touched): Touched => ({
  panels: Object.fromEntries(
    Object.entries(done.panels).map(([id, ids]) => [
      id,
      ids.filter((panel) => !back.panels[id]?.includes(panel)),
    ]),
  ),
  alerts: done.alerts.filter((id) => !back.alerts.includes(id)),
});

/** A chain of repairs keeps pointing at the newest name, so a later update reads the live stream. */
export const chainRepair = (repairs: PackRepair[], { from, to }: StreamRename): PackRepair[] => {
  const chained = repairs.map((repair) => (repair.to === from ? { ...repair, to } : repair));
  return chained.some((repair) => repair.to === to) ? chained : [...chained, { from, to }];
};

/** Streams of pack items that went quiet while a stream with the same fields started, fixed in one action. */
export function useRepairLater(org: string) {
  const records = useInstallRecords(org);
  const checks = useRewriteChecks(org);
  const saveAlert = useMutation(() => saveAlertMutation(org, () => true));
  const issue = shallowRef<RepairIssue | null>(null);
  const undoable = shallowRef<InstallRef | null>(null);
  const busy = ref(false);
  const failed = ref(false);

  const installs = async ({ packId, dashboardId }: RepairScope): Promise<InstallRef[]> => {
    const packs = STARTER_PACKS.filter((pack) => !packId || pack.id === packId);
    const lists = await Promise.all(
      packs.map(async (pack) =>
        (await records.list(pack.id))
          .filter(({ status }) => status !== "removed")
          .map((record) => ({ pack, record })),
      ),
    );
    return lists
      .flat()
      .filter(
        ({ record }) =>
          !dashboardId ||
          record.items.some(({ kind, id }) => kind === "dashboard" && id === dashboardId),
      );
  };

  const readDashboard = (item: PackRecordItem) =>
    readQuery(dashboardDetailQuery(org, item.id!, item.folderId ?? "default"), true).catch(
      nullIfMissing,
    );
  const readAlert = (id: string) => readQuery(alertDetailQuery(org, id), true).catch(nullIfMissing);

  /** Panels still as the pack wrote them; an install from before panel hashes knows only the whole dashboard. */
  const oursIn = (item: PackRecordItem, body: Doc, only?: string[]) => {
    const whole = !item.panelHashes && contentHash(body) === item.sourceHash;
    return (panel: Doc) =>
      (!only || only.includes(panel.id)) &&
      (whole || item.panelHashes?.[panel.id] === panelHash(panel));
  };

  const readStats = async (): Promise<StreamStat[]> => {
    const lists = await Promise.all(
      STREAM_TYPES.map(async (type) =>
        streamStats(await readQuery(streamNameListQuery(org, type)).catch(() => []), type),
      ),
    );
    return lists.flat();
  };

  const readBodies = async (record: PackInstallRecord) => {
    const owned = record.items.filter(({ id, status }) => id && status !== "existing");
    const docs: Array<{ item: PackRecordItem; body: Doc }> = [];
    const alerts: Doc[] = [];
    for (const item of owned) {
      if (item.kind === "dashboard") {
        const data = await readDashboard(item);
        if (data) docs.push({ item, body: dashboardBody(data) });
      } else if (item.kind === "alert") {
        const alert = await readAlert(item.id!);
        if (alert) alerts.push(alert);
      }
    }
    return { docs, alerts };
  };

  const replacementFor = async (stale: StreamStat, stats: StreamStat[], nowUs: number) => {
    const started = startedSince(stale, stats, nowUs);
    if (!started.length) return null;
    const columnsOf = async (stat: StreamStat) =>
      new Set(await readSchemaColumns(org, stat.type, stat.name, true));
    const wanted = await columnsOf(stale);
    const withColumns = await Promise.all(
      started.map(async (stat) => ({ stat, columns: await columnsOf(stat) })),
    );
    return pickReplacement(wanted, withColumns);
  };

  const findIssue = async (
    { pack, record }: InstallRef,
    stats: StreamStat[],
    nowUs: number,
  ): Promise<RepairIssue | null> => {
    const { docs, alerts } = await readBodies(record);
    const read = new Set([
      ...docs.flatMap(({ body }) => dashboardStreams(body)),
      ...alerts.flatMap((alert) => [...alertStreams(alert)]),
    ]);
    const quiet = stats.filter(
      ({ name, lastUs }) => read.has(name) && lastUs > 0 && nowUs - lastUs >= STALE_AFTER_US,
    );
    for (const stale of quiet) {
      const to = await replacementFor(stale, stats, nowUs);
      if (!to) continue;
      // Only what the repair would move counts, so the chip never promises edited panels.
      const panels = docs.flatMap(({ item, body }) =>
        panelsOf(body).filter(
          (panel) => panelReads(panel, stale.name) && oursIn(item, body)(panel),
        ),
      );
      const alertCount = alerts.filter((alert) => alertStreams(alert).has(stale.name)).length;
      if (!panels.length && !alertCount) continue;
      const at = { lastUs: stale.lastUs, startedUs: to.firstUs };
      return {
        pack,
        record,
        from: stale.name,
        to: to.name,
        ...at,
        panels: panels.length,
        alerts: alertCount,
      };
    }
    return null;
  };

  const check = async (scope: RepairScope) => {
    if (!STARTER_PACKS_ENABLED) return;
    try {
      const nowUs = Date.now() * 1000;
      const found = await installs(scope);
      undoable.value =
        found.find(
          ({ record }) => record.laterRepair && nowUs - record.laterRepair.at < UNDO_WINDOW_US,
        ) ?? null;
      issue.value = null;
      if (!found.length) return;
      const stats = await readStats();
      for (const install of found) {
        issue.value = await findIssue(install, stats, nowUs);
        if (issue.value) return;
      }
    } catch {
      issue.value = null;
    }
  };

  const repointPanels = async (item: PackRecordItem, rename: StreamRename, only?: string[]) => {
    const data = await readDashboard(item);
    if (!data) return [];
    const body = dashboardBody(data);
    const unedited = contentHash(body) === item.sourceHash;
    const { doc, moved } = await repointDashboard(body, rename, oursIn(item, body, only), checks);
    if (!moved.length) return [];
    const saved = { ...doc, updatedAt: Date.now() * 1000 };
    await dashboards.save(org, item.id!, saved, item.folderId, data.hash);
    const hashes = { ...item.panelHashes };
    for (const panel of panelsOf(doc))
      if (moved.includes(panel.id)) hashes[panel.id] = panelHash(panel);
    item.panelHashes = hashes;
    if (unedited) {
      const fresh = await readDashboard(item);
      if (fresh) item.sourceHash = contentHash(dashboardBody(fresh));
    }
    return moved;
  };

  const repointAlert = async (item: PackRecordItem, rename: StreamRename) => {
    const alert = await readAlert(item.id!);
    if (!alert) return false;
    const unedited = contentHash(alertBody(alert)) === item.sourceHash;
    const { doc, changed } = await rewriteAlert(alert, [rename], checks);
    if (!changed) return false;
    await saveAlert.mutateAsync({ payload: doc, folderId: item.folderId });
    const fresh = unedited ? await readAlert(item.id!) : null;
    if (fresh) item.sourceHash = contentHash(alertBody(fresh));
    return true;
  };

  /** Moves item by item and reports after each save, so a later failure still leaves an Undo for what moved. */
  const repoint = async (
    record: PackInstallRecord,
    rename: StreamRename,
    onStep: (touched: Touched) => Promise<unknown>,
    only?: Touched,
  ) => {
    const touched: Touched = { panels: {}, alerts: [] };
    for (const item of record.items) {
      if (!item.id || item.status === "existing") continue;
      if (item.kind === "dashboard") {
        const moved = await repointPanels(item, rename, only?.panels[item.itemId] ?? (only && []));
        if (!moved.length) continue;
        touched.panels[item.itemId] = moved;
      } else if (item.kind === "alert" && (!only || only.alerts.includes(item.itemId))) {
        if (!(await repointAlert(item, rename))) continue;
        touched.alerts.push(item.itemId);
      } else {
        continue;
      }
      await onStep(touched);
    }
  };

  const run = async (work: () => Promise<void>, scope: RepairScope) => {
    busy.value = true;
    failed.value = false;
    try {
      await work();
      await check(scope);
      return true;
    } catch {
      failed.value = true;
      // Part of the work may have landed, so Undo and the remaining issue come from the stored record.
      await check(scope);
      return false;
    } finally {
      busy.value = false;
    }
  };

  /** Repoints every affected panel and alert, keeping panels the user changed. */
  const apply = (scope: RepairScope) =>
    run(async () => {
      const current = issue.value;
      if (!current) return;
      const { record, from, to } = current;
      // A retry after a partial failure extends the same repair, so one Undo covers both runs.
      const prior = record.laterRepair?.from === from && record.laterRepair.to === to;
      const earlier = prior ? record.laterRepair! : null;
      const repairsBefore = earlier?.repairsBefore ?? record.repairs ?? [];
      const repairs = chainRepair(repairsBefore, { from, to });
      const at = earlier?.at ?? Date.now() * 1000;
      const union = (touched: Touched): Touched => ({
        panels: Object.fromEntries(
          [...new Set([...Object.keys(earlier?.panels ?? {}), ...Object.keys(touched.panels)])].map(
            (id) => [
              id,
              [...new Set([...(earlier?.panels[id] ?? []), ...(touched.panels[id] ?? [])])],
            ],
          ),
        ),
        alerts: [...new Set([...(earlier?.alerts ?? []), ...touched.alerts])],
      });
      await repoint(record, { from, to }, (touched) =>
        records.write({
          ...record,
          repairs,
          laterRepair: { from, to, at, ...union(touched), repairsBefore },
        }),
      );
    }, scope);

  /** Points the repaired items back, within a day of the repair. */
  const undo = (scope: RepairScope) =>
    run(async () => {
      const record = undoable.value?.record;
      const done = record?.laterRepair;
      if (!record || !done) return;
      const back = { from: done.to, to: done.from };
      await repoint(
        record,
        back,
        (moved) => records.write({ ...record, laterRepair: { ...done, ...minus(done, moved) } }),
        done,
      );
      const { laterRepair: _laterRepair, ...rest } = record;
      await records.write({ ...rest, repairs: done.repairsBefore });
    }, scope);

  return { apply, busy, check, failed, issue, undo, undoable };
}
