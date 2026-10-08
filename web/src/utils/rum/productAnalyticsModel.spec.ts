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

import { describe, expect, it, vi } from "vitest";
import i18n from "@/locales";
import {
  MAX_PARAM_LENGTH,
  applyClickPages,
  toFeatureRows,
  granularityOptions,
  retentionPeriods,
  toRetentionGrid,
  branchPredicate,
  pathKeyLabel,
  buildPathFlow,
  sankeyLabel,
  sankeyTooltip,
  foldBreakdown,
  formatDuration,
  pushRecentFunnel,
  readRecentFunnels,
  toFunnelResult,
  chipCounts,
  clickNameHint,
  computeDelta,
  matchesChip,
  sortForChip,
  toRankedRows,
  decodeDef,
  encodeDef,
  formatCount,
  parseFunnelDef,
  parseNamedEvent,
  parseNamedEventDraft,
  parseSavedFunnel,
  parseSavedFunnelDraft,
  nameFits,
  isEntityId,
  MAX_SQL_BYTES,
  parsePathsDef,
  parseRetentionDef,
  parseScope,
  parseStepRef,
  regexProblem,
  identityExclusionNote,
  identityGapMessage,
  identityLabels,
  resolveIdentity,
  samplingRatio,
} from "@/utils/rum/productAnalyticsModel";
import { funnelSql, type AnalyticsScope } from "@/utils/rum/productAnalyticsQueries";

const top = (rows: [string, number][], total: number, n: number) =>
  rows.map(([u, s]) => ({ u, s, total_s: total, n_values: n }));

describe("resolveIdentity (AC-28, AC-29, AC-50)", () => {
  it("o2-prod: excludes the 86% value and keeps 180 users", () => {
    const res = resolveIdentity(
      { sessions: 6429, usr_email__values: 181, usr_email__sessions: 6129 },
      {
        usr_email: top(
          [
            ["bot", 5293],
            ["a", 45],
            ["b", 30],
          ],
          6129,
          181,
        ),
      },
      { usr_email: true },
      false,
    );
    expect(res.field).toBe("usr_email");
    expect(res.excluded).toEqual(["bot"]);
    expect(res.users).toBe(180);
    expect(Math.round(res.coverage * 1000) / 10).toBe(13.0);
    expect(res.excludedShare).toBeCloseTo(5293 / 6129, 5);
  });

  it("o2-website: a single constant value resolves to none", () => {
    const res = resolveIdentity(
      { sessions: 32733, usr_email__values: 1, usr_email__sessions: 26288 },
      { usr_email: top([["guest", 26288]], 26288, 1) },
      { usr_email: true },
      false,
    );
    expect(res.field).toBeNull();
    expect(res.unidentifiedSessions).toBe(32733);
  });

  it("a 99% guest placeholder plus 5 real users resolves with 5 users", () => {
    const res = resolveIdentity(
      { sessions: 1000, usr_email__values: 6, usr_email__sessions: 1000 },
      {
        usr_email: top(
          [
            ["guest", 990],
            ["u1", 3],
            ["u2", 2],
          ],
          1000,
          6,
        ),
      },
      { usr_email: true },
      false,
    );
    expect(res.field).toBe("usr_email");
    expect(res.users).toBe(5);
  });

  it("a 3-user app keeps every value because fewer than 3 would remain", () => {
    const res = resolveIdentity(
      { sessions: 30, usr_email__values: 3, usr_email__sessions: 30 },
      {
        usr_email: top(
          [
            ["a", 12],
            ["b", 10],
            ["c", 8],
          ],
          30,
          3,
        ),
      },
      { usr_email: true },
      false,
    );
    expect(res.excluded).toEqual([]);
    expect(res.users).toBe(3);
  });

  it("Include it keeps the dominant value", () => {
    const res = resolveIdentity(
      { sessions: 6400, usr_email__values: 181, usr_email__sessions: 6129 },
      { usr_email: top([["bot", 5293]], 6129, 181) },
      { usr_email: true },
      true,
    );
    expect(res.excluded).toEqual([]);
    expect(res.users).toBe(181);
  });

  it("walks candidates in usr_id, usr_email, usr_anonymous_id order and skips absent fields", () => {
    const res = resolveIdentity(
      {
        sessions: 100,
        usr_id__values: 1,
        usr_id__sessions: 100,
        usr_anonymous_id__values: 50,
        usr_anonymous_id__sessions: 90,
      },
      {
        usr_id: top([["x", 100]], 100, 1),
        usr_anonymous_id: top([["a1", 5]], 90, 50),
      },
      { usr_id: true, usr_anonymous_id: true },
      false,
    );
    expect(res.field).toBe("usr_anonymous_id");
    expect(res.coverage).toBeCloseTo(0.9, 5);
  });
});

