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

import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

import { buildInstallPayload, InstallPayloadError } from "./libraryInstall";

const entry = (over: Partial<AlertLibraryEntry> = {}): AlertLibraryEntry => ({
  id: "k8s/pod-oom-killed",
  name: "pod-oom-killed",
  pack: "k8s",
  category: "pod",
  title: "Pod OOM Killed",
  severity: "critical",
  description: "A container was terminated by the OOM killer.",
  stream: "kube_pod_metrics",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["kube_pod_metrics"],
  path: "packs/k8s/alerts/pod/pod-oom-killed.json",
  content_hash: "1c09e8f6ac33",
  ...over,
});

/** As exported: carries an id, an author's destinations, and no org context. */
const file = (over: Partial<AlertLibraryFile> = {}): AlertLibraryFile => ({
  id: "3Dnovc9lnVMx1H6gvcRZbN01FYu",
  name: "pod-oom-killed",
  stream_type: "metrics",
  stream_name: "kube_pod_metrics",
  destinations: ["k8s_alert"],
  enabled: true,
  query_condition: {
    type: "promql",
    promql: "kube_pod_container_status_last_terminated_reason",
    promql_condition: { column: "value", operator: ">", value: 0 },
  },
  trigger_condition: { period: 5, operator: ">=", threshold: 1, frequency: 5, silence: 30 },
  ...over,
});

const build = (over: Record<string, unknown> = {}) =>
  buildInstallPayload({
    entry: entry(),
    file: file(),
    folderId: "folder-7",
    destination: "ops-slack",
    owner: "someone@example.com",
    timezone: "Asia/Kolkata",
    ...over,
  });

