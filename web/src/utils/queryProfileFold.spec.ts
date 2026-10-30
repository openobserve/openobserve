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

import { describe, expect, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  FOLD_H,
  ancestorIds,
  buildProfileModel,
  hotspotSet,
  isPlumbing,
  layoutProfile,
  physicalPlanToProfile,
  subtreeIds,
  type FoldState,
  type ProfileLayout,
  type ProfileModel,
  type ProfileNode,
  type QueryProfile,
  type RemoteNodeProfile,
} from "./queryProfile";
import {
  AUTO_FOLD_CARDS,
  applyFold,
  autoFold,
  canFocus,
  foldSummary,
  initialFold,
  nearestVisible,
  revealOp,
  type FoldAction,
} from "./queryProfileFold";
import { AGG_PHYSICAL_PLAN, T0, joinProfile } from "./__fixtures__/queryProfile.fixture";

const MS = 1_000_000;

function joinModel() {
  return buildProfileModel(joinProfile());
}

function planModel() {
  return buildProfileModel(physicalPlanToProfile(AGG_PHYSICAL_PLAN)!, [], { planOnly: true });
}

function idOf(model: ProfileModel, name: string, index = 0) {
  return model.order.filter((id) => model.operators[id].name === name)[index];
}

function timed(name: string, ms: number, children: ProfileNode[] = []): ProfileNode {
  return {
    name,
    detail: name,
    partitions: 1,
    metrics: [{ name: "elapsed_compute", kind: "time", value: ms * MS, max: ms * MS }],
    children,
  };
}

function remote(name: string, plan: ProfileNode, partition = 0): RemoteNodeProfile {
  return {
    partition,
    node_name: name,
    node_address: `10.0.0.${partition}:5081`,
    role: "querier",
    region: "",
    cluster: "",
    start_us: T0,
    first_batch_us: T0 + 1000,
    end_us: T0 + 100_000,
    output_rows: 10,
    output_batches: 1,
    output_bytes: 100,
    fetch_ns: MS,
    decode_ns: MS,
    assigned_files: 1,
    skipped: false,
    error: "",
    peak_memory: 0,
    plan,
  };
}

/** A union over `costs.length` streams, each a projection over a remote scan of filter + scan. */
function unionModel(costs: number[]): ProfileModel {
  const branch = (ms: number, i: number): ProfileNode => ({
    ...timed("ProjectionExec", 0.01),
    children: [
      {
        name: "RemoteScanExec",
        detail: "RemoteScanExec",
        partitions: 1,
        remote: [remote(`q-${i}`, timed("FilterExec", ms * 0.2, [timed("DataSourceExec", ms)]), i)],
      },
    ],
  });
  const profile: QueryProfile = {
    version: 1,
    node_name: "leader",
    node_address: "10.0.0.100:5081",
    start_us: T0,
    end_us: T0 + 500_000,
    output_rows: 10,
    plan: timed("SortPreservingMergeExec", 0.1, [
      timed("AggregateExec", 5, [timed("UnionExec", 0.5, costs.map(branch))]),
    ]),
  };
  return buildProfileModel(profile);
}

function visibleIds(layout: ProfileLayout) {
  return new Set(layout.cards.map((c) => c.opId));
}

/** Every operator is a card, folded onto an edge, or behind exactly one fold card. */
function expectEveryOpAccountedFor(model: ProfileModel, layout: ProfileLayout) {
  const seen = new Map<string, number>();
  const count = (id: string) => seen.set(id, (seen.get(id) ?? 0) + 1);
  layout.cards.forEach((c) => count(c.opId));
  layout.edges.forEach((e) => e.folded.forEach(count));
  for (const f of layout.folds) {
    const roots = f.kind === "branch" ? model.operators[f.ownerId].childIds : f.opIds;
    roots.flatMap((id) => subtreeIds(model, id)).forEach(count);
  }
  for (const id of model.order) expect(seen.get(id), `${id} ${model.operators[id].name}`).toBe(1);
}

function expectNoOverlap(layout: ProfileLayout) {
  const boxes = [
    ...layout.cards.map((c) => ({ id: c.opId, x: c.x, y: c.y, h: CARD_H })),
    ...layout.folds.map((f) => ({ id: f.key, x: f.x, y: f.y, h: FOLD_H })),
  ];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap =
        a.x < b.x + CARD_W && b.x < a.x + CARD_W && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}

function run(model: ProfileModel, ...actions: FoldAction[]): FoldState {
  return actions.reduce((f, a) => applyFold(model, f, a), initialFold());
}