describe("resolveIdentity by coverage (scope addition 6)", () => {
  const PLACEHOLDER = "placeholder@synthetic.test";

  it("o2-website: one value on ~100% of sessions resolves to none with the placeholder reason", () => {
    const res = resolveIdentity(
      { sessions: 31765, usr_email__values: 1, usr_email__sessions: 31762 },
      { usr_email: top([[PLACEHOLDER, 31762]], 31762, 1) },
      { usr_email: true },
      false,
    );
    expect(res.field).toBeNull();
    expect(res.partial).toBe(false);
    expect(res.gap).toEqual({
      reason: "placeholder",
      field: "usr_email",
      share: 31762 / 31765,
    });
    const message = identityGapMessage(res);
    expect(message).toContain("usr_email");
    expect(message).toContain("100.0%");
    expect(message).toMatch(/placeholder/i);
    expect(message).toMatch(/anonymous id/i);
    expect(message).not.toContain(PLACEHOLDER);
    expect(identityGapMessage(res)).not.toMatch(/Set one up from Retention|Call setUser once/);
  });

  it("o2-prod: the dominant value is excluded and the rest cover 12.5%, so it resolves as partial", () => {
    const res = resolveIdentity(
      { sessions: 6400, usr_email__values: 174, usr_email__sessions: 6100 },
      {
        usr_email: top(
          [
            ["synthetic-bot@synthetic.test", 5300],
            ["a@synthetic.test", 40],
            ["b@synthetic.test", 30],
          ],
          6100,
          174,
        ),
      },
      { usr_email: true },
      false,
    );
    expect(res.field).toBe("usr_email");
    expect(res.users).toBe(173);
    expect(res.coverage).toBeCloseTo(0.125, 6);
    expect(res.partial).toBe(true);
    expect(res.gap).toBeNull();
    const labels = identityLabels(res);
    expect(labels.label).toBe("Identified users (12.5% of sessions)");
    expect(labels.noun).toBe("identified users");
    expect(labels.partial).toBe(true);
    expect(identityGapMessage(res)).toBeNull();
  });

  it("a candidate at 60% resolves as full and keeps the Users label", () => {
    const res = resolveIdentity(
      { sessions: 1000, usr_email__values: 80, usr_email__sessions: 600 },
      { usr_email: top([["a@synthetic.test", 20]], 600, 80) },
      { usr_email: true },
      false,
    );
    expect(res.field).toBe("usr_email");
    expect(res.coverage).toBeCloseTo(0.6, 6);
    expect(res.partial).toBe(false);
    expect(identityLabels(res).label).toBe("Users");
    expect(identityLabels(res).noun).toBe("users");
  });

  it("picks the first candidate that reaches 50%, not the first that resolves", () => {
    const res = resolveIdentity(
      {
        sessions: 1000,
        usr_id__values: 40,
        usr_id__sessions: 100,
        usr_email__values: 300,
        usr_email__sessions: 700,
      },
      {
        usr_id: top([["id-1", 5]], 100, 40),
        usr_email: top([["a@synthetic.test", 9]], 700, 300),
      },
      { usr_id: true, usr_email: true },
      false,
    );
    expect(res.field).toBe("usr_email");
    expect(res.partial).toBe(false);
  });

  it("with no candidate at 50% it takes the highest coverage and marks it partial", () => {
    const res = resolveIdentity(
      {
        sessions: 1000,
        usr_id__values: 40,
        usr_id__sessions: 100,
        usr_email__values: 300,
        usr_email__sessions: 300,
      },
      {
        usr_id: top([["id-1", 5]], 100, 40),
        usr_email: top([["a@synthetic.test", 9]], 300, 300),
      },
      { usr_id: true, usr_email: true },
      false,
    );
    expect(res.field).toBe("usr_email");
    expect(res.partial).toBe(true);
    expect(identityLabels(res).label).toBe("Identified users (30.0% of sessions)");
  });

  it("usr_anonymous_id resolves with the Visitors label", () => {
    const res = resolveIdentity(
      { sessions: 100, usr_anonymous_id__values: 80, usr_anonymous_id__sessions: 90 },
      { usr_anonymous_id: top([["anon-1", 2]], 90, 80) },
      { usr_anonymous_id: true },
      false,
    );
    expect(res.field).toBe("usr_anonymous_id");
    expect(res.partial).toBe(false);
    const labels = identityLabels(res);
    expect(labels.label).toBe("Visitors");
    expect(labels.short).toBe("Visitors");
    expect(labels.noun).toBe("visitors");
    expect(labels.one).toBe("Visitor");
  });

  it("a partial usr_anonymous_id reads Identified visitors with its coverage", () => {
    const res = resolveIdentity(
      { sessions: 100, usr_anonymous_id__values: 10, usr_anonymous_id__sessions: 20 },
      { usr_anonymous_id: top([["anon-1", 2]], 20, 10) },
      { usr_anonymous_id: true },
      false,
    );
    expect(identityLabels(res).label).toBe("Identified visitors (20.0% of sessions)");
    expect(identityLabels(res).short).toBe("Identified visitors");
  });

  it("no identity field with a value resolves to none with the absent reason", () => {
    const res = resolveIdentity(
      { sessions: 50, usr_email__values: 0, usr_email__sessions: 0 },
      { usr_email: [] },
      { usr_email: true },
      false,
    );
    expect(res.field).toBeNull();
    expect(res.gap).toEqual({ reason: "absent", field: null, share: 0 });
    expect(identityGapMessage(res)).toMatch(/No session in this range carries/);
    expect(resolveIdentity({ sessions: 50 }, {}, {}, false).gap?.reason).toBe("absent");
  });

  it("with no identity the labels stay Users and no coverage is shown", () => {
    expect(identityLabels(null).label).toBe("Users");
    expect(identityLabels(null).partial).toBe(false);
    expect(identityGapMessage(null)).toBeNull();
  });
});

describe("identityExclusionNote (F34)", () => {
  const TWO_FIELDS = {
    summary: {
      sessions: 1000,
      usr_email__values: 100,
      usr_email__sessions: 950,
      usr_anonymous_id__values: 300,
      usr_anonymous_id__sessions: 400,
    },
    top: {
      usr_email: top(
        [
          ["dominant@synthetic.test", 830],
          ["a@synthetic.test", 9],
        ],
        950,
        100,
      ),
      usr_anonymous_id: top([["anon-1", 4]], 400, 300),
    },
    schema: { usr_email: true, usr_anonymous_id: true },
  };
  const resolve = (includeAll: boolean) =>
    resolveIdentity(TWO_FIELDS.summary, TWO_FIELDS.top, TWO_FIELDS.schema, includeAll);
  const noteFor = (includeAll: boolean) =>
    identityExclusionNote(
      resolve(includeAll),
      TWO_FIELDS.summary,
      TWO_FIELDS.top,
      TWO_FIELDS.schema,
    );

  it("the exclusion pushes usr_email under 50% and usr_anonymous_id wins, yet the note names usr_email's excluded value", () => {
    expect(resolve(false).field).toBe("usr_anonymous_id");
    expect(resolve(false).excluded).toEqual([]);
    expect(noteFor(false)).toEqual({
      field: "usr_email",
      count: 1,
      share: 830 / 950,
      fallback: "usr_anonymous_id",
    });
  });

  it("with every value included usr_email wins in full and the note still offers to exclude again", () => {
    expect(resolve(true).field).toBe("usr_email");
    expect(resolve(true).partial).toBe(false);
    expect(noteFor(true)).toEqual({
      field: "usr_email",
      count: 1,
      share: 830 / 950,
      fallback: null,
    });
  });

  it("a guard that keeps the field names that field's exclusions in both states", () => {
    const summary = { sessions: 6400, usr_email__values: 174, usr_email__sessions: 6100 };
    const tops = { usr_email: top([["synthetic-bot@synthetic.test", 5300]], 6100, 174) };
    const schema = { usr_email: true };
    for (const includeAll of [false, true]) {
      const res = resolveIdentity(summary, tops, schema, includeAll);
      expect(identityExclusionNote(res, summary, tops, schema)).toEqual({
        field: "usr_email",
        count: 1,
        share: 5300 / 6100,
        fallback: null,
      });
    }
  });

  it("no dominant value on any field means no note", () => {
    const summary = { sessions: 1000, usr_email__values: 80, usr_email__sessions: 600 };
    const tops = { usr_email: top([["a@synthetic.test", 20]], 600, 80) };
    const schema = { usr_email: true };
    for (const includeAll of [false, true]) {
      const res = resolveIdentity(summary, tops, schema, includeAll);
      expect(identityExclusionNote(res, summary, tops, schema)).toBeNull();
    }
  });
});

describe("samplingRatio and formatCount (AC-52)", () => {
  it.each([
    [818986, false, 1],
    [1000000, false, 1],
    [3666563, false, 4],
    [1500000, false, 2],
    [9000000, false, 16],
    [90000000, false, 16],
    [3666563, true, 1],
  ])("%d rows exact=%s -> 1 in %d", (rows, exact, r) => {
    expect(samplingRatio(rows, exact)).toBe(r);
  });

  it("scales sampled counts and marks them approximate", () => {
    expect(formatCount(8549, 4)).toBe("~34,196");
    expect(formatCount(8549, 1)).toBe("8,549");
  });
});

