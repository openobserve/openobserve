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

import { beforeEach, describe, expect, it } from "vitest";
import { readEditorDraft, writeEditorDraft } from "@/utils/drafts/editorDraftStore";
import {
  alertDraftBase,
  anomalyDraftConfig,
  dropDraftOfMissingAlert,
  findDeletedAlertIds,
  isNotFoundError,
} from "./alertEditorDraft";

describe("alertEditorDraft", () => {
  beforeEach(() => localStorage.clear());

  it("leaves evaluation timestamps out of the alert base", () => {
    const alert = { id: "a1", name: "checkout_5xx", last_triggered_at: 1, last_satisfied_at: 2 };

    expect(alertDraftBase(alert)).toEqual({ id: "a1", name: "checkout_5xx" });
    expect(alert.last_triggered_at).toBe(1);
  });

  it("keeps the anomaly fields the user edits and drops what training writes", () => {
    const config = {
      name: "RED p95 · otel_demo",
      threshold: 97,
      alert_direction: "above",
      status: "ready",
      last_detection_run: 1793108092309482,
      current_model_version: 1793016652055965,
    };

    expect(anomalyDraftConfig(config)).toEqual({
      name: "RED p95 · otel_demo",
      threshold: 97,
      alert_direction: "above",
    });
  });

  it("recognises a 404 response only", () => {
    expect(isNotFoundError({ response: { status: 404 } })).toBe(true);
    expect(isNotFoundError({ response: { status: 500 } })).toBe(false);
    expect(isNotFoundError(new Error("network"))).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
  });

  it("drops this user's draft of a missing alert and reports whether there was one", () => {
    const scope = { org: "default", entityId: "a1", userEmail: "me@example.com" };
    const teammate = { ...scope, userEmail: "teammate@example.com" };
    writeEditorDraft({ ...scope, kind: "alert" }, { data: {} });
    writeEditorDraft({ ...teammate, kind: "alert" }, { data: {} });

    expect(dropDraftOfMissingAlert(scope)).toBe(true);
    expect(readEditorDraft({ ...scope, kind: "alert" })).toBeNull();
    expect(readEditorDraft({ ...teammate, kind: "alert" })).not.toBeNull();
    expect(dropDraftOfMissingAlert(scope)).toBe(false);
  });

  describe("findDeletedAlertIds", () => {
    const notFound = { response: { status: 404 } };

    it("returns only the ids answered with a 404, in the order asked", async () => {
      const answers: Record<string, () => Promise<unknown>> = {
        a1: () => Promise.reject(notFound),
        a2: () => Promise.resolve({ data: { id: "a2" } }),
        a3: () => Promise.reject({ response: { status: 500 } }),
        a4: () => Promise.reject(notFound),
      };

      const gone = await findDeletedAlertIds(["a1", "a2", "a3", "a4"], (id) => answers[id]());

      expect(gone).toEqual(["a1", "a4"]);
    });

    it("never has more lookups in flight than the concurrency allows", async () => {
      let inFlight = 0;
      let peak = 0;
      const ids = Array.from({ length: 25 }, (_, i) => `alert_${i}`);
      const getAlert = async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        throw notFound;
      };

      const gone = await findDeletedAlertIds(ids, getAlert, 3);

      expect(peak).toBe(3);
      expect(gone).toEqual(ids);
    });

    it("asks nothing for an empty list", async () => {
      let calls = 0;
      expect(
        await findDeletedAlertIds([], async () => {
          calls += 1;
        }),
      ).toEqual([]);
      expect(calls).toBe(0);
    });
  });
});
