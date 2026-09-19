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

import type { BrowserStep } from "@/types/synthetics";
import { isCompositionAction } from "@/constants/synthetics";

export const COMPOSED_ID_DELIMITER = "_";
export const COMPOSED_NAME_SEPARATOR = " › ";
/** Actions whose editor value never reaches a scanned wire field (assert is unstored; upload maps to `files`). */
const UNSCANNED_VALUE_ACTIONS = new Set(["assert", "upload"]);
const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;

export interface ExpansionEntry {
  authoredStepId: string;
  childIndex: number;
  childStepName: string;
  childCount: number;
}

export type ExpansionMap = Map<string, ExpansionEntry>;

export interface ChildJourney {
  id: string;
  name: string;
  /** Needed to route to the child's editor; absent on a child built without the GET response. */
  folderId?: string;
  steps: BrowserStep[];
}

export function composedStepId(refStepId: string, childStepId: string): string {
  return `${refStepId}${COMPOSED_ID_DELIMITER}${childStepId}`;
}

export function composedStepName(
  refName: string | undefined,
  childTestName: string,
  childStepName: string | undefined,
): string {
  const prefix = refName?.trim() ? refName : childTestName;
  const step = childStepName?.trim() ? childStepName : "step";
  return `${prefix}${COMPOSED_NAME_SEPARATOR}${step}`;
}

/**
 * Mirrors the server expander (§7.3): same ids, same names, so Replay previews the real run.
 */
export function expandJourney(
  steps: BrowserStep[],
  children: Map<string, ChildJourney>,
): { steps: BrowserStep[]; map: ExpansionMap } {
  const out: BrowserStep[] = [];
  const map: ExpansionMap = new Map();
  // Mirrors the server's `IdCollision`: an authored id like `s2_c1` can collide with a composed one.
  const seen = new Set<string>();
  const claim = (id: string) => {
    if (seen.has(id)) {
      throw new Error(`expansion produced duplicate step id "${id}"; rename the colliding step`);
    }
    seen.add(id);
  };
  for (const step of steps) {
    if (!isCompositionAction(step.action)) {
      claim(step.id);
      out.push(step);
      continue;
    }
    const childId = step.subtest?.id ?? "";
    const child = children.get(childId);
    if (!child) throw new Error(`referenced check "${childId}" is not loaded`);
    child.steps.forEach((childStep, childIndex) => {
      if (isCompositionAction(childStep.action)) {
        throw new Error(
          `"${child.name}" contains a subtest of its own; nesting is limited to one level`,
        );
      }
      const id = composedStepId(step.id, childStep.id);
      claim(id);
      const name = composedStepName(step.name, child.name, childStep.name);
      out.push({
        ...childStep,
        id,
        name,
        ...(childStep.wire ? { wire: { ...childStep.wire, id, name } } : {}),
      });
      map.set(id, {
        authoredStepId: step.id,
        childIndex,
        childStepName: childStep.name ?? "",
        childCount: child.steps.length,
      });
    });
  }
  return { steps: out, map };
}

/** The skip rule, read off the EXPANDED list's head as the probe does; an unloaded child claims no navigate. */
export function opensStartingUrl(
  steps: BrowserStep[],
  children: Map<string, ChildJourney>,
): boolean {
  const first = steps[0];
  if (!first) return true;
  const executed = isCompositionAction(first.action)
    ? children.get(first.subtest?.id ?? "")?.steps[0]
    : first;
  return executed?.action !== "navigate";
}

/** Mirrors the server's placeholder scan over `PLACEHOLDER_FIELDS`: names in text order, deduped. */
export function placeholdersIn(steps: BrowserStep[]): string[] {
  const found = new Set<string>();
  for (const step of steps) {
    if (UNSCANNED_VALUE_ACTIONS.has(step.action) || !step.value) continue;
    for (const match of step.value.matchAll(PLACEHOLDER_RE)) found.add(match[1]);
  }
  return [...found];
}

export function undefinedPlaceholders(child: ChildJourney, defined: Iterable<string>): string[] {
  const known = new Set(defined);
  return placeholdersIn(child.steps)
    .filter((name) => !known.has(name))
    .sort();
}

export function translateStepId(map: ExpansionMap, stepId: string): string {
  return map.get(stepId)?.authoredStepId ?? stepId;
}

export async function loadChildren(
  steps: BrowserStep[],
  fetchCheck: (id: string) => Promise<ChildJourney>,
): Promise<Map<string, ChildJourney>> {
  const ids = [
    ...new Set(steps.filter((s) => isCompositionAction(s.action)).map((s) => s.subtest?.id ?? "")),
  ].filter(Boolean);
  const loaded = await Promise.all(ids.map(async (id) => [id, await fetchCheck(id)] as const));
  return new Map(loaded);
}