describe("parseNamedEvent (AC-44, AC-69)", () => {
  const ID = "2kY9pF34Qy6nB3Wwd25rq4f5zr3";
  const good = {
    id: ID,
    app: "web",
    name: "Logs page",
    rules: [{ t: "view", op: "eq", value: "/web/logs" }],
    version: 3,
    createdBy: "a@b.c",
    createdAt: 1,
    updatedBy: "d@e.f",
    updatedAt: 2,
  };

  it("accepts a server row for the same app, with no v field", () => {
    expect(parseNamedEvent(good, "web")).toEqual(good);
  });

  it("accepts a name of 64 dotted I, exactly 128 characters once lowercased, in events, funnels and drafts (F52)", () => {
    const name = "\u0130".repeat(64);
    expect(nameFits(name)).toBe(true);
    expect(nameFits("\u0130".repeat(65))).toBe(false);
    expect(nameFits(` ${name} `)).toBe(true);
    expect(parseNamedEvent({ ...good, name }, "web")?.name).toBe(name);
    expect(parseNamedEventDraft({ ...good, name }, "web")?.name).toBe(name);
    expect(parseNamedEventDraft({ ...good, name: "\u0130".repeat(65) }, "web")).toBeNull();
  });

  it.each([
    ["another app", { ...good, app: "other" }],
    ["no rules", { ...good, rules: [] }],
    ["11 rules", { ...good, rules: Array(11).fill(good.rules[0]) }],
    ["long name", { ...good, name: "x".repeat(81) }],
    ["a name over 128 characters once lowercased (F52)", { ...good, name: "\u0130".repeat(65) }],
    ["empty name", { ...good, name: "" }],
    ["300-char regex", { ...good, rules: [{ t: "view", op: "regex", value: "a".repeat(300) }] }],
    ["backreference", { ...good, rules: [{ t: "view", op: "regex", value: "(a)\\1" }] }],
    ["lookahead", { ...good, rules: [{ t: "view", op: "regex", value: "^/checkout(?!/done)" }] }],
    ["bad regex", { ...good, rules: [{ t: "view", op: "regex", value: "(" }] }],
    ["21 targets", { ...good, rules: [{ t: "action", targets: Array(21).fill("x") }] }],
    ["empty target", { ...good, rules: [{ t: "action", targets: [""] }] }],
    ["unknown rule", { ...good, rules: [{ t: "sql", value: "1=1" }] }],
    ["unknown op", { ...good, rules: [{ t: "view", op: "like", value: "/a" }] }],
    ["long value", { ...good, rules: [{ t: "view", op: "eq", value: "/" + "a".repeat(1024) }] }],
    [
      "long onPage",
      { ...good, rules: [{ t: "action", targets: ["x"], onPage: "/" + "a".repeat(1024) }] },
    ],
    ["a 12-character KV id", { ...good, id: "abc123def456" }],
    ["a 27-character id with a dash", { ...good, id: "2kY9pF34Qy6nB3Wwd25rq4f5z-3" }],
    ["no version", { ...good, version: undefined }],
    ["a string version", { ...good, version: "3" }],
    ["version 0", { ...good, version: 0 }],
    ["no timestamps", { ...good, updatedAt: undefined }],
    ["a missing actor", { ...good, updatedBy: undefined }],
    ["a string", JSON.stringify(good)],
    ["null", null],
  ])("rejects %s", (_label, raw) => {
    expect(parseNamedEvent(raw, "web")).toBeNull();
  });

  it("parses a draft by name and rules only, for save's pre-check and the preview", () => {
    const draft = { app: "web", name: "Logs page", rules: good.rules };
    expect(parseNamedEventDraft(draft, "web")).toEqual(draft);
    expect(parseNamedEventDraft({ ...draft, id: "preview" }, "web")).toEqual(draft);
    expect(parseNamedEventDraft({ ...draft, rules: Array(11).fill(good.rules[0]) }, "web")).toBe(
      null,
    );
    expect(parseNamedEventDraft({ ...draft, app: "shop" }, "web")).toBeNull();
    expect(parseNamedEventDraft({ ...draft, name: "  " }, "web")).toBeNull();
  });

  it("holds ids to the server's 27-character KSUID rule", () => {
    expect(isEntityId(ID)).toBe(true);
    expect(isEntityId("0".repeat(27))).toBe(true);
    expect(isEntityId("0".repeat(26))).toBe(false);
    expect(isEntityId("0".repeat(28))).toBe(false);
    expect(isEntityId(`${"0".repeat(26)}_`)).toBe(false);
    expect(isEntityId(42)).toBe(false);
  });
});

describe("parseSavedFunnel (AC-67, AC-69)", () => {
  const EV = "2kY9pF34Qy6nB3Wwd25rq4f5zr3";
  const row = {
    id: "2A7YeEEBY3ABp3e2zS8iq9y7Ajz",
    app: "web",
    name: "Signup",
    description: "Landing to signup",
    def: {
      s: [
        ["p", "/web/"],
        ["e", EV],
      ],
      u: "sessions",
      w: "session",
    },
    sql: 'SELECT 1 FROM "_rumdata"',
    eventIds: [EV],
    version: 2,
    createdBy: "a@b.c",
    createdAt: 1,
    updatedBy: "d@e.f",
    updatedAt: 2,
  };

  it("accepts a row and turns its def into a funnel definition", () => {
    expect(parseSavedFunnel(row, "web")).toEqual({
      ...row,
      def: {
        steps: [
          { kind: "p", key: "/web/" },
          { kind: "e", key: EV },
        ],
        unit: "sessions",
        window: "session",
        breakdown: null,
      },
    });
    expect(parseSavedFunnel({ ...row, description: null }, "web")?.description).toBeUndefined();
  });

  it.each([
    ["another app", { ...row, app: "shop" }],
    ["a bad id", { ...row, id: "short" }],
    ["one step", { ...row, def: { ...row.def, s: [["p", "/"]] } }],
    ["11 steps", { ...row, def: { ...row.def, s: Array(11).fill(["p", "/"]) } }],
    [
      "an e step that is not an id",
      {
        ...row,
        def: {
          ...row.def,
          s: [
            ["p", "/"],
            ["e", "x"],
          ],
        },
      },
    ],
    ["a hostile unit", { ...row, def: { ...row.def, u: "x' OR 1=1" } }],
    ["a long name", { ...row, name: "x".repeat(81) }],
    ["a name over 128 characters once lowercased (F52)", { ...row, name: "\u0130".repeat(65) }],
    ["a blank name", { ...row, name: " " }],
    ["a long description", { ...row, description: "x".repeat(501) }],
    ["no sql", { ...row, sql: "" }],
    ["sql over the cap", { ...row, sql: "x".repeat(MAX_SQL_BYTES + 1) }],
    ["no version", { ...row, version: undefined }],
    ["no actor", { ...row, createdBy: 1 }],
  ])("rejects %s", (_label, raw) => {
    expect(parseSavedFunnel(raw, "web")).toBeNull();
  });

  it("parses a draft with name, description, def and sql", () => {
    const def = parseSavedFunnel(row, "web")!.def;
    const draft = { name: " Signup ", description: "", def, sql: row.sql };
    expect(parseSavedFunnelDraft(draft)).toEqual({
      name: "Signup",
      def: row.def,
      sql: row.sql,
    });
    expect(parseSavedFunnelDraft({ ...draft, description: "d" })?.description).toBe("d");
    expect(parseSavedFunnelDraft({ ...draft, def: { ...def, steps: def.steps.slice(0, 1) } })).toBe(
      null,
    );
    expect(parseSavedFunnelDraft({ ...draft, sql: "é".repeat(MAX_SQL_BYTES / 2 + 1) })).toBeNull();
  });
});