describe("plumbing operators fold onto edges", () => {
  it("draws every operator when nothing is folded", () => {
    const model = joinModel();
    const layout = layoutProfile(model);
    expect(layout.cards).toHaveLength(model.order.length);
    expect(layout.edges.every((e) => e.folded.length === 0)).toBe(true);
  });

  it("puts cheap single-child exchanges and projections on the edge above their child", () => {
    const model = joinModel();
    const layout = layoutProfile(model, initialFold());
    const repartition = idOf(model, "RepartitionExec");
    expect(visibleIds(layout).has(repartition)).toBe(false);
    const edge = layout.edges.find((e) => e.folded.includes(repartition))!;
    expect(edge.childId).toBe(repartition);
    expect(edge.fromId).toBe(model.operators[repartition].childIds[0]);
    expect(edge.parentId).toBe(model.operators[repartition].parentId);
    expectEveryOpAccountedFor(model, layout);
    expectNoOverlap(layout);
  });

  it("folds a chain of plumbing operators onto one edge, top first", () => {
    const model = planModel();
    const layout = layoutProfile(model, initialFold());
    const [top, below] = model.order.filter((id) => model.operators[id].name === "RepartitionExec");
    expect(layout.edges.find((e) => e.folded.length === 2)?.folded).toEqual([top, below]);
  });

  it("keeps the root, hotspots and costly operators as cards", () => {
    const model = unionModel([5, 5]);
    const hot = hotspotSet(model);
    const costly = {
      ...model.operators[idOf(model, "ProjectionExec")],
      totalComputeNs: model.totalComputeNs,
    };
    expect(isPlumbing(model, costly, hot)).toBe(false);
    const root = buildProfileModel({
      ...joinProfile(),
      plan: timed("ProjectionExec", 0.01, [timed("DataSourceExec", 1)]),
    });
    expect(visibleIds(layoutProfile(root, initialFold())).has(root.rootId)).toBe(true);
  });

  it("opens a folded operator as a card and folds it back", () => {
    const model = joinModel();
    const repartition = idOf(model, "RepartitionExec");
    const shown = run(model, { type: "show", opIds: [repartition] });
    const open = layoutProfile(model, shown);
    expect(open.cards.find((c) => c.opId === repartition)?.refold).toBe(true);
    const back = layoutProfile(
      model,
      applyFold(model, shown, { type: "refold", opId: repartition }),
    );
    expect(visibleIds(back).has(repartition)).toBe(false);
  });

  it("refolds everything opened by hand when the switch goes back on", () => {
    const model = joinModel();
    const plumbing = model.order.filter((id) =>
      isPlumbing(model, model.operators[id], hotspotSet(model)),
    );
    const fold = run(
      model,
      { type: "show", opIds: plumbing },
      { type: "plumbing" },
      { type: "plumbing" },
    );
    const visible = visibleIds(layoutProfile(model, fold));
    expect(plumbing.some((id) => visible.has(id))).toBe(false);
  });
});

describe("collapsing branches and stages", () => {
  it("hides a branch behind one card under its still-visible owner", () => {
    const model = joinModel();
    const join = idOf(model, "HashJoinExec");
    const layout = layoutProfile(model, run(model, { type: "branch", opId: join }));
    expect(layout.cards.find((c) => c.opId === join)?.branch).toBe("collapsed");
    const fold = layout.folds.find((f) => f.kind === "branch")!;
    expect(fold.ownerId).toBe(join);
    expect(foldSummary(model, fold).count).toBe(subtreeIds(model, join).length - 1);
    expect(subtreeIds(model, join).filter((id) => visibleIds(layout).has(id))).toEqual([join]);
    expect(layout.stages).toHaveLength(0);
    expectEveryOpAccountedFor(model, layout);
  });

  it("draws a collapsed stage as one summary card", () => {
    const model = joinModel();
    const stage = model.stages[1];
    const layout = layoutProfile(model, run(model, { type: "stage", stageId: stage.id }));
    expect(layout.stages.map((s) => s.stageId)).not.toContain(stage.id);
    const fold = layout.folds.find((f) => f.kind === "stage")!;
    expect(fold.ownerId).toBe(stage.remoteOpId);
    expectEveryOpAccountedFor(model, layout);
    expectNoOverlap(layout);
  });

  it("opens each kind of fold card again", () => {
    const model = joinModel();
    const join = idOf(model, "HashJoinExec");
    for (const action of [
      { type: "branch", opId: join },
      { type: "stage", stageId: model.stages[0].id },
    ] as FoldAction[]) {
      const folded = run(model, action);
      const fold = layoutProfile(model, folded).folds[0];
      const reopened = layoutProfile(model, applyFold(model, folded, { type: "open", fold }));
      expect(reopened.folds).toHaveLength(0);
    }
  });
});

