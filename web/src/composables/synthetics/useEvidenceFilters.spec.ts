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

import { describe, it, expect } from "vitest";
import { computed, ref } from "vue";
import { useEvidenceFilters } from "./useEvidenceFilters";
import type { EvidenceEvent } from "./syntheticResultsSchema";

const ev = (over: Partial<EvidenceEvent>): EvidenceEvent => ({
  ts: 0,
  stepId: "s1",
  kind: "response",
  level: null,
  text: null,
  message: null,
  stack: null,
  method: null,
  url: null,
  status: null,
  resourceType: null,
  initiatedTs: null,
  durationMs: null,
  firstParty: true,
  stepName: "Sign in",
  ...over,
});

const EVENTS = [
  ev({ ts: 300, kind: "response", status: 200 }),
  ev({ ts: 100, kind: "console", level: "error", text: "boom" }),
  ev({ ts: 200, kind: "requestfailed", firstParty: false }),
];

describe("useEvidenceFilters", () => {
  it("returns every event in time order by default", () => {
    const f = useEvidenceFilters(computed(() => EVENTS));
    expect(f.visibleEvents.value.map((e) => e.ts)).toEqual([100, 200, 300]);
  });

  it("narrows to what the page asked for, and to what it said", () => {
    const f = useEvidenceFilters(computed(() => EVENTS));
    f.view.value = "network";
    expect(f.visibleEvents.value.map((e) => e.kind)).toEqual(["requestfailed", "response"]);
    f.view.value = "console";
    expect(f.visibleEvents.value.map((e) => e.kind)).toEqual(["console"]);
  });

  it("drops third-party events only when asked", () => {
    const f = useEvidenceFilters(computed(() => EVENTS));
    expect(f.visibleEvents.value).toHaveLength(3);
    f.firstPartyOnly.value = true;
    expect(f.visibleEvents.value).toHaveLength(2);
  });

  it("counts the attempt, not the current view, so no number moves under the reader", () => {
    const f = useEvidenceFilters(computed(() => EVENTS));
    const before = f.views.value.map((v) => v.count);
    f.firstPartyOnly.value = true;
    expect(f.views.value.map((v) => v.count)).toEqual(before);
  });

  it("keeps an option visible at zero, because 'nothing on the console' is information", () => {
    const f = useEvidenceFilters(computed(() => [ev({ kind: "response", status: 200 })]));
    expect(f.views.value.map((v) => v.key)).toEqual(["all", "network", "console"]);
    expect(f.views.value.find((v) => v.key === "console")?.count).toBe(0);
  });

  it("tracks a changing event list", () => {
    const src = ref<EvidenceEvent[]>([]);
    const f = useEvidenceFilters(src);
    expect(f.visibleEvents.value).toHaveLength(0);
    src.value = EVENTS;
    expect(f.visibleEvents.value).toHaveLength(3);
  });

  it("tie-breaks simultaneous events worse-kind-first, not by arrival order", () => {
    const at = (kind: EvidenceEvent["kind"], over: Partial<EvidenceEvent> = {}) =>
      ev({ ts: 500, initiatedTs: 500, kind, ...over });
    const f = useEvidenceFilters(
      computed(() => [
        at("response", { status: 200 }),
        at("console", { level: "error", text: "x" }),
        at("pageerror", { message: "boom" }),
      ]),
    );
    expect(f.visibleEvents.value.map((e) => e.kind)).toEqual(["pageerror", "console", "response"]);
  });
});