describe("regexProblem matches the engine's regex syntax (AC-44, F5)", () => {
  it.each([
    ["^/checkout(?!/done)", "unsupported"],
    ["(?=a)b", "unsupported"],
    ["(?<=a)b", "unsupported"],
    ["(?<!a)b", "unsupported"],
    ["(a)\\1", "backreference"],
    ["\\k<n>", "backreference"],
    ["\\G", "unsupported"],
    ["\\Z", "unsupported"],
    ["\\cA", "unsupported"],
    ["\\0", "unsupported"],
    ["\\e", "unsupported"],
    ["\\R", "unsupported"],
    ["a{", "unsupported"],
    ["a{2", "unsupported"],
    ["(", "invalid"],
    ["{", "unsupported"],
    ["{id}/orders", "unsupported"],
    ["a|{2}", "unsupported"],
    ["({2})", "unsupported"],
    ["(?i){2}", "unsupported"],
    ["[^]", "invalid"],
    ["[]", "invalid"],
    ["[[]", "invalid"],
    ["[\\b]", "unsupported"],
    ["[\\A]", "unsupported"],
    ["(?)", "invalid"],
    ["(?-)", "invalid"],
    ["(?i-)a", "invalid"],
    ["(?ii)a", "invalid"],
    ["(?-:a)", "invalid"],
    ["[\\d-z]", "unsupported"],
    ["[a-\\w]", "unsupported"],
    ["[\\d-\\w]", "unsupported"],
    ["[\\p{L}-z]", "unsupported"],
    ["[a-\\p{L}]", "unsupported"],
    ["[\\pL-z]", "unsupported"],
    ["[a-\\pL]", "unsupported"],
    ["[\\D-z]", "unsupported"],
    ["[a-\\d]", "unsupported"],
    ["[\\d-z-]", "unsupported"],
    ["[\\w-.]", "unsupported"],
    ["[^\\d-z]", "unsupported"],
    ["[\\s-a-z]", "unsupported"],
    ["[&-\\d]", "unsupported"],
    ["\\p[a-\\d]", "invalid"],
    ["\\p[", "invalid"],
    ["\\p{L", "invalid"],
    ["\\P{L", "invalid"],
    ["\\p1", "invalid"],
    ["\\p", "invalid"],
    ["a\\p", "invalid"],
    ["\\p-", "invalid"],
    ["\\p{}", "invalid"],
    ["\\pa", "invalid"],
    ["\\pX", "invalid"],
    ["[\\p1]", "invalid"],
    ["[\\p{L]", "invalid"],
    ["\\x{41", "invalid"],
    ["\\u{41", "invalid"],
    ["^/a\\xZ", "invalid"],
    ["\\x4", "invalid"],
    ["\\x4G", "invalid"],
    ["\\x", "invalid"],
    ["a\\u", "invalid"],
    ["\\u12", "invalid"],
    ["\\u004G", "invalid"],
    ["\\U0000004", "invalid"],
    ["\\x{4G}", "invalid"],
    ["\\x{ 41}", "invalid"],
    ["\\x{-1}", "invalid"],
    ["\\x{+41}", "invalid"],
    ["\\x{110000}", "invalid"],
    ["\\x{D800}", "invalid"],
    ["\\u{D800}", "invalid"],
    ["[\\xZ]", "invalid"],
    ["\\u" + "D800", "invalid"],
    ["\\U" + "00110000", "invalid"],
  ])("rejects %s as %s", (pattern, problem) => {
    expect(regexProblem(pattern)).toBe(problem);
  });

  it.each([
    "(?<name>a)",
    "\\z",
    "\\A",
    "\\/",
    "\\-",
    "\\p{L}",
    "]",
    "}",
    "[a-z]+",
    "\\d{2,}",
    "a{2}",
    "(?i)abc",
    "\\x41",
    "[[:alpha:]]",
    "[{(?=]",
    "a*?",
    "\\bword\\B",
    "(?:a)",
    "^/web/.*$",
    "(?R)^/a$",
    "(?R:a)",
    "(?-R)a",
    "(?iR-sU)a",
    "(?-i)a",
    "(?P<n>a)",
    "[]a]",
    "[^]a]",
    "[\\]]",
    "[[a]b]",
    "[\\d]",
    "[\\s-]",
    "\\({2}",
    "(a){2}",
    "[a]{2}",
    "[\\d-]",
    "[-\\d]",
    "[\\x41-z]",
    "[\\n-z]",
    "[\\--z]",
    "[\\d\\-z]",
    "[a-z\\d-]",
    "[\\.-z]",
    "[[\\d]-z]",
    "[\\t-z]",
    "[a-z-\\d]",
    "[]-\\d]",
    "[[:alpha:]-z]",
    "[\\pLa-z]",
    "[a-z\\s-]",
    "\\pL",
    "\\PL",
    "\\pZ",
    "\\PZ",
    "\\pC",
    "\\pM",
    "\\pN",
    "\\pP",
    "\\pS",
    "\\pl",
    "\\pn",
    "\\p{Greek}",
    "\\x{41}",
    "[\\p{L}a]",
    "\\x{10FFFF}",
    "\\x{0041}",
    "\\x{000000041}",
    "\\u{41}",
    "\\U{41}",
    "[\\x41-\\x5A]",
    "\\xff",
    "\\x41x",
    "\\u" + "0041",
    "\\U" + "0010FFFF",
    "[\\u" + "00e9-\\u" + "00ff]",
  ])("accepts %s", (pattern) => {
    expect(regexProblem(pattern)).toBeNull();
  });
});

