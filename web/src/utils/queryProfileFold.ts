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

import {
  ancestorIds,
  hotspotSet,
  isPlumbing,
  layoutProfile,
  subtreeIds,
  type FoldState,
  type LayoutFold,
  type ProfileLayout,
  type ProfileModel,
  type ProfileOperator,
} from "./queryProfile";

export const AUTO_FOLD_CARDS = 40;
export const AUTO_FOLD_SHARE = 0.05;

export type FoldAction =
  | { type: "branch"; opId: string }
  | { type: "stage"; stageId: string }
  | { type: "open"; fold: Pick<LayoutFold, "kind" | "opIds" | "ownerId" | "focus"> }
  | { type: "show"; opIds: string[] }
  | { type: "refold"; opId: string }
  | { type: "plumbing" }
  | { type: "expandAll" }
  | { type: "hotPath" }
  | { type: "focus"; opId: string | null };

export interface FoldSummary {
  count: number;
  computeNs: number;
  hottest: ProfileOperator | null;
}

export function initialFold(): FoldState {
  return {
    plumbing: true,
    shown: new Set(),
    collapsed: new Set(),
    grouped: new Set(),
    stages: new Set(),
    focusId: null,
  };
}

/** Pure reducer for every fold control on the canvas. */
export function applyFold(model: ProfileModel, fold: FoldState, action: FoldAction): FoldState {
  switch (action.type) {
    case "branch":
      return { ...fold, collapsed: toggled(fold.collapsed, action.opId) };
    case "stage":
      return { ...fold, stages: withAll(fold.stages, [action.stageId]) };
    case "open":
      return openFold(model, fold, action.fold);
    case "show":
      return { ...fold, shown: withAll(fold.shown, action.opIds) };
    case "refold":
      return { ...fold, shown: without(fold.shown, [action.opId]) };
    case "plumbing":
      // turning folding back on is a request to fold everything, including what was opened by hand
      return fold.plumbing
        ? { ...fold, plumbing: false }
        : { ...fold, plumbing: true, shown: new Set() };
    case "expandAll":
      return { ...initialFold(), plumbing: fold.plumbing, shown: fold.shown };
    case "hotPath":
      return hotPathFold(model, fold);
    case "focus":
      return action.opId
        ? { ...revealOp(model, fold, action.opId), focusId: action.opId }
        : { ...fold, focusId: null };
  }
}

/** Collapses small sibling branches once a plan is too big to read; hotspot paths stay open. */
export function autoFold(model: ProfileModel, fold: FoldState): { fold: FoldState; count: number } {
  if (model.planOnly || model.totalComputeNs <= 0) return { fold, count: 0 };
  if (layoutProfile(model, fold).cards.length <= AUTO_FOLD_CARDS) return { fold, count: 0 };
  const keep = hotPath(model);
  const grouped = new Set(fold.grouped);
  for (const id of model.order) {
    const op = model.operators[id];
    if (op.childIds.length < 2) continue;
    for (const childId of op.childIds) {
      if (keep.has(childId) || subtreeShare(model, childId) >= AUTO_FOLD_SHARE) continue;
      grouped.add(childId);
    }
  }
  const count = grouped.size - fold.grouped.size;
  return { fold: count ? { ...fold, grouped } : fold, count };
}

/** Opens whatever hides `opId`; returns the same state when it is already visible. */
export function revealOp(model: ProfileModel, fold: FoldState, opId: string): FoldState {
  const op = model.operators[opId];
  if (!op) return fold;
  const path = [opId, ...ancestorIds(model, opId)];
  const stageIds = path.map((id) => model.operators[id].stageId).filter((s): s is string => !!s);
  const outsideFocus =
    !!fold.focusId &&
    !path.includes(fold.focusId) &&
    !ancestorIds(model, fold.focusId).includes(opId);
  const unfold = fold.plumbing && isPlumbing(model, op, hotspotSet(model)) && !fold.shown.has(opId);
  const changed =
    outsideFocus ||
    unfold ||
    path.some((id) => fold.collapsed.has(id) || fold.grouped.has(id)) ||
    stageIds.some((s) => fold.stages.has(s));
  if (!changed) return fold;
  return {
    ...fold,
    shown: unfold ? withAll(fold.shown, [opId]) : fold.shown,
    collapsed: without(fold.collapsed, path),
    grouped: without(fold.grouped, path),
    stages: without(fold.stages, stageIds),
    focusId: outsideFocus ? null : fold.focusId,
  };
}

/** Focus only changes the canvas when some operator above this one has another branch. */
export function canFocus(model: ProfileModel, opId: string): boolean {
  return ancestorIds(model, opId).some((id) => model.operators[id].childIds.length > 1);
}

export function foldSummary(
  model: ProfileModel,
  fold: Pick<LayoutFold, "kind" | "opIds">,
): FoldSummary {
  const ids = fold.opIds.flatMap((id) => subtreeIds(model, id));
  let hottest: ProfileOperator | null = null;
  let computeNs = 0;
  for (const id of ids) {
    const op = model.operators[id];
    computeNs += op.totalComputeNs;
    if (op.category !== "remote" && op.totalComputeNs > (hottest?.totalComputeNs ?? 0))
      hottest = op;
  }
  return { count: ids.length, computeNs, hottest };
}

/** The selected operator, or the closest visible operator above it once a fold hides it. */
export function nearestVisible(model: ProfileModel, layout: ProfileLayout, opId: string): string {
  const visible = new Set(layout.cards.map((c) => c.opId));
  return [opId, ...ancestorIds(model, opId)].find((id) => visible.has(id)) ?? model.rootId;
}

function hotPath(model: ProfileModel): Set<string> {
  return new Set([...hotspotSet(model)].flatMap((id) => [id, ...ancestorIds(model, id)]));
}

function hotPathFold(model: ProfileModel, fold: FoldState): FoldState {
  const keep = hotPath(model);
  if (!keep.size) return fold;
  const grouped = new Set<string>();
  for (const id of keep) {
    for (const childId of model.operators[id].childIds)
      if (!keep.has(childId)) grouped.add(childId);
  }
  return { ...initialFold(), plumbing: fold.plumbing, grouped };
}

function openFold(
  model: ProfileModel,
  fold: FoldState,
  target: Pick<LayoutFold, "kind" | "opIds" | "ownerId" | "focus">,
): FoldState {
  if (target.kind === "branch")
    return { ...fold, collapsed: without(fold.collapsed, [target.ownerId]) };
  if (target.kind === "stage") {
    const stageId = model.operators[target.ownerId]?.remoteStageId;
    return stageId ? { ...fold, stages: without(fold.stages, [stageId]) } : fold;
  }
  return {
    ...fold,
    grouped: without(fold.grouped, target.opIds),
    focusId: target.focus ? null : fold.focusId,
  };
}

function subtreeShare(model: ProfileModel, opId: string): number {
  const ns = subtreeIds(model, opId).reduce((a, id) => a + model.operators[id].totalComputeNs, 0);
  return ns / model.totalComputeNs;
}

function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  return set.has(id) ? without(set, [id]) : withAll(set, [id]);
}

function withAll(set: ReadonlySet<string>, ids: string[]): Set<string> {
  return new Set([...set, ...ids]);
}

function without(set: ReadonlySet<string>, ids: string[]): Set<string> {
  const next = new Set(set);
  ids.forEach((id) => next.delete(id));
  return next;
}