describe("hot path", () => {
  it("leaves only the paths to the hotspots open, stage variants included", () => {
    const model = joinModel();
    const layout = layoutProfile(model, run(model, { type: "hotPath" }));
    const keep = new Set([...hotspotSet(model)].flatMap((id) => [id, ...ancestorIds(model, id)]));
    expect([...visibleIds(layout)].filter((id) => !keep.has(id))).toEqual([]);
    expectEveryOpAccountedFor(model, layout);
    expectNoOverlap(layout);
  });

  it("merges the branches off the hot path into one card", () => {
    const model = unionModel([400, 260, ...Array(12).fill(2)]);
    const layout = layoutProfile(model, run(model, { type: "hotPath" }));
    expect(layout.folds).toHaveLength(1);
    expect(layout.folds[0].opIds).toHaveLength(12);
    expectEveryOpAccountedFor(model, layout);
  });

  it("refolds operators opened by hand", () => {
    const model = joinModel();
    const repartition = idOf(model, "RepartitionExec");
    const fold = run(model, { type: "show", opIds: [repartition] }, { type: "hotPath" });
    expect(fold.shown.size).toBe(0);
  });

  it("does nothing on a plain plan, which has no hotspots", () => {
    const model = planModel();
    const fold = initialFold();
    expect(applyFold(model, fold, { type: "hotPath" })).toBe(fold);
  });
});

describe("automatic folding of large plans", () => {
  it("collapses small sibling branches into one card and keeps hotspot paths open", () => {
    const model = unionModel([400, 260, ...Array(12).fill(2)]);
    expect(layoutProfile(model, initialFold()).cards.length).toBeGreaterThan(AUTO_FOLD_CARDS);
    const { fold, count } = autoFold(model, initialFold());
    expect(count).toBe(12);
    const layout = layoutProfile(model, fold);
    expect(layout.folds).toHaveLength(1);
    expect(layout.folds[0]).toMatchObject({ kind: "group", focus: false });
    expect(layout.folds[0].opIds).toHaveLength(12);
    for (const id of hotspotSet(model)) expect(visibleIds(layout).has(id)).toBe(true);
    expectEveryOpAccountedFor(model, layout);
    expectNoOverlap(layout);
  });

  it("leaves small plans and plain plans alone", () => {
    expect(autoFold(joinModel(), initialFold()).count).toBe(0);
    expect(autoFold(planModel(), initialFold()).count).toBe(0);
  });

  it("opens the merged card back into every branch", () => {
    const model = unionModel([400, 260, ...Array(12).fill(2)]);
    const { fold } = autoFold(model, initialFold());
    const merged = layoutProfile(model, fold).folds[0];
    const open = layoutProfile(model, applyFold(model, fold, { type: "open", fold: merged }));
    expect(open.folds).toHaveLength(0);
  });
});

describe("focus", () => {
  it("collapses every branch that does not lead to or from the focused operator", () => {
    const model = joinModel();
    const scan = idOf(model, "DataSourceExec", 1);
    const layout = layoutProfile(model, run(model, { type: "focus", opId: scan }));
    const related = new Set([...subtreeIds(model, scan), ...ancestorIds(model, scan)]);
    expect([...visibleIds(layout)].filter((id) => !related.has(id))).toEqual([]);
    expect(layout.folds.every((f) => f.focus)).toBe(true);
    expectEveryOpAccountedFor(model, layout);
  });

  it("clears focus when a focus card is opened or focus is cleared", () => {
    const model = joinModel();
    const fold = run(model, { type: "focus", opId: idOf(model, "DataSourceExec", 1) });
    const card = layoutProfile(model, fold).folds[0];
    expect(applyFold(model, fold, { type: "open", fold: card }).focusId).toBeNull();
    expect(applyFold(model, fold, { type: "focus", opId: null }).focusId).toBeNull();
  });

  it("is only offered where some operator above has another branch", () => {
    const model = joinModel();
    expect(canFocus(model, model.rootId)).toBe(false);
    expect(canFocus(model, idOf(model, "DataSourceExec"))).toBe(true);
  });
});

describe("revealing a selected operator", () => {
  it("opens the folds hiding it without pinning plumbing above it open", () => {
    const model = joinModel();
    const scan = idOf(model, "DataSourceExec");
    const hidden = run(model, { type: "hotPath" }, { type: "branch", opId: model.rootId });
    const revealed = revealOp(model, hidden, scan);
    const layout = layoutProfile(model, revealed);
    expect(visibleIds(layout).has(scan)).toBe(true);
    expect(revealed.shown.size).toBe(0);
  });

  it("returns the same state when the operator is already visible", () => {
    const model = joinModel();
    const fold = initialFold();
    expect(revealOp(model, fold, model.rootId)).toBe(fold);
  });

  it("drops focus when the operator lies outside it", () => {
    const model = joinModel();
    const fold = run(model, { type: "focus", opId: idOf(model, "DataSourceExec", 1) });
    expect(revealOp(model, fold, idOf(model, "DataSourceExec", 0)).focusId).toBeNull();
  });

  it("finds the closest visible operator above a hidden one", () => {
    const model = joinModel();
    const join = idOf(model, "HashJoinExec");
    const layout = layoutProfile(model, run(model, { type: "branch", opId: join }));
    expect(nearestVisible(model, layout, idOf(model, "DataSourceExec"))).toBe(join);
  });
});
