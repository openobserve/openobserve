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

export type TransientKeyMode = "reset" | "strip-only" | "replace";

export type PlainObject = Record<string, unknown>;

export interface TransientSearchKey {
  path: string;
  mode: TransientKeyMode;
  owner: string;
  defaultValue?: () => unknown;
  normaliseOnSave?: (clone: PlainObject, live: PlainObject) => void;
}

export const ITEM2_TRANSIENT_KEYS: TransientSearchKey[] = [
  { path: "meta.executed", mode: "reset", owner: "item2", defaultValue: () => null },
  { path: "meta.pendingExecution", mode: "reset", owner: "item2", defaultValue: () => null },
  { path: "meta.lastRunAttempt", mode: "reset", owner: "item2", defaultValue: () => null },
  { path: "meta.executedPatterns", mode: "reset", owner: "item2", defaultValue: () => null },
  { path: "meta.executedPanel", mode: "reset", owner: "item2", defaultValue: () => null },
  { path: "meta.autoRunBlocked", mode: "reset", owner: "item2", defaultValue: () => null },
  { path: "meta.consentedScope", mode: "reset", owner: "item2", defaultValue: () => null },
  { path: "meta.runPending", mode: "reset", owner: "item2", defaultValue: () => false },
  { path: "meta.runOutcome", mode: "reset", owner: "item2", defaultValue: () => ({}) },
  { path: "meta.runCancelled", mode: "reset", owner: "item2", defaultValue: () => ({}) },
  { path: "meta.editorDirty", mode: "reset", owner: "item2", defaultValue: () => false },
  { path: "meta.nlDetected", mode: "reset", owner: "item2", defaultValue: () => false },
  { path: "meta.liveMode", mode: "strip-only", owner: "item2" },
  { path: "data.customDownloadQueryObj", mode: "reset", owner: "item2" },
];

export const ITEM1_TRANSIENT_KEYS: TransientSearchKey[] = [
  { path: "data.freeTextBlocked", mode: "reset", owner: "item1", defaultValue: () => null },
  { path: "data.freeTextExcluded", mode: "reset", owner: "item1", defaultValue: () => [] },
  { path: "data.freeTextDecorations", mode: "reset", owner: "item1", defaultValue: () => null },
  { path: "meta.freeTextScan", mode: "replace", owner: "item1", defaultValue: () => ({}) },
];

export const ITEM4A_TRANSIENT_KEYS: TransientSearchKey[] = [
  { path: "meta.showDetailTab", mode: "reset", owner: "item4a", defaultValue: () => false },
  {
    path: "meta.resultGrid.navigation.currentRowIndex",
    mode: "reset",
    owner: "item4a",
    defaultValue: () => null,
  },
  {
    path: "meta.resultGrid.navigation.selectionActive",
    mode: "reset",
    owner: "item4a",
    defaultValue: () => false,
  },
  {
    path: "meta.resultGrid.navigation.pendingPageSelection",
    mode: "reset",
    owner: "item4a",
    defaultValue: () => null,
  },
  { path: "data.resultGrid.pageRequest", mode: "reset", owner: "item4a", defaultValue: () => null },
  { path: "data.resultGrid.pageLoad", mode: "reset", owner: "item4a", defaultValue: () => null },
  { path: "data.resultGrid.hitsSettled", mode: "reset", owner: "item4a", defaultValue: () => true },
];

export const TRANSIENT_SEARCH_KEYS: TransientSearchKey[] = [
  ...ITEM2_TRANSIENT_KEYS,
  ...ITEM1_TRANSIENT_KEYS,
  ...ITEM4A_TRANSIENT_KEYS,
];

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function splitPath(path: string): { parents: string[]; leaf: string } {
  const parts = path.split(".");
  return { parents: parts.slice(0, -1), leaf: parts[parts.length - 1] };
}

function parentOf(obj: PlainObject, parents: string[], create: boolean): PlainObject | null {
  let node: PlainObject = obj;
  for (const key of parents) {
    if (!isPlainObject(node[key])) {
      if (!create) return null;
      node[key] = {};
    }
    node = node[key] as PlainObject;
  }
  return node;
}

export function hasPath(obj: PlainObject, path: string): boolean {
  const { parents, leaf } = splitPath(path);
  const parent = parentOf(obj, parents, false);
  return parent !== null && Object.prototype.hasOwnProperty.call(parent, leaf);
}

export function getPath(obj: PlainObject, path: string): unknown {
  const { parents, leaf } = splitPath(path);
  return parentOf(obj, parents, false)?.[leaf];
}

export function setPath(obj: PlainObject, path: string, value: unknown): void {
  const { parents, leaf } = splitPath(path);
  (parentOf(obj, parents, true) as PlainObject)[leaf] = value;
}

export function deletePath(obj: PlainObject, path: string): void {
  const { parents, leaf } = splitPath(path);
  const parent = parentOf(obj, parents, false);
  if (parent) delete parent[leaf];
}

export function stripTransient<T extends PlainObject>(
  obj: T,
  scope: "save" | "strip-only" = "save",
): T {
  for (const entry of TRANSIENT_SEARCH_KEYS) {
    const strip = scope === "save" ? entry.mode !== "replace" : entry.mode === "strip-only";
    if (strip) deletePath(obj, entry.path);
  }
  return obj;
}

export function normaliseOnSave<T extends PlainObject>(clone: T, live: PlainObject): T {
  for (const entry of TRANSIENT_SEARCH_KEYS) entry.normaliseOnSave?.(clone, live);
  return clone;
}

export function prepareSearchForSave<T extends PlainObject>(clone: T, live: PlainObject): T {
  return normaliseOnSave(stripTransient(clone, "save"), live);
}

export function resetTransient<T extends PlainObject>(target: T, incoming?: PlainObject): T {
  for (const entry of TRANSIENT_SEARCH_KEYS) {
    if (entry.mode === "reset") {
      if (entry.defaultValue) setPath(target, entry.path, entry.defaultValue());
      else deletePath(target, entry.path);
    } else if (entry.mode === "replace" && incoming) {
      const value = hasPath(incoming, entry.path)
        ? cloneValue(getPath(incoming, entry.path))
        : entry.defaultValue?.();
      setPath(target, entry.path, value);
    }
  }
  return target;
}

export function applySearchSnapshot<T extends PlainObject>(
  target: T,
  incoming: PlainObject,
  merge: (target: T, source: PlainObject) => unknown,
): T {
  const source = stripTransient(cloneValue(incoming), "strip-only");
  merge(target, source);
  return resetTransient(target, source);
}
