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

import dashboardsService from "@/services/dashboards";
import { dashboardKeys } from "@/services/dashboards.querykeys";
import { folderKeys } from "@/services/common.querykeys";
import { readyMadeCopiesQuery, type ReadyMadeCopy } from "@/services/readyMade.queries";
import { queryClient } from "@/composables/query/queryClient";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import {
  getReadyMadeSource,
  readyMadeMarker,
  type ReadyMadeDashboardRef,
  type ReadyMadeSource,
  type ReadyMadeSourceId,
} from "./catalog";
import { saveReadyMadeStates } from "./readyMadeSettings";

export interface ReadyMadeInstalledDashboard {
  key: string;
  title: string;
  dashboardId: string;
  folderId: string;
  folderName: string;
  /** This call created it; false for a copy that was already in the org. */
  created: boolean;
}

export type ReadyMadeInstallResult =
  | {
      status: "created" | "exists";
      sourceId: ReadyMadeSourceId;
      /** Where the first dashboard lives — the folder the toast names. */
      folderId: string;
      folderName: string;
      /** In catalog order; the first one is what an entry point opens. */
      dashboards: ReadyMadeInstalledDashboard[];
    }
  | {
      status: "error";
      sourceId: ReadyMadeSourceId;
      kind: "forbidden" | "generic";
      message: string;
    };

interface FolderRef {
  folderId: string;
  name: string;
}

interface CreatedCopy {
  dashboardId: string;
  folderId: string;
}

// The interceptor's 403 toast would double the one message each entry point shows.
const SILENT = { silentForbidden: true } as const;

const inFlight = new Map<string, Promise<ReadyMadeInstallResult>>();

