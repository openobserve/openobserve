// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { cloneDeep } from "lodash-es";
import { getUUID } from "@/utils/zincutils";
import {
  convertV0ToV2,
  convertV1BEToV2,
  convertV1ToV2,
  detectConditionsVersion,
  ensureIds,
} from "./alertDataTransforms";

/** A V0/V1 rule shown as V2, with what it looked like when loaded. */
export interface LegacyAlertConditions {
  raw: unknown;
  converted: string;
}

export interface LoadedAlertConditions {
  /** The V2 tree the form and the condition builder work on. */
  tree: any;
  legacy: LegacyAlertConditions | null;
}

const emptyTree = () => ({
  filterType: "group",
  logicalOperator: "AND",
  conditions: [],
  groupId: getUUID(),
});

const legacyOf = (raw: unknown, tree: unknown): LoadedAlertConditions => ({
  tree,
  legacy: { raw, converted: JSON.stringify(tree) },
});

/** A saved `query_condition.conditions` as the form's V2 tree; a V2 tree is kept as stored. */
export function loadAlertConditions(saved: any): LoadedAlertConditions {
  if (saved?.version === 2 || saved?.version === "2") {
    return { tree: saved.conditions, legacy: null };
  }
  if (Array.isArray(saved)) {
    if (!saved.length) return { tree: emptyTree(), legacy: null };
    return legacyOf(cloneDeep(saved), ensureIds(convertV0ToV2(cloneDeep(saved))));
  }
  if (!saved || typeof saved !== "object" || Object.keys(saved).length === 0) {
    return { tree: emptyTree(), legacy: null };
  }
  const version = detectConditionsVersion(saved);
  if (version === 2) return { tree: saved, legacy: null };
  if (version === 0) return legacyOf(cloneDeep(saved), ensureIds(convertV0ToV2(cloneDeep(saved))));
  if (saved.and || saved.or) {
    return legacyOf(cloneDeep(saved), ensureIds(convertV1BEToV2(cloneDeep(saved))));
  }
  if (saved.label && saved.items) {
    return legacyOf(cloneDeep(saved), ensureIds(convertV1ToV2(cloneDeep(saved))));
  }
  return { tree: saved, legacy: null };
}

/** What Save sends: the stored V0/V1 shape while it is unedited, otherwise the V2 envelope. */
export function alertConditionsPayload(
  current: unknown,
  legacy: LegacyAlertConditions | null,
): unknown {
  if (legacy && JSON.stringify(current) === legacy.converted) return legacy.raw;
  return { version: 2, conditions: current };
}