describe("URL codec and validators (D-45, AC-14, AC-20)", () => {
  it("round-trips a funnel definition", () => {
    const def = {
      s: [
        ["p", "/web"],
        ["c", "save"],
      ],
      u: "users",
      w: "1d",
      b: "browser",
    };
    expect(decodeDef(encodeDef(def))).toEqual(def);
    expect(parseFunnelDef(decodeDef(encodeDef(def)))).toEqual({
      steps: [
        { kind: "p", key: "/web" },
        { kind: "c", key: "save" },
      ],
      unit: "users",
      window: "1d",
      breakdown: "browser",
    });
  });

  it("forces the window to Same session in Sessions mode", () => {
    expect(parseFunnelDef({ s: [["p", "/"]], u: "sessions", w: "7d" })?.window).toBe("session");
  });

  it.each([
    ["unknown window", { s: [["p", "/"]], u: "users", w: "2y" }],
    ["kind x", { s: [["x", "/"]], u: "sessions", w: "session" }],
    ["1,000 steps", { s: Array(1000).fill(["p", "/"]), u: "sessions", w: "session" }],
    ["unknown dimension", { s: [["p", "/"]], u: "sessions", w: "session", b: "email" }],
    ["long key", { s: [["p", "x".repeat(1025)]], u: "sessions", w: "session" }],
    ["no steps", { s: [], u: "sessions", w: "session" }],
  ])("rejects %s", (_label, raw) => {
    expect(parseFunnelDef(raw)).toBeNull();
  });

  it("rejects an oversize or non-JSON param", () => {
    expect(decodeDef("a".repeat(MAX_PARAM_LENGTH + 1))).toBeUndefined();
    expect(decodeDef("not-json")).toBeUndefined();
    expect(decodeDef(undefined)).toBeUndefined();
  });

  it("parses step refs including named events, whose keys follow the id rule", () => {
    const id = "2kY9pF34Qy6nB3Wwd25rq4f5zr3";
    expect(parseStepRef(["e", id])).toEqual({ kind: "e", key: id });
    expect(parseStepRef(["e", "abc"])).toBeNull();
    expect(parseStepRef(["e", ""])).toBeNull();
    expect(parseStepRef(["q", "abc"])).toBeNull();
    expect(parseStepRef("p:/")).toBeNull();
  });

  it("a key with a quote yields valid SQL that matches it exactly", () => {
    const def = parseFunnelDef({
      s: [
        ["p", "/it's"],
        ["c", "e'"],
      ],
      u: "sessions",
      w: "session",
    });
    const s: AnalyticsScope = { app: "web", env: [], version: [], schema: {} };
    const sql = funnelSql(s, null, def!, { events: [], sample: 1 });
    expect(sql).toContain("k = '/it''s'");
    expect(sql).toContain("= 'e'''");
    expect(sql.split("'").length % 2).toBe(1);
  });

  it("validates paths params", () => {
    expect(
      parsePathsDef({ anchor: encodeDef(["p", "/web"]), dir: "prev", depth: "4", inc: "pages" }),
    ).toEqual({
      anchor: { kind: "p", key: "/web" },
      direction: "prev",
      depth: 4,
      include: "pages",
      cohort: null,
    });
    expect(parsePathsDef({ anchor: encodeDef(["p", "/"]), depth: "500" })).toBeNull();
    expect(parsePathsDef({ anchor: encodeDef(["p", "/"]), dir: "up" })).toBeNull();
    expect(parsePathsDef({ anchor: encodeDef(["p", "/"]), inc: "all", depth: "3" })?.depth).toBe(3);
    const cohort = encodeDef({
      s: [
        ["p", "/a"],
        ["p", "/b"],
      ],
      u: "sessions",
      w: "session",
      k: 1,
    });
    expect(parsePathsDef({ cohort })?.cohort?.stepIndex).toBe(1);
    expect(
      parsePathsDef({
        cohort: encodeDef({
          s: [
            ["p", "/a"],
            ["p", "/b"],
          ],
          u: "sessions",
          w: "session",
          k: 2,
        }),
      }),
    ).toBeNull();
  });

  it("validates retention params", () => {
    expect(
      parseRetentionDef({ rs: encodeDef(["c", "save"]), per: "week", rmode: "after" }),
    ).toEqual({
      start: { kind: "c", key: "save" },
      ret: null,
      per: "week",
      mode: "after",
    });
    expect(parseRetentionDef({ per: "year" })).toBeNull();
    expect(parseRetentionDef({ rmode: "sometimes" })).toBeNull();
  });

  it("validates shell params and reports invalid ones", () => {
    const res = parseScope({
      app: "web",
      env: ["prod", "staging"],
      period: "7d",
      idall: "1",
      exact: "2",
    });
    expect(res.scope.app).toBe("web");
    expect(res.scope.env).toEqual(["prod", "staging"]);
    expect(res.scope.includeAllIdentities).toBe(true);
    expect(res.invalid).toEqual(["exact"]);
    expect(parseScope({ app: "x".repeat(257) }).invalid).toEqual(["app"]);
    expect(parseScope({ from: "10", to: "5" }).invalid).toEqual(["from"]);
  });
});

describe("deltas and chips (AC-5)", () => {
  it("computes percent change, New, and none", () => {
    expect(computeDelta(150, 100, true)).toEqual({ kind: "pct", value: 0.5 });
    expect(computeDelta(5, 0, true)).toEqual({ kind: "new" });
    expect(computeDelta(5, 3, false)).toEqual({ kind: "new" });
    expect(computeDelta(0, 0, true)).toEqual({ kind: "none" });
  });

  const hits = [
    {
      k: "/a",
      sessions: 150,
      prev_sessions: 100,
      views: 300,
      prev_views: 200,
      users: 10,
      prev_users: 9,
      rank_key: 150,
    },
    {
      k: "/b",
      sessions: 40,
      prev_sessions: 100,
      views: 50,
      prev_views: 120,
      users: 4,
      prev_users: 9,
      rank_key: 100,
    },
    {
      k: "/c",
      sessions: 0,
      prev_sessions: 80,
      views: 0,
      prev_views: 90,
      users: 0,
      prev_users: 7,
      rank_key: 80,
    },
    {
      k: "/d",
      sessions: 12,
      prev_sessions: 0,
      views: 20,
      prev_views: 0,
      users: 1,
      prev_users: 0,
      rank_key: 12,
    },
  ];

  it("maps page rows with share, events and users (AC-2)", () => {
    const rows = toRankedRows(hits, "p", "all", "usr_email", 200, 400, true);
    expect(rows[0]).toMatchObject({
      kind: "p",
      key: "/a",
      sessions: 150,
      users: 10,
      events: 300,
      share: 0.75,
      prevShare: 0.25,
    });
    expect(rows[0].delta).toEqual({ kind: "pct", value: 0.5 });
    expect(toRankedRows(hits, "p", "all", null, 200, 400, true)[0].users).toBeNull();
  });

  it("filters Rising, Declining and Not used; Not used sorts by previous sessions", () => {
    const rows = toRankedRows(hits, "p", "all", null, 200, 400, true);
    expect(rows.filter((r) => matchesChip(r, "rising", true)).map((r) => r.key)).toEqual([
      "/a",
      "/d",
    ]);
    expect(rows.filter((r) => matchesChip(r, "declining", true)).map((r) => r.key)).toEqual([
      "/b",
      "/c",
    ]);
    const unused = sortForChip(
      rows.filter((r) => matchesChip(r, "not_used", true)),
      "not_used",
    );
    expect(unused.map((r) => r.key)).toEqual(["/c"]);
    expect(rows.filter((r) => matchesChip(r, "all", true)).map((r) => r.key)).toEqual([
      "/a",
      "/b",
      "/d",
    ]);
  });

  it("hides Not used and reads New everywhere when the previous window is empty", () => {
    const rows = toRankedRows(hits, "p", "all", null, 200, 0, false);
    expect(rows.every((r) => r.delta.kind === "new" || r.sessions === 0)).toBe(true);
    expect(rows.filter((r) => matchesChip(r, "not_used", false))).toEqual([]);
    expect(rows.filter((r) => matchesChip(r, "rising", false))).toEqual([]);
    expect(chipCounts([rows], false).not_used).toBe(0);
  });

  it("counts chips across both lists", () => {
    const pages = toRankedRows(hits, "p", "all", null, 200, 400, true);
    const clicks = toRankedRows(
      [{ k: "save", sessions: 10, prev_sessions: 1, clicks: 12, prev_clicks: 1, rank_key: 10 }],
      "c",
      "all",
      null,
      200,
      400,
      true,
    );
    expect(chipCounts([pages, clicks], true)).toEqual({
      all: 4,
      rising: 3,
      declining: 2,
      not_used: 1,
    });
    expect(clicks[0].events).toBe(12);
  });

  it("maps the Entry view from Q6 columns without an events column (AC-42)", () => {
    const rows = toRankedRows(
      [
        {
          k: "/",
          entry_sessions: 30,
          prev_entry_sessions: 20,
          exit_sessions: 5,
          prev_exit_sessions: 4,
          rank_key: 59,
        },
      ],
      "p",
      "entry",
      null,
      100,
      100,
      true,
    );
    expect(rows[0]).toMatchObject({
      key: "/",
      sessions: 30,
      prevSessions: 20,
      events: null,
      share: 0.3,
    });
    const exits = toRankedRows(
      [
        {
          k: "/",
          entry_sessions: 30,
          prev_entry_sessions: 20,
          exit_sessions: 5,
          prev_exit_sessions: 4,
          rank_key: 59,
        },
      ],
      "p",
      "exit",
      null,
      100,
      100,
      true,
    );
    expect(exits[0].sessions).toBe(5);
  });
});

