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

import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
vi.mock("./http", () => ({ default: () => ({ get, post }) }));

import fixture from "@/components/autoobserve/live/__fixtures__/autoobserveDecisions.json";
import autoobserveDecisions, {
  isRouteDisabled,
  refusalOf,
  type BatchResult,
  type BatchItemResult,
  type DecisionRequest,
  type DecisionResult,
  type DecisionList,
  type DecisionView,
  type Failure,
  type Preview,
  type Refusal,
  type SubjectInfo,
  type UndoRequest,
} from "./autoobserveDecisions";

/** Listing every key of a type as `true` fails type-check when the type and this list drift apart. */
const keysOf = <T>(keys: Record<keyof T, true>) => Object.keys(keys).sort();

const SUBJECT = keysOf<SubjectInfo>({ title: true, folder: true, team: true });
const REFUSAL = keysOf<Refusal>({
  code: true,
  reason: true,
  verb: true,
  message: true,
  folder: true,
  owners: true,
  owners_scope: true,
  can_act: true,
  more: true,
});
const PREVIEW = keysOf<Preview>({
  may: true,
  verb: true,
  decision_id: true,
  family: true,
  id: true,
  action: true,
  effect: true,
  subject: true,
  revision: true,
  current: true,
  locked: true,
});
const EFFECT = keysOf<Preview["effect"]>({
  scope: true,
  until: true,
  comes_back_when: true,
  mark: true,
});
const VIEW = keysOf<DecisionView>({
  decision_id: true,
  family: true,
  id: true,
  action: true,
  state: true,
  reason: true,
  note: true,
  has_note: true,
  actor: true,
  source: true,
  decided_at: true,
  until: true,
  revision: true,
  subject: true,
});
const RESULT = keysOf<DecisionResult>({ change: true, decision: true });
const ITEM = keysOf<BatchItemResult>({
  index: true,
  family: true,
  id: true,
  status: true,
  result: true,
  error: true,
});
const BATCH = keysOf<BatchResult>({ results: true, written: true, unchanged: true, failed: true });
const LIST = keysOf<DecisionList>({ decisions: true, total: true, limit: true, offset: true });
const FAILURE = keysOf<Failure>({ code: true, error: true, message: true });
const REQUEST = keysOf<DecisionRequest>({
  family: true,
  id: true,
  action: true,
  reason: true,
  note: true,
  until: true,
  duration_days: true,
  until_reopened: true,
  expected_revision: true,
  request_id: true,
});
const UNDO = keysOf<UndoRequest>({ expected_revision: true, request_id: true });

/** Optional keys the server leaves out when empty, so a fixture row may carry fewer. */
const within = (row: object, keys: string[]) =>
  expect(Object.keys(row).filter((k) => !keys.includes(k))).toEqual([]);

describe("autoobserveDecisions fixture pin", () => {
  it("every_fixture_key_is_a_typed_field", () => {
    expect(Object.keys(fixture).sort()).toEqual(
      [
        "batch",
        "conflict",
        "decide_batch",
        "decide_one",
        "decided",
        "list",
        "preview",
        "preview_locked",
        "refused",
        "undo",
        "undone",
      ].sort(),
    );
    within(fixture.decide_one, REQUEST);
    for (const item of fixture.decide_batch.items) within(item, REQUEST);
    within(fixture.undo, UNDO);
    for (const preview of [fixture.preview, fixture.preview_locked]) {
      within(preview, PREVIEW);
      within(preview.effect, EFFECT);
      within(preview.subject, SUBJECT);
    }
    expect(Object.keys(fixture.preview_locked.locked).sort()).toEqual(REFUSAL);
    expect(Object.keys(fixture.refused).sort()).toEqual(REFUSAL);
    for (const result of [fixture.decided, fixture.undone]) {
      expect(Object.keys(result).sort()).toEqual(RESULT);
      within(result.decision, VIEW);
    }
    expect(Object.keys(fixture.batch).sort()).toEqual(BATCH);
    for (const item of fixture.batch.results) {
      within(item, ITEM);
      if ("result" in item && item.result) within(item.result.decision, VIEW);
      if ("error" in item && item.error) expect(Object.keys(item.error).sort()).toEqual(FAILURE);
    }
    expect(Object.keys(fixture.list).sort()).toEqual(LIST);
    for (const row of fixture.list.decisions) {
      expect(Object.keys(row).sort()).toEqual(VIEW);
      expect(Object.keys(row.subject).sort()).toEqual(SUBJECT);
    }
    expect(Object.keys(fixture.conflict).sort()).toEqual(FAILURE);
  });
});

