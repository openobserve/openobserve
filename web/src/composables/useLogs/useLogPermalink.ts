//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, ref, shallowRef } from "vue";
import type { LineLink, LogRow, PermalinkOutcome } from "@/utils/logs/logPermalink";
import { dropLineLinkParams, sharedPage, sharedPageNotice } from "@/composables/useLogs/useLogsUrl";
import { drawerCloseExemptions, type DrawerCloseExemption } from "@/composables/useLogs/logsRowNav";

export const PERMALINK_INIT_ORIGIN = "permalink-init";

/** The shared line being opened; module state, never in searchObj, so saved views and the store snapshot cannot carry it. */
export const activePermalink = shallowRef<ActivePermalink | null>(null);

/** The banner outlives the permalink: it stays until dismissed (C5 step 6). */
export const permalinkBanner = shallowRef<PermalinkBanner | null>(null);

/** The resolved record shown in the drawer while the permalink is open (`found`). */
export const sharedLineRecord = shallowRef<LogRow | null>(null);

/** Loaded row the shared line maps to, for the `o2-log-permalink-row` hook. */
export const permalinkRowIndex = ref<number | null>(null);

/** C7 `columns`: while set, rendered columns come only from the link and nothing is persisted. */
export const columnsFromUrl = ref(false);

/** How many SearchResult instances are mounted; the page-level drawer stands in while it is zero. */
export const searchResultMounts = ref(0);

export const permalinkResolving = ref(false);

/** Timestamp whose loaded rows are highlighted for an ambiguous timestamp link (DECISIONS, S-C3). */
export const permalinkHighlightTs = computed<number | null>(() => {
  const active = activePermalink.value;
  if (!active?.outcome || active.outcome.state !== "ambiguous") return null;
  return active.link.id === undefined && active.link.fp === undefined ? active.link.ts : null;
});

/** 4a drawer-close exemption for the permalink-init search, so it does not close the shared line. */
export const permalinkCloseExemption: DrawerCloseExemption = ({ origin }) =>
  isInitOrigin(origin) && !!sharedLineRecord.value;

let generationCounter = 0;

let initToken: string | null = null;

let initGeneration: number | null = null;

let resolveController: AbortController | null = null;

if (!drawerCloseExemptions.includes(permalinkCloseExemption)) {
  drawerCloseExemptions.push(permalinkCloseExemption);
}

export interface ActivePermalink {
  org: string;
  link: LineLink;
  generation: number;
  multiStream: boolean;
  regions: string[];
  clusters: string[];
  outcome: PermalinkOutcome | null;
}

export interface PermalinkBanner extends PermalinkOutcome {
  generation: number;
  stream: string;
  ts: number;
}

/** Starts a new initial-load session: the one-shot init origin the restore hands to the first search. */
export function mintInitOrigin(): { token: string; generation: number } {
  generationCounter += 1;
  initToken = `${PERMALINK_INIT_ORIGIN}:${generationCounter}`;
  initGeneration = null;
  return { token: initToken, generation: generationCounter };
}

export function currentInitOrigin(): string | null {
  return initToken;
}

export function isInitOrigin(origin: string | null | undefined): boolean {
  return !!origin && origin === initToken;
}

/** The origin a run hands its executor; a user change has already revoked the token, so a merged run cannot inherit it. */
export function initOriginForRun(origin: string | null | undefined): string | undefined {
  return isInitOrigin(origin) ? (origin as string) : undefined;
}

/** Called by every grid query: one without the init token is a user search, which ends the permalink and the page notice. */
export function noteGridQuery(origin: string | null | undefined, generationId?: number): void {
  if (isInitOrigin(origin)) {
    initGeneration = generationId ?? initGeneration;
    return;
  }
  initToken = null;
  initGeneration = null;
  sharedPage.value = null;
  sharedPageNotice.value = null;
  clearPermalink();
}

/** A user refinement (stream, time, filter…) ends the shared line and the page notice even if it runs nothing. */
export function noteUserScopeChange(): void {
  noteGridQuery(undefined);
}

export function initGenerationId(): number | null {
  return initGeneration;
}

/** Hands the resolve its abort controller; the previous one is aborted. */
export function replaceResolveController(next: AbortController | null): void {
  if (resolveController && resolveController !== next) resolveController.abort();
  resolveController = next;
}

/** Ends the permalink: aborts a pending resolve, drops the drawer record and `log_*` from the URL (replace). */
export function clearPermalink(): void {
  replaceResolveController(null);
  permalinkResolving.value = false;
  const hadPermalink = !!activePermalink.value;
  activePermalink.value = null;
  sharedLineRecord.value = null;
  permalinkRowIndex.value = null;
  if (hadPermalink) void dropLineLinkParams();
}

export function dismissPermalinkBanner(): void {
  permalinkBanner.value = null;
}

/** Leaving Logs, an org change or a new link: nothing of the old permalink survives. */
export function resetPermalinkState(): void {
  replaceResolveController(null);
  permalinkResolving.value = false;
  activePermalink.value = null;
  permalinkBanner.value = null;
  sharedLineRecord.value = null;
  permalinkRowIndex.value = null;
  initToken = null;
  initGeneration = null;
}

export function clearColumnsFromUrl(): void {
  columnsFromUrl.value = false;
}

/** Test hook: back to a fresh module. */
export function resetPermalinkForTests(): void {
  resetPermalinkState();
  columnsFromUrl.value = false;
  searchResultMounts.value = 0;
  generationCounter = 0;
}