describe("click hints and page counts (AC-57)", () => {
  it("shows the hint when fewer than 20% of clicks have data-test-like names", () => {
    expect(
      clickNameHint([
        { key: "Sign up now", clicks: 90 },
        { key: "logs-search-bar-refresh-btn", clicks: 10 },
      ]),
    ).toBe(true);
    expect(
      clickNameHint([
        { key: "Sign up now", clicks: 10 },
        { key: "logs-search-bar-refresh-btn", clicks: 90 },
      ]),
    ).toBe(false);
    expect(clickNameHint([])).toBe(false);
  });

  it("fills pages and the top page from Q5b", () => {
    const rows = toRankedRows(
      [{ k: "save", sessions: 10, prev_sessions: 1, clicks: 12, prev_clicks: 1, rank_key: 10 }],
      "c",
      "all",
      null,
      20,
      20,
      true,
    );
    const out = applyClickPages(rows, [
      { k: "save", pg: "/a", sessions: 7 },
      { k: "save", pg: "/b", sessions: 9 },
      { k: "other", pg: "/c", sessions: 1 },
    ]);
    expect(out[0].pages).toBe(2);
    expect(out[0].topPage).toBe("/b");
  });
});

describe("funnel model (AC-11, AC-15, AC-46, AC-47)", () => {
  const def = {
    steps: [
      { kind: "p" as const, key: "/a" },
      { kind: "c" as const, key: "b" },
      { kind: "p" as const, key: "/c" },
    ],
    unit: "sessions" as const,
    window: "session" as const,
    breakdown: null,
  };

  it("derives counts, shares, drop-off and time to convert per step", () => {
    const res = toFunnelResult(
      {
        c1: 200,
        c2: 80,
        c3: 20,
        seen1: 250,
        seen2: 0,
        seen3: 30,
        med2: 12000,
        p90_2: 60000,
        med3: 90000,
        p90_3: 400000,
      },
      def,
    );
    expect(res.steps.map((s) => s.units)).toEqual([200, 80, 20]);
    expect(res.steps.map((s) => s.ofFirst)).toEqual([1, 0.4, 0.1]);
    expect(res.steps.map((s) => s.ofPrevious)).toEqual([1, 0.4, 0.25]);
    expect(res.steps.map((s) => s.dropoff)).toEqual([120, 60, 0]);
    expect(res.steps[1].seen).toBe(0);
    expect(res.steps[0].medianMs).toBeNull();
    expect(res.steps[2].medianMs).toBe(90000);
    expect(res.step1Sessions).toBeNull();
  });

  it("keeps counts non-increasing and reports Users-mode left-out sessions", () => {
    const res = toFunnelResult(
      { c1: 10, c2: 12, s1_sessions: 15, left_out: 3 },
      { ...def, steps: def.steps.slice(0, 2), unit: "users" },
    );
    expect(res.steps.map((s) => s.units)).toEqual([10, 10]);
    expect(res.step1Sessions).toBe(15);
    expect(res.leftOut).toBe(3);
  });

  it("formats durations to two significant figures", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(450)).toBe("0.45 s");
    expect(formatDuration(12345)).toBe("12 s");
    expect(formatDuration(90000)).toBe("1.5 min");
    expect(formatDuration(3 * 3600000)).toBe("3.0 h");
    expect(formatDuration(2.5 * 86400000)).toBe("2.5 d");
    const spy = vi.spyOn(i18n.global, "t");
    try {
      formatDuration(90000);
      expect(spy).toHaveBeenCalledWith("rum.analytics.duration.min", { n: "1.5" });
    } finally {
      spy.mockRestore();
    }
  });

  it("folds a breakdown into the top 5 plus Other that sums to the total (AC-47)", () => {
    const hits = [
      { dim: "Chrome", c1: 100, c2: 50 },
      { dim: "Firefox", c1: 40, c2: 10 },
      { dim: "Safari", c1: 30, c2: 12 },
      { dim: "Edge", c1: 20, c2: 5 },
      { dim: "Opera", c1: 10, c2: 1 },
      { dim: "Brave", c1: 5, c2: 2 },
      { dim: null, c1: 3, c2: 0 },
    ];
    const { rows, total } = foldBreakdown(hits, 2);
    expect(rows.map((r) => r.value)).toEqual([
      "Chrome",
      "Firefox",
      "Safari",
      "Edge",
      "Opera",
      null,
    ]);
    expect(rows[5]).toMatchObject({ other: true, counts: [8, 2], atLeast: false });
    expect(total).toEqual([208, 80]);
    expect(rows[0].conversion).toBe(0.5);
  });

  it("names a lone NULL remainder (not set) and marks a capped result at least", () => {
    const hits = [
      { dim: "a", c1: 5 },
      { dim: "b", c1: 4 },
      { dim: "c", c1: 3 },
      { dim: "d", c1: 2 },
      { dim: "e", c1: 1 },
      { dim: null, c1: 1 },
    ];
    expect(foldBreakdown(hits, 1).rows[5]).toMatchObject({ other: false, notSet: true });
    const capped = Array.from({ length: 1000 }, (_, i) => ({ dim: `v${i}`, c1: 1000 - i }));
    expect(foldBreakdown(capped, 1).rows[5].atLeast).toBe(true);
  });
});

describe("recent funnels (AC-20)", () => {
  it("keeps the last 10 distinct funnels per org and app, newest first", () => {
    window.localStorage.clear();
    const mk = (k: string) => ({
      steps: [{ kind: "p" as const, key: k }],
      unit: "sessions" as const,
      window: "session" as const,
      breakdown: null,
    });
    for (let i = 0; i < 12; i++) pushRecentFunnel("org", "app", mk(`/p${i}`));
    pushRecentFunnel("org", "app", mk("/p5"));
    const list = readRecentFunnels("org", "app");
    expect(list).toHaveLength(10);
    expect(list[0].steps[0].key).toBe("/p5");
    expect(list[1].steps[0].key).toBe("/p11");
    expect(readRecentFunnels("org", "other")).toEqual([]);
    window.localStorage.setItem("o2.rum.analytics.org.bad.recent", "not json");
    expect(readRecentFunnels("org", "bad")).toEqual([]);
  });
});

