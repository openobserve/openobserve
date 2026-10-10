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

export const activePermalink = shallowRef<ActivePermalink | null>(null);

export const permalinkBanner = shallowRef<PermalinkBanner | null>(null);

export const sharedLineRecord = shallowRef<LogRow | null>(null);

export const permalinkRowIndex = ref<number | null>(null);

export const columnsFromUrl = ref(false);

export const searchResultMounts = ref(0);

export const permalinkResolving = ref(false);

export const permalinkHighlightTs = computed<number | null>(() => {
  const active = activePermalink.value;
  if (!active?.outcome || active.outcome.state !== "ambiguous") return null;
  return active.link.id === undefined && active.link.fp === undefined ? active.link.ts : null;
});

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

export function initOriginForRun(origin: string | null | undefined): string | undefined {
  return isInitOrigin(origin) ? (origin as string) : undefined;
}

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

export function noteUserScopeChange(): void {
  noteGridQuery(undefined);
}

export function initGenerationId(): number | null {
  return initGeneration;
}

export function replaceResolveController(next: AbortController | null): void {
  if (resolveController && resolveController !== next) resolveController.abort();
  resolveController = next;
}

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

export function resetPermalinkForTests(): void {
  resetPermalinkState();
  columnsFromUrl.value = false;
  searchResultMounts.value = 0;
  generationCounter = 0;
}