describe("autoobserveDecisions service", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("preview_reads_the_route_with_the_dialog_terms", async () => {
    get.mockResolvedValue({ data: fixture.preview });
    const res = await autoobserveDecisions.preview("demo org", {
      family: "suggestion",
      id: "s-cluster-d",
      action: "dismiss",
      reason: "planned_work",
      until: 1730916000000000,
    });
    expect(get).toHaveBeenCalledWith(
      "/api/v2/demo%20org/autoobserve/decisions/preview",
      expect.objectContaining({
        params: {
          family: "suggestion",
          id: "s-cluster-d",
          action: "dismiss",
          reason: "planned_work",
          until: 1730916000000000,
        },
        silentForbidden: true,
      }),
    );
    expect(res.data).toEqual(fixture.preview);
  });

  it("decide_posts_one_body_and_a_batch_as_items", async () => {
    post.mockResolvedValue({ data: fixture.decided });
    await autoobserveDecisions.decide("demo-org", fixture.decide_one as DecisionRequest);
    expect(post).toHaveBeenLastCalledWith(
      "/api/v2/demo-org/autoobserve/decisions",
      fixture.decide_one,
      { silentForbidden: true },
    );
    post.mockResolvedValue({ data: fixture.batch });
    await autoobserveDecisions.decideBatch(
      "demo-org",
      fixture.decide_batch.items as DecisionRequest[],
    );
    expect(post).toHaveBeenLastCalledWith(
      "/api/v2/demo-org/autoobserve/decisions",
      fixture.decide_batch,
      { silentForbidden: true },
    );
  });

  it("undo_posts_the_revision_to_the_decision", async () => {
    post.mockResolvedValue({ data: fixture.undone });
    await autoobserveDecisions.undo("demo-org", "suggestion:s-cluster-d", fixture.undo);
    expect(post).toHaveBeenCalledWith(
      "/api/v2/demo-org/autoobserve/decisions/suggestion%3As-cluster-d/undo",
      fixture.undo,
      { silentForbidden: true },
    );
  });

  it("list_pages_by_limit_and_offset", async () => {
    get.mockResolvedValue({ data: fixture.list });
    await autoobserveDecisions.list("demo-org", {
      state: "active",
      family: "suggestion",
      limit: 20,
      offset: 40,
    });
    expect(get).toHaveBeenCalledWith(
      "/api/v2/demo-org/autoobserve/decisions",
      expect.objectContaining({
        params: { state: "active", family: "suggestion", limit: 20, offset: 40 },
      }),
    );
  });

  it("a_404_reads_as_the_switch_off_and_a_403_body_as_a_refusal", () => {
    const err = (status: number, data: unknown) =>
      Object.assign(new Error("x"), { response: { status, data } });
    expect(isRouteDisabled(err(404, { code: 404, message: "disabled" }))).toBe(true);
    expect(isRouteDisabled(err(500, {}))).toBe(false);
    expect(refusalOf(err(403, fixture.refused))).toEqual(fixture.refused);
    expect(refusalOf(err(403, { code: 403, message: "Unauthorized Access" }))).toBeNull();
    expect(refusalOf(err(409, fixture.conflict))).toBeNull();
  });
});