describe("path flow (AC-23, AC-24, AC-26)", () => {
  const row = (s1: string | null, s2: string | null, sessions: number) => ({
    s1,
    s2,
    sessions,
    anchor_sessions: 100,
    path_count: 9,
  });
  const rows = [
    row("p:/a", "c:x", 20),
    row("p:/a", null, 10),
    row("p:/b", "p:/a", 15),
    row("c:k1", "p:/z", 9),
    row("c:k2", null, 8),
    row("c:k3", null, 7),
    row("c:k4", null, 6),
    row("c:k5", null, 5),
    row(null, null, 20),
  ];

  it("merges nodes by depth and key, keeps 5 children plus Other and an exit leaf", () => {
    const flow = buildPathFlow(rows, 2, "next", "p:/anchor");
    const depth1 = flow.nodes.filter((n) => n.depth === 1).map((n) => [n.key, n.value]);
    expect(depth1).toEqual([
      ["p:/a", 30],
      ["p:/b", 15],
      ["c:k1", 9],
      ["c:k2", 8],
      ["c:k3", 7],
      ["", 11],
      ["", 20],
    ]);
    expect(flow.nodes.find((n) => n.name === "1:__other__")?.kind).toBe("other");
    expect(flow.nodes.find((n) => n.name === "1:__exit__")?.kind).toBe("exit");
    expect(flow.kept.get("0")).toEqual(["p:/a", "p:/b", "c:k1", "c:k2", "c:k3"]);
    expect(flow.anchorSessions).toBe(100);
    expect(flow.truncated).toBe(false);
    const other = flow.links.find((l) => l.target === "1:__other__");
    expect(other?.value).toBe(11);
  });

  it("only kept prefixes continue, and child values never exceed their parent", () => {
    const flow = buildPathFlow(rows, 2, "next", "p:/anchor");
    const depth2 = flow.nodes.filter((n) => n.depth === 2);
    expect(depth2.find((n) => n.key === "c:x")?.value).toBe(20);
    expect(depth2.find((n) => n.key === "p:/z")?.value).toBe(9);
    for (const l of flow.links) {
      const src = flow.nodes.find((n) => n.name === l.source)!;
      expect(l.value).toBeLessThanOrEqual(src.value);
    }
  });

  it("labels a missing predecessor Session start in Previous", () => {
    const flow = buildPathFlow([row(null, null, 12)], 1, "prev", "p:/");
    expect(flow.nodes.find((n) => n.depth === 1)?.kind).toBe("start");
  });

  it("flags more than 5,000 paths as truncated", () => {
    expect(
      buildPathFlow(
        [{ s1: "p:/a", sessions: 1, anchor_sessions: 9000, path_count: 6000 }],
        1,
        "next",
        "p:/",
      ).truncated,
    ).toBe(true);
  });

  it("builds branch predicates that match the drawn node, link, Other and exit", () => {
    const flow = buildPathFlow(rows, 2, "next", "p:/anchor");
    expect(branchPredicate(flow, { depth: 1, key: "p:/a", parentKey: null, type: "node" })).toBe(
      "s1 IN ('p:/a','p:/b','c:k1','c:k2','c:k3') AND s1 = 'p:/a'",
    );
    expect(branchPredicate(flow, { depth: 2, key: "c:x", parentKey: "p:/a", type: "link" })).toBe(
      "s1 IN ('p:/a','p:/b','c:k1','c:k2','c:k3') AND s1 = 'p:/a' AND s2 = 'c:x'",
    );
    expect(branchPredicate(flow, { depth: 2, key: "p:/a", parentKey: null, type: "node" })).toBe(
      "s1 IN ('p:/a','p:/b','c:k1','c:k2','c:k3') AND CASE s1 WHEN 'p:/a' THEN s2 IN ('c:x') WHEN 'p:/b' THEN s2 IN ('p:/a') WHEN 'c:k1' THEN s2 IN ('p:/z') WHEN 'c:k2' THEN 1=0 WHEN 'c:k3' THEN 1=0 ELSE FALSE END AND s2 = 'p:/a'",
    );
    expect(branchPredicate(flow, { depth: 2, key: null, parentKey: "c:k2", type: "exit" })).toBe(
      "s1 IN ('p:/a','p:/b','c:k1','c:k2','c:k3') AND s1 = 'c:k2' AND s2 IS NULL",
    );
    expect(branchPredicate(flow, { depth: 1, key: null, parentKey: null, type: "exit" })).toBe(
      "s1 IS NULL",
    );
    expect(branchPredicate(flow, { depth: 1, key: null, parentKey: null, type: "other" })).toBe(
      "s1 IS NOT NULL AND s1 NOT IN ('p:/a','p:/b','c:k1','c:k2','c:k3')",
    );
    expect(
      branchPredicate(flow, {
        depth: 2,
        key: null,
        parentKey: null,
        type: "tuple",
        tuple: ["p:/a", null],
      }),
    ).toBe("s1 = 'p:/a' AND s2 IS NULL");
    expect(
      branchPredicate(flow, {
        depth: 1,
        key: "c:it's",
        parentKey: null,
        type: "tuple",
        tuple: ["c:it's"],
      }),
    ).toBe("s1 = 'c:it''s'");
  });

  it("an Other branch under a parent with no kept children never rewrites a quoted key", () => {
    const tricky = "p:/a NOT IN ()";
    const flow = buildPathFlow([row(tricky, null, 5)], 2, "next", "p:/anchor");
    const pred = branchPredicate(flow, { depth: 2, key: null, parentKey: tricky, type: "other" });
    expect(pred).toBe("s1 IN ('p:/a NOT IN ()') AND s1 = 'p:/a NOT IN ()' AND s2 IS NOT NULL");
  });

  it("builds the same flow from many rows without re-copying each group (nit)", () => {
    const many = Array.from({ length: 5000 }, (_, i) => row(`p:/${i % 7}`, `c:${i % 11}`, 1));
    const flow = buildPathFlow(many, 2, "next", "p:/anchor");
    expect(flow.nodes.filter((n) => n.depth === 1).reduce((a, n) => a + n.value, 0)).toBe(5000);
  });

  it("names a named-event node by its event, in the label and both tooltips (W24)", () => {
    const events = [{ id: "EvtSignup000000000000000001", name: "Signup" }] as never;
    const node = {
      name: "0:e:EvtSignup000000000000000001",
      depth: 0,
      key: "e:EvtSignup000000000000000001",
      kind: "e" as const,
      value: 3,
      pct: 1,
    };
    expect(pathKeyLabel(node, events)).toBe("Signup");
    expect(sankeyLabel(node, events)).toContain("Signup");
    expect(sankeyLabel(node, events)).not.toContain("EvtSignup");
    expect(sankeyTooltip({ dataType: "node", data: node }, events)).toContain("Signup");
    const edge = { source: node.name, target: "1:p:/a", value: 3 };
    expect(sankeyTooltip({ dataType: "edge", data: edge as never }, events)).toContain(
      "Signup → /a",
    );
  });

  it("the node and branch tooltips say a click opens those sessions", () => {
    const node = { name: "1:p:/a", depth: 1, key: "p:/a", kind: "p" as const, value: 3, pct: 0.03 };
    const edge = { source: "0:p:/", target: "1:p:/a", value: 3 };
    expect(sankeyTooltip({ dataType: "node", data: node })).toContain(
      "Click to see these sessions",
    );
    expect(sankeyTooltip({ dataType: "edge", data: edge as never })).toContain(
      "Click to see these sessions",
    );
    expect(
      sankeyTooltip({ dataType: "node", data: { ...node, name: "0:p:/", depth: 0, key: "p:/" } }),
    ).not.toContain("Click to see these sessions");
  });

  it("escapes keys in the tooltip and keeps labels plain text", () => {
    const node = {
      name: "1:c:<img src=x onerror=alert(1)>",
      depth: 1,
      key: "c:<img src=x onerror=alert(1)>",
      kind: "c" as const,
      value: 3,
      pct: 0.03,
    };
    const html = sankeyTooltip({ dataType: "node", data: node });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(sankeyLabel(node)).toBe("<img src=x onerror=alert(1)>\n3 sessions · 3.0%");
  });
});