describe("buildInstallPayload", () => {
  describe("library-specific steps", () => {
    it("overwrites the library's destinations — the author's never exist in this org", () => {
      // "k8s_alert" is hardcoded in every k8s pack file and would be rejected.
      expect(build().destinations).toEqual(["ops-slack"]);
    });

    it("overwrites even when the file names several destinations", () => {
      const payload = build({ file: file({ destinations: ["k8s_alert", "o2_to_slack"] }) });
      expect(payload.destinations).toEqual(["ops-slack"]);
    });

    it("gives a destination to a file that carries none", () => {
      const bare = file();
      delete bare.destinations;
      expect(build({ file: bare }).destinations).toEqual(["ops-slack"]);
    });

    it("stamps the library id and content hash without dropping the file's own attributes", () => {
      const payload = build({
        file: file({ context_attributes: { team: "platform" } }),
      });
      expect(payload.context_attributes).toEqual({
        team: "platform",
        library_id: "k8s/pod-oom-killed",
        library_hash: "1c09e8f6ac33",
      });
    });

    it("creates context_attributes when the file has none", () => {
      expect(build().context_attributes).toEqual({
        library_id: "k8s/pod-oom-killed",
        library_hash: "1c09e8f6ac33",
      });
    });

    it("tags the pack, keeping tags the file already carried", () => {
      // Membership, not order: a Set-backed implementation is equally correct
      // and there is no behavioural reason to reject it.
      const tags = build({ file: file({ tags: ["prod"] }) }).tags as string[];
      expect(tags).toHaveLength(2);
      expect(tags).toEqual(expect.arrayContaining(["prod", "pack:k8s"]));
    });

    it("does not tag the same pack twice", () => {
      const tags = build({ file: file({ tags: ["pack:k8s"] }) }).tags as string[];
      expect(tags).toEqual(["pack:k8s"]);
    });

    it("maps severity to the integer priority the wire expects, never the label", () => {
      expect(build().priority).toBe(1);
      expect(build({ entry: entry({ severity: "warning" }) }).priority).toBe(3);
      expect(build({ entry: entry({ severity: "info" }) }).priority).toBe(4);
    });

    it("outranks a priority the exported file carried", () => {
      // Library files are third-party exports and can name their own priority.
      // Severity is the wizard's contract, so it wins.
      const payload = build({
        entry: entry({ severity: "critical" }),
        file: file({ priority: 5 }),
      });
      expect(payload.priority).toBe(1);
    });

    it("sends no priority at all for a severity the mapping does not know", () => {
      // The drawer promises "No priority" here; carrying the export's own value
      // through would quietly break that promise.
      const payload = build({
        entry: entry({ severity: "catastrophic" as AlertLibraryEntry["severity"] }),
        file: file({ priority: 5 }),
      });
      expect("priority" in payload).toBe(false);
    });
  });

  describe("payload normalization — matches ImportAlert", () => {
    it("files the alert and records who installed it", () => {
      const payload = build();
      expect(payload.folder_id).toBe("folder-7");
      expect(payload.owner).toBe("someone@example.com");
      expect(payload.last_edited_by).toBe("someone@example.com");
    });

    it("drops the exported alert id so the create is not read as an update", () => {
      expect("id" in build()).toBe(false);
    });

    it("defaults the trigger timezone to the org's", () => {
      const trigger = build().trigger_condition as Record<string, unknown>;
      expect(trigger.timezone).toBe("Asia/Kolkata");
    });

    it("keeps a timezone the file already carries", () => {
      const payload = build({
        file: file({
          trigger_condition: { period: 5, frequency: 5, silence: 30, timezone: "UTC" },
        }),
      });
      expect((payload.trigger_condition as Record<string, unknown>).timezone).toBe("UTC");
    });

    it("defaults tolerance_in_secs to null rather than leaving it absent", () => {
      const trigger = build().trigger_condition as Record<string, unknown>;
      expect(trigger.tolerance_in_secs).toBeNull();
    });

    it("keeps a tolerance the file already carries, including zero", () => {
      const payload = build({
        file: file({
          trigger_condition: { period: 5, frequency: 5, silence: 30, tolerance_in_secs: 0 },
        }),
      });
      expect((payload.trigger_condition as Record<string, unknown>).tolerance_in_secs).toBe(0);
    });

    // The envelope is the cheap half. What matters is that the PREDICATE
    // survives: an implementation returning a well-formed but EMPTY group turns
    // "alert when code = 500" into an alert with no condition at all, and the
    // API accepts it. Every conversion test below pins the leaf.
    const conditionsOf = (payload: Record<string, unknown>) =>
      (payload.query_condition as Record<string, any>).conditions;

    /** The leaf shape `alertDataTransforms` really emits, minus the generated id. */
    const V2_LEAF = {
      filterType: "condition",
      column: "code",
      operator: "=",
      value: "500",
      logicalOperator: "AND",
    };

    it("wraps a flat v0 condition list in the v2 envelope, predicate intact", () => {
      const payload = build({
        file: file({
          query_condition: {
            type: "sql",
            sql: "select 1",
            conditions: [{ column: "code", operator: "=", value: "500" }],
          },
        }),
      });
      const conditions = conditionsOf(payload);
      expect(conditions.version).toBe(2);
      expect(conditions.conditions.filterType).toBe("group");
      expect(conditions.conditions.conditions).toHaveLength(1);
      expect(conditions.conditions.conditions[0]).toMatchObject(V2_LEAF);
    });

    it("leaves an already-wrapped v2 condition tree alone", () => {
      const wrapped = {
        version: 2,
        conditions: {
          filterType: "group",
          logicalOperator: "AND",
          groupId: "g-1",
          conditions: [{ ...V2_LEAF, id: "c-1" }],
        },
      };
      // Snapshot BEFORE the call: comparing `wrapped` with itself cannot fail,
      // because an implementation that keeps the reference and mutates it in
      // place would be checking the mutated tree against the mutated tree.
      const expected = structuredClone(wrapped);
      const payload = build({
        file: file({ query_condition: { type: "sql", sql: "select 1", conditions: wrapped } }),
      });

      expect(conditionsOf(payload)).toEqual(expected);
      // And it is a fresh tree — the caller's object is never handed back.
      expect(conditionsOf(payload)).not.toBe(wrapped);
      expect(wrapped).toEqual(expected);
    });

    it("converts a v1 frontend condition tree, predicate intact", () => {
      const payload = build({
        file: file({
          query_condition: {
            type: "sql",
            sql: "select 1",
            conditions: {
              groupId: "g-1",
              label: "and",
              items: [{ column: "code", operator: "=", value: "500" }],
            },
          },
        }),
      });
      const conditions = conditionsOf(payload);
      expect(conditions.version).toBe(2);
      expect(conditions.conditions.filterType).toBe("group");
      expect(conditions.conditions.conditions).toHaveLength(1);
      // Not the raw {column, operator, value} item passed straight through.
      expect(conditions.conditions.conditions[0]).toMatchObject(V2_LEAF);
    });

    it("converts a v1 backend condition tree, predicate intact", () => {
      const payload = build({
        file: file({
          query_condition: {
            type: "sql",
            sql: "select 1",
            conditions: { and: [{ column: "code", operator: "=", value: "500" }] },
          },
        }),
      });
      const conditions = conditionsOf(payload);
      expect(conditions.version).toBe(2);
      expect(conditions.conditions.filterType).toBe("group");
      expect(conditions.conditions.conditions).toHaveLength(1);
      expect(conditions.conditions.conditions[0]).toMatchObject(V2_LEAF);
    });

    it('unwraps a v2 envelope whose version arrived as the string "2"', () => {
      // ImportAlert — the reference this block claims parity with — accepts both
      // 2 and "2". Handling only the number double-wraps the tree into
      // {version: 2, conditions: {version: "2", conditions: …}}.
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        groupId: "g-1",
        conditions: [{ ...V2_LEAF }],
      };
      const payload = build({
        file: file({
          query_condition: {
            type: "sql",
            sql: "select 1",
            conditions: { version: "2", conditions: group },
          },
        }),
      });
      const conditions = conditionsOf(payload);
      expect(conditions.version).toBe(2);
      expect(conditions.conditions).toEqual(group);
      expect(conditions.conditions.version).toBeUndefined();
    });

    it("distinguishes an empty condition list from an absent one", () => {
      // `[]` is a real, if empty, predicate list and ImportAlert wraps it (the
      // key is truthy), so it becomes an empty group. `null` is the absence of
      // one and must not grow an envelope. Neither is the L1 hazard — that was
      // DROPPING a populated list, which the tests above pin.
      const empty = build({
        file: file({ query_condition: { type: "sql", sql: "select 1", conditions: [] } }),
      });
      const emptyConditions = conditionsOf(empty);
      expect(emptyConditions.version).toBe(2);
      expect(emptyConditions.conditions.filterType).toBe("group");
      expect(emptyConditions.conditions.conditions).toEqual([]);

      const absent = build({
        file: file({ query_condition: { type: "sql", sql: "select 1", conditions: null } }),
      });
      expect(conditionsOf(absent)).toBeNull();
    });

    // An unreadable shape must FAIL, not fall back. `detectConditionsVersion`
    // answers 0 for anything it does not recognise and `convertV0ToV2` answers
    // an empty group for a non-array, so falling back installs an alert whose
    // filter matches every row — reported as a success.
    const buildWithConditions = (conditions: unknown) =>
      build({
        file: file({ query_condition: { type: "sql", sql: "select 1", conditions } }),
      });

    it.each([
      ["a legacy envelope the v2 unwrap does not recognise", { version: 1, conditions: {} }],
      ["an object of an unknown shape", { filters: [{ column: "code" }] }],
      ["a bare string", "code = 500"],
      ["a v1 backend branch that is not a list", { and: "not-an-array" }],
      ["a v1 frontend branch that is not a list", { label: "and", items: "not-an-array" }],
    ])("refuses %s rather than installing an alert with no predicate", (_label, conditions) => {
      expect(() => buildWithConditions(conditions)).toThrow(InstallPayloadError);
    });

    it("refuses with a code, not a raw TypeError from inside a converter", () => {
      // `{and: "x"}` detects as v1 and used to reach `.map` on a string, showing
      // the user "input.and.map is not a function" as the reason install failed.
      try {
        buildWithConditions({ and: "not-an-array" });
        throw new Error("expected a refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(InstallPayloadError);
        expect((error as InstallPayloadError).code).toBe("unreadable_conditions");
      }
    });

    it("adds no conditions key to an alert that has none — most of the library", () => {
      const queryCondition = build().query_condition as Record<string, unknown>;
      expect("conditions" in queryCondition).toBe(false);
    });

    it("carries the rest of the alert through untouched", () => {
      // A whitelist-shaped implementation would silently drop the query.
      const payload = build();
      expect(payload.name).toBe("pod-oom-killed");
      expect(payload.stream_name).toBe("kube_pod_metrics");
      expect(payload.enabled).toBe(true);
      expect((payload.query_condition as Record<string, any>).promql).toBe(
        "kube_pod_container_status_last_terminated_reason",
      );
    });
  });

  describe("bulk tuning", () => {
    it("applies the batch-shared pair to every alert", () => {
      const payload = build({ overrides: { frequency: 15, silence: 60 } });
      const trigger = payload.trigger_condition as Record<string, unknown>;
      expect(trigger.frequency).toBe(15);
      expect(trigger.silence).toBe(60);
    });

    it("changes nothing when the batch carries no overrides at all", () => {
      const trigger = build().trigger_condition as Record<string, unknown>;
      expect(trigger.frequency).toBe(5);
      expect(trigger.silence).toBe(30);
    });

    it("keeps a silence of zero rather than reading it as 'not set'", () => {
      // `overrides.silence || file.silence` would silently restore 30 here, and
      // 0 is the value that means "never suppress a repeat".
      const payload = build({ overrides: { silence: 0 } });
      expect((payload.trigger_condition as Record<string, unknown>).silence).toBe(0);
    });

    it("keeps the library defaults for anything the wizard did not override", () => {
      const payload = build({ overrides: { frequency: 15 } });
      const trigger = payload.trigger_condition as Record<string, unknown>;
      expect(trigger.frequency).toBe(15);
      expect(trigger.silence).toBe(30);
      // Per-alert thresholds are the drawer's business, never the wizard's.
      expect(trigger.threshold).toBe(1);
      expect(trigger.period).toBe(5);
    });
  });

  // The file is a document fetched from a public bucket, so every field in it is
  // untrusted input — the same stance useAlertLibrary, libraryTunables and
  // constants/alertLibrary already take. A spread of the wrong type is the
  // failure mode: `{...("prod")}` is {0:"p",1:"r",…} and `{...["a"]}` is {0:"a"}.
  describe("a malformed file degrades instead of corrupting the payload", () => {
    it("ignores tags and context_attributes that are not the shape they claim", () => {
      const payload = build({
        file: file({ tags: "prod", context_attributes: ["a"] }),
      });
      expect(payload.tags).toEqual(["pack:k8s"]);
      expect(payload.context_attributes).toEqual({
        library_id: "k8s/pod-oom-killed",
        library_hash: "1c09e8f6ac33",
      });
    });

    it("drops context_attributes values that are not strings, keeping the rest", () => {
      // Free-form KV shipped into notification payloads and typed
      // HashMap<String,String> on the wire, so a non-string 400s the whole
      // alert. Dropped rather than whitelisted — a row template may read these.
      const payload = build({
        file: file({
          context_attributes: { team: "platform", retries: 3, tags: ["a"], nested: { x: 1 } },
        }),
      });
      expect(payload.context_attributes).toEqual({
        team: "platform",
        library_id: "k8s/pod-oom-killed",
        library_hash: "1c09e8f6ac33",
      });
    });

    it("still produces a trigger_condition when the file has none", () => {
      const bare = file();
      delete bare.trigger_condition;
      const trigger = build({ file: bare }).trigger_condition as Record<string, unknown>;
      expect(trigger.timezone).toBe("Asia/Kolkata");
      expect(trigger.tolerance_in_secs).toBeNull();
    });

    it("replaces a trigger_condition of the wrong type rather than reading through it", () => {
      const payload = build({
        file: file({ trigger_condition: "every 5 minutes" }),
        overrides: { frequency: 15 },
      });
      const trigger = payload.trigger_condition as Record<string, unknown>;
      expect(trigger.timezone).toBe("Asia/Kolkata");
      expect(trigger.frequency).toBe(15);
    });
  });

  it("never mutates the file it was handed — the drawer keeps showing it", () => {
    // Carries a conditions tree on purpose: that is the ONE nested structure the
    // builder rewrites, so a fixture without it cannot catch in-place editing.
    const source = file({
      context_attributes: { team: "platform" },
      tags: ["prod"],
      query_condition: {
        type: "sql",
        sql: "select 1",
        conditions: [{ column: "code", operator: "=", value: "500" }],
      },
    });
    const snapshot = structuredClone(source);
    build({ file: source, overrides: { frequency: 15, silence: 60 } });
    expect(source).toEqual(snapshot);
  });

  it("does not mutate an already-v2 tree in place either", () => {
    const source = file({
      query_condition: {
        type: "sql",
        sql: "select 1",
        conditions: {
          version: 2,
          conditions: {
            filterType: "group",
            logicalOperator: "AND",
            groupId: "g-1",
            conditions: [
              {
                filterType: "condition",
                column: "code",
                operator: "=",
                value: "500",
                logicalOperator: "AND",
              },
            ],
          },
        },
      },
    });
    const snapshot = structuredClone(source);
    build({ file: source });
    expect(source).toEqual(snapshot);
  });
});