/** Installs a source's dashboards (or finds them); every entry point goes through here. */
export function installReadyMade(
  orgId: string,
  sourceId: ReadyMadeSourceId,
  opts: { userId?: string } = {},
): Promise<ReadyMadeInstallResult> {
  const key = `${orgId}\u0000${sourceId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = runInstall(orgId, getReadyMadeSource(sourceId), opts.userId).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, run);
  return run;
}

/** Marked copies of a source; `force` reaches the server, the default reads the cache. */
export async function fetchReadyMadeCopies(
  orgId: string,
  sourceId: ReadyMadeSourceId,
  { force = false }: { force?: boolean } = {},
): Promise<ReadyMadeCopy[]> {
  const options = readyMadeCopiesQuery(orgId, sourceId);
  if (force) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
  }
  return queryClient.fetchQuery(options);
}

const statusOf = (err: any): number | undefined => err?.response?.status ?? err?.status;

async function findFolder(orgId: string, name: string): Promise<FolderRef | null> {
  // Uncached on purpose: create-or-reuse must be decided on the server's answer.
  try {
    const res = await dashboardsService.get_Folder_By_Name(orgId, name, SILENT);
    const folderId = res.data?.folderId;
    return folderId ? { folderId, name: res.data?.name ?? name } : null;
  } catch (err) {
    if (statusOf(err) === 404) return null;
    throw err;
  }
}

async function ensureFolder(orgId: string, source: ReadyMadeSource): Promise<FolderRef> {
  const existing = await findFolder(orgId, source.folderName);
  if (existing) return existing;
  try {
    const res = await dashboardsService.new_Folder(
      orgId,
      { name: source.folderName, description: "", icon: source.glyph },
      SILENT,
    );
    const folderId = res.data?.folderId;
    if (!folderId) throw new Error("folder create response carried no id");
    return { folderId, name: res.data?.name ?? source.folderName };
  } catch (err) {
    // Another client may have created it between the lookup and the create.
    const raced = await findFolder(orgId, source.folderName).catch(() => null);
    if (raced) return raced;
    throw err;
  } finally {
    // The dashboards scope does not cover folders, so the rail's cache must be told separately.
    void queryClient.invalidateQueries({ queryKey: folderKeys.all(orgId) });
  }
}

async function createCopy(
  orgId: string,
  source: ReadyMadeSource,
  ref: ReadyMadeDashboardRef,
  doc: Record<string, any> | undefined,
  folderId: string,
): Promise<CreatedCopy> {
  if (!doc) throw new Error(`no bundled document for ${source.id}/${ref.key}`);
  const prepared = convertDashboardSchemaVersion(structuredClone(doc));
  const res = await dashboardsService.create(
    orgId,
    {
      ...prepared,
      dashboardId: "",
      title: ref.title,
      role: readyMadeMarker(source.id, ref.key),
      created: new Date().toISOString(),
    },
    folderId,
    SILENT,
  );
  const dashboardId = res.data?.[`v${res.data?.version}`]?.dashboardId;
  // Without an id there is nothing to open — fail rather than report a blank target.
  if (!dashboardId) throw new Error("create response carried no dashboard id");
  return { dashboardId, folderId };
}

/** Keeps the oldest copy per key; deletes only this client's own losing copies. */
async function settleRaces(
  orgId: string,
  copies: ReadyMadeCopy[],
  created: Map<string, CreatedCopy>,
): Promise<ReadyMadeCopy[]> {
  const dropped = new Set<string>();
  for (const [key, mine] of created) {
    const winner = copies.find((copy) => copy.key === key);
    if (!winner || winner.dashboardId === mine.dashboardId) continue;
    if (!copies.some((copy) => copy.dashboardId === mine.dashboardId)) continue;
    try {
      await dashboardsService.delete(orgId, mine.dashboardId, mine.folderId, SILENT);
      dropped.add(mine.dashboardId);
    } catch {
      // A leftover duplicate is harmless; the oldest copy is still the one everyone opens.
    }
  }
  return copies.filter((copy) => !dropped.has(copy.dashboardId));
}

function resolveDashboards(
  source: ReadyMadeSource,
  copies: ReadyMadeCopy[],
  created: Map<string, CreatedCopy>,
  folder: FolderRef | null,
): ReadyMadeInstalledDashboard[] {
  return source.dashboards.map((ref) => {
    const copy = copies.find((candidate) => candidate.key === ref.key);
    const mine = created.get(ref.key);
    if (copy) {
      // A fresh copy that lost a create race was deleted, so the survivor is not this call's.
      const isMine = mine?.dashboardId === copy.dashboardId;
      return { key: ref.key, title: ref.title, ...pickCopy(copy), created: isMine };
    }
    // The re-list may lag our own create; fall back to what the create returned.
    return {
      key: ref.key,
      title: ref.title,
      dashboardId: mine!.dashboardId,
      folderId: mine!.folderId,
      folderName: folder?.name ?? source.folderName,
      created: true,
    };
  });
}

const pickCopy = (copy: ReadyMadeCopy) => ({
  dashboardId: copy.dashboardId,
  folderId: copy.folderId,
  folderName: copy.folderName,
});

async function createMissing(
  orgId: string,
  source: ReadyMadeSource,
  missing: ReadyMadeDashboardRef[],
  created: Map<string, CreatedCopy>,
): Promise<FolderRef> {
  const folder = await ensureFolder(orgId, source);
  const docs = await source.load(orgId);
  for (const ref of missing) {
    const doc = docs[source.dashboards.indexOf(ref)];
    created.set(ref.key, await createCopy(orgId, source, ref, doc, folder.folderId));
  }
  return folder;
}

async function runInstall(
  orgId: string,
  source: ReadyMadeSource,
  userId: string | undefined,
): Promise<ReadyMadeInstallResult> {
  const created = new Map<string, CreatedCopy>();
  try {
    let copies = await fetchReadyMadeCopies(orgId, source.id, { force: true });
    const missing = source.dashboards.filter((ref) => !copies.some((copy) => copy.key === ref.key));
    let folder: FolderRef | null = null;
    if (missing.length > 0) {
      folder = await createMissing(orgId, source, missing, created);
      copies = await settleRaces(
        orgId,
        await fetchReadyMadeCopies(orgId, source.id, { force: true }),
        created,
      );
    }
    const dashboards = resolveDashboards(source, copies, created, folder);
    if (userId) await saveReadyMadeStates(orgId, userId, { [source.id]: "added" });
    return {
      status: dashboards.some((dashboard) => dashboard.created) ? "created" : "exists",
      sourceId: source.id,
      folderId: dashboards[0].folderId,
      folderName: dashboards[0].folderName,
      dashboards,
    };
  } catch (err: any) {
    return {
      status: "error",
      sourceId: source.id,
      kind: statusOf(err) === 403 ? "forbidden" : "generic",
      message: err?.message ?? String(err),
    };
  } finally {
    // Creates bypass the dashboards query, so every cached list (and the marked-copy lookups) must be told.
    if (created.size > 0)
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all(orgId) });
  }
}