describe("retention periods and grid (AC-31, AC-32, AC-33, AC-36, AC-51)", () => {
  const DAY = 86400000000;
  const us = (iso: string) => new Date(iso).getTime() * 1000;

  it("picks daily, weekly and monthly by range length and refuses a 1-day range", () => {
    const end = us("2026-09-28T12:00:00Z");
    const now = end;
    const auto = (days: number) =>
      retentionPeriods(end - days * DAY, end, "UTC", now, null, "auto");
    expect((auto(7) as { granularity: string }).granularity).toBe("day");
    expect((auto(30) as { granularity: string }).granularity).toBe("week");
    expect((auto(120) as { granularity: string }).granularity).toBe("month");
    expect(auto(1)).toEqual({ tooShort: true });
  });

  it("starts b0 at the period containing the range start in the user's timezone", () => {
    const start = us("2026-09-21T02:00:00Z");
    const res = retentionPeriods(
      start,
      start + 7 * DAY,
      "Asia/Kolkata",
      start + 7 * DAY,
      null,
      "day",
    ) as { boundariesUs: number[] };
    expect(new Date(res.boundariesUs[0] / 1000).toISOString()).toBe("2026-09-20T18:30:00.000Z");
    const week = retentionPeriods(
      start,
      start + 30 * DAY,
      "UTC",
      start + 30 * DAY,
      null,
      "week",
    ) as { boundariesUs: number[] };
    expect(new Date(week.boundariesUs[0] / 1000).toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("gives a DST day 25 hours and keeps cohorts on local midnight", () => {
    const start = us("2026-10-30T12:00:00Z");
    const res = retentionPeriods(
      start,
      start + 5 * DAY,
      "America/New_York",
      start + 5 * DAY,
      null,
      "day",
    ) as { boundariesUs: number[] };
    const hours = res.boundariesUs.slice(1).map((b, i) => (b - res.boundariesUs[i]) / 3600000000);
    expect(hours).toContain(25);
    expect(new Date(res.boundariesUs[3] / 1000).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("clips cohorts to the first boundary at or after the data start and says so", () => {
    const start = us("2026-09-01T00:00:00Z");
    const dataStart = us("2026-09-10T08:00:00Z");
    const res = retentionPeriods(
      start,
      start + 27 * DAY,
      "UTC",
      start + 27 * DAY,
      dataStart,
      "week",
    ) as {
      boundariesUs: number[];
      clipped: boolean;
      dataStartUs: number;
    };
    expect(res.clipped).toBe(true);
    expect(new Date(res.boundariesUs[0] / 1000).toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(res.dataStartUs).toBe(dataStart);
  });

  it("marks the still-running period", () => {
    const now = us("2026-09-28T12:00:00Z");
    const res = retentionPeriods(now - 7 * DAY, now, "UTC", now, null, "day") as {
      runningIndex: number;
      boundariesUs: number[];
    };
    expect(res.runningIndex).toBe(res.boundariesUs.length - 1);
  });

  it("disables options with too few or too many periods and Month without 2 months of data (CR-25)", () => {
    const end = us("2026-09-28T00:00:00Z");
    const opts = granularityOptions(end - 60 * DAY, end, "UTC", end - 20 * DAY);
    const by = Object.fromEntries(opts.map((o) => [o.value, o]));
    expect(by.day.disabled).toBe(true);
    expect(by.day.reason).toBe("tooMany");
    expect(by.week.disabled).toBe(false);
    expect(by.month.disabled).toBe(true);
    expect(by.month.reason).toBe("dataDays:20");
    const auto = retentionPeriods(end - 120 * DAY, end, "UTC", end, end - 40 * DAY, "auto") as {
      granularity: string;
    };
    expect(auto.granularity).toBe("week");
  });

  const periods = {
    granularity: "week" as const,
    boundariesUs: [0, 1, 2, 3, 4, 5].map((i) => us("2026-08-24T00:00:00Z") + i * 7 * DAY),
    runningIndex: 5,
    dataStartUs: null,
    clipped: false,
  };
  const on = [163, 83, 79, 63, 62, 6];
  const last = [52, 11, 20, 18, 56, 6];
  const hits = on.map((users_on, k) => ({
    cohort: 0,
    k,
    size_part: k === 0 ? 163 : 0,
    users_on,
    users_last: last[k],
  }));
  hits.push(
    { cohort: 1, k: 0, size_part: 62, users_on: 62, users_last: 30 },
    { cohort: 1, k: 1, size_part: 0, users_on: 31, users_last: 32 },
  );

  it("On mode prints users_on per cell and marks the running period incomplete", () => {
    const grid = toRetentionGrid(hits, periods, "UTC", "on");
    expect(grid.rows[0].size).toBe(163);
    expect(grid.rows[0].cells.map((c) => c.users)).toEqual(on);
    expect(grid.rows[0].cells[5].incomplete).toBe(true);
    expect(grid.rows[1].cells.map((c) => c.users)).toEqual([62, 31, 0, 0, 0]);
    expect(grid.rows[0].label).toBe("Aug 24");
  });

  it("labels cohorts in the reader's locale, not in English (W31)", () => {
    const before = i18n.global.locale;
    i18n.global.locale = "fr";
    try {
      expect(toRetentionGrid(hits, periods, "UTC", "on").rows[0].label).toBe("24 août");
    } finally {
      i18n.global.locale = before;
    }
  });

  it("On or after sums later returns and the average skips running cells", () => {
    const grid = toRetentionGrid(hits, periods, "UTC", "after");
    expect(grid.rows[0].cells.map((c) => c.users)).toEqual([163, 111, 100, 80, 62, 6]);
    expect(grid.average[1]).toBeCloseTo((111 + 32) / (163 + 62), 5);
    expect(grid.average[5]).toBeNull();
  });
});

describe("feature rows (AC-45)", () => {
  const ev = (id: string, name: string) => ({
    id,
    app: "web",
    name,
    rules: [{ t: "view" as const, op: "eq" as const, value: "/" }],
    version: 1,
    createdBy: "",
    createdAt: 0,
    updatedBy: "",
    updatedAt: 0,
  });

  it("lists every named event, including those with 0 uses, with delta and share", () => {
    const rows = toFeatureRows(
      {
        e0_sessions: 50,
        e0_prev_sessions: 25,
        e0_events: 70,
        e0_prev_events: 30,
        e0_users: 9,
        e0_prev_users: 4,
        e1_sessions: 0,
        e1_prev_sessions: 3,
        e1_events: 0,
        e1_prev_events: 3,
        e2_sessions: 0,
        e2_prev_sessions: 0,
        e2_events: 0,
        e2_prev_events: 0,
      },
      [ev("a", "Logs"), ev("b", "Old"), ev("c", "Never")],
      100,
      100,
      true,
    );
    expect(rows.map((r) => [r.key, r.sessions])).toEqual([
      ["a", 50],
      ["b", 0],
      ["c", 0],
    ]);
    expect(rows[0]).toMatchObject({
      kind: "e",
      users: 9,
      events: 70,
      share: 0.5,
      delta: { kind: "pct", value: 1 },
    });
    expect(rows[2].users).toBeNull();
  });
});
