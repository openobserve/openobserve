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
import {
  appendConjunct,
  DEFAULT_TOKEN_LIMITS,
  FREE_TEXT_SCAN_MAX_FIELDS,
  isAuthoredStatement,
  looksLikeSqlStatement,
  materializeFreeText,
  phrasePlan,
  planFilter,
  quoteFreeTextPhrase,
  renderPlan,
  streamTextTarget,
  suggestRecovery,
  tokenLimitsFromConfig,
  type FreeTextContext,
  type StreamWithSchema,
  type TextSearchTarget,
} from "@/utils/query/freeTextFilter";
import { addSpacesToOperators } from "@/utils/queryUtils";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import useStreams from "@/composables/useStreams";
import i18nInstance from "@/locales";

const fakeStore = vi.hoisted(() => ({
  state: { selectedOrganization: { identifier: "org" }, streams: {}, zoConfig: {} },
  dispatch: () => undefined,
  commit: () => undefined,
}));

vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
  useStore: () => fakeStore,
}));

const FIELDS: ReadonlySet<string> = new Set([
  "level",
  "is_error",
  "service_name",
  "status",
  "flags",
  "f",
  "arr",
  "k8s.pod name",
  "body",
  "s",
]);
const KNOWN = new Set([
  "level",
  "is_error",
  "service_name",
  "status",
  "flags",
  "f",
  "arr",
  "k8s.pod name",
  "body",
]);
const FTS: TextSearchTarget = { mode: "fts", fields: ["body"] };
const SCAN: TextSearchTarget = { mode: "scan", fields: ["msg_text", "detail"] };
const BLOCKED: TextSearchTarget = { mode: "blocked", candidates: ["msg_text"] };
const LONG_TOKEN = "a".repeat(65);

// Today's handleNonSqlMode WHERE body, copied verbatim as the byte-identity reference.
const legacyWhere = (query: string, knownFields: ReadonlySet<string>): string => {
  let whereClause = query.trim();
  whereClause = whereClause
    .split("\n")
    .filter((line: string) => !line.trim().startsWith("--"))
    .join("\n");
  if (whereClause.trim() == "") return "";
  whereClause = addSpacesToOperators(whereClause);
  const parsedSQL = whereClause.split(" ");
  for (const [index, token] of parsedSQL.entries()) {
    const normalizedToken = token.replaceAll('"', "");
    if (knownFields.has(normalizedToken)) {
      parsedSQL[index] = quoteSqlIdentifierIfNeeded(normalizedToken);
    }
  }
  return parsedSQL.join(" ");
};

const renderFts = (raw: string, fields: ReadonlySet<string> = FIELDS) =>
  renderPlan(planFilter(raw, fields), FTS, KNOWN);

const ctxFor = (targets: Record<string, TextSearchTarget>): FreeTextContext => ({
  fieldNames: FIELDS,
  targets,
  freeTextScan: { nofts: { fields: ["msg_text", "detail"] } },
});

const stream = (overrides: Partial<StreamWithSchema>): StreamWithSchema => ({
  name: "s",
  schema: [],
  settings: {},
  ...overrides,
});

describe("freeTextFilter", () => {
  describe("J2 rows on an fts stream (AC2.1)", () => {
    it.each([
      ["timeout", "match_all('timeout')"],
      ["TIMEOUT", "match_all('TIMEOUT')"],
      ["'connection is closed'", "match_all('connection is closed')"],
      ["*rro*", "match_all('*rro*')"],
      ["-debug", "NOT match_all('debug')"],
      ["error -debug", "match_all('error') AND NOT match_all('debug')"],
      ["error OR -debug", "match_all('error') OR NOT match_all('debug')"],
      ["NOT -debug", "NOT NOT match_all('debug')"],
      ["limit 50", "match_all('limit') AND match_all('50')"],
      ["-'quoted'", "match_all('-''quoted''')"],
      ['"connection refused"', "match_all('connection refused')"],
      ["'connection refused'", "match_all('connection refused')"],
      ["timeout error", "match_all('timeout') AND match_all('error')"],
      ["timeout OR refused", "match_all('timeout') OR match_all('refused')"],
      ["timeout or refused", "match_all('timeout') OR match_all('refused')"],
      ["NOT timeout", "NOT match_all('timeout')"],
      [
        "timeout AND (error OR refused)",
        "match_all('timeout') AND (match_all('error') OR match_all('refused'))",
      ],
      ["500", "match_all('500')"],
      ["-500", "match_all('-500')"],
      ["user@example.com", "match_all('user@example.com')"],
      ["10.0.0.1", "match_all('10.0.0.1')"],
      ["/api/v1/users", "match_all('/api/v1/users')"],
      ["ERR-42", "match_all('ERR-42')"],
      ["time*", "match_all('time*')"],
      ["it's", "match_all('it''s')"],
      ['"connection is closed"', "match_all('connection is closed')"],
      ["ERR:42", "match_all('ERR:42')"],
    ])("%s renders %s", (raw, expected) => {
      const plan = planFilter(raw, FIELDS);
      expect(plan.kind).toBe("freeText");
      expect(renderPlan(plan, FTS, KNOWN)).toBe(expected);
    });

    it.each([["a"], ["5"], ["x"], [LONG_TOKEN]])(
      "%s has no index-eligible token and is sent unchanged",
      (raw) => {
        const plan = planFilter(raw, FIELDS);
        expect(plan).toEqual({ kind: "sql", filter: raw });
        expect(renderPlan(plan, FTS, KNOWN)).toBe(legacyWhere(raw, KNOWN));
      },
    );

    it.each([
      ["timeout AND service_name='api'", "match_all('timeout') AND service_name='api'"],
      ["service_name='api' timeout", "service_name='api' AND match_all('timeout')"],
      [
        "(timeout OR refused) AND status>=500",
        "(match_all('timeout') OR match_all('refused')) AND status>=500",
      ],
      ["f IS NOT NULL timeout", "f IS NOT NULL AND match_all('timeout')"],
    ])("mix %s is sent unchanged and Run as reads %s", (raw, suggestion) => {
      const plan = planFilter(raw, FIELDS);
      expect(plan.kind).toBe("sql");
      expect(renderPlan(plan, FTS, KNOWN)).toBe(legacyWhere(raw, KNOWN));
      expect(suggestRecovery(raw, FIELDS, true)).toEqual({
        runSuggestion: suggestion,
        freeTextCandidate: null,
      });
    });

    it.each([
      ["level"],
      ["LEVEL"],
      ["s.level"],
      ['"level"'],
      ["level:error"],
      ["-level"],
      ["-LEVEL"],
      ["-s.level"],
      ["-level:error"],
      ["-a"],
      ["error -a"],
      ["-" + "a".repeat(64)],
      ["-flags[1]"],
      ["-"],
      ["I/O"],
      ["%"],
      ["_"],
      ["**"],
      ["a".repeat(64)],
      ["timeout a"],
      ["response time"],
      ["null pointer"],
      ["selected from cache"],
      ["enabled limit 5"],
      ["TRUE"],
      ["re_match(f,'x')"],
      ["f LIKE '%x%'"],
      ["f IN ('a')"],
      ["f > 5"],
      ["error AND status=500"],
      ["status=500 timeout"],
      ["''"],
      ['""'],
      [""],
      ["s.is_error"],
      ["flags[1]"],
      ['"is_error"'],
      ["is_error"],
      ["IS_ERROR"],
      ["(IS_ERROR)"],
      ["S.IS_ERROR"],
      ["connection is closed"],
      ["request in progress"],
    ])("%s is unchanged", (raw) => {
      const fields = new Set([...FIELDS, "enabled"]);
      const plan = planFilter(raw, fields);
      expect(plan.kind).toBe("sql");
      expect(renderPlan(plan, FTS, KNOWN)).toBe(legacyWhere(raw, KNOWN));
    });

    it.each([
      ["status=500"],
      ["match_all('x')"],
      ["str_match(f,'x')"],
      ["level IN ('a','b')"],
      ["a BETWEEN 1 AND 5"],
      ["f IS NOT NULL"],
      ["CASE WHEN status > 1 THEN 1 ELSE 0 END = 1"],
      ["f::int > 5"],
      ["arr[1] = 'x'"],
      ["\"k8s.pod name\" = 'x'"],
      ["lower(f) = 'x'"],
      ["a + b > 5"],
      ["a = b AT TIME ZONE 'UTC'"],
      ["TRUE IS DISTINCT FROM FALSE"],
      ["is_error --note"],
      ["1 + 2 timeout"],
      ["s.is_error AND status=500"],
      ["service_name:api"],
    ])("%s is byte-identical to today (AC2.3)", (raw) => {
      const plan = planFilter(raw, FIELDS);
      expect(plan).toEqual({ kind: "sql", filter: raw });
      expect(renderPlan(plan, FTS, KNOWN)).toBe(legacyWhere(raw, KNOWN));
      expect(renderPlan(plan, BLOCKED, KNOWN)).toBe(legacyWhere(raw, KNOWN));
    });

    it("quotes a known field the way today's loop does", () => {
      expect(renderFts("\"k8s.pod name\" = 'x'")).toBe("\"k8s.pod name\" = 'x'");
      expect(renderFts("")).toBe("");
      expect(renderFts("  -- only a comment  ")).toBe("");
    });
  });

  describe("§7 edge cases", () => {
    it("treats and/or/not as operators and their quoted forms as text", () => {
      expect(renderFts("timeout and not error")).toBe(
        "match_all('timeout') AND NOT match_all('error')",
      );
      expect(renderFts("'and' 'or' 'not'")).toBe(
        "match_all('and') AND match_all('or') AND match_all('not')",
      );
    });

    it.each([
      ["timeout AND"],
      ["AND timeout"],
      ["timeout OR"],
      ["(timeout"],
      ["timeout)"],
      ["()"],
      ["NOT"],
      ["timeout AND OR error"],
    ])("dangling or unbalanced connective %s is unclassified and sent unchanged", (raw) => {
      const plan = planFilter(raw, FIELDS);
      expect(plan).toEqual({ kind: "unclassified", filter: raw });
      expect(renderPlan(plan, FTS, KNOWN)).toBe(legacyWhere(raw, KNOWN));
    });

    it("reads -timeout as exclusion", () => {
      expect(renderFts("-timeout")).toBe("NOT match_all('timeout')");
    });

    it("keeps % and _ in a term verbatim, and literal in scan mode", () => {
      expect(renderFts("50%")).toBe("match_all('50%')");
      expect(renderFts("req_id")).toBe("match_all('req_id')");
      expect(planFilter("a_b", FIELDS).kind).toBe("sql");
      const scanPlan = planFilter("a_b", FIELDS, { targetMode: "scan" });
      expect(renderPlan(scanPlan, { mode: "scan", fields: ["msg"] }, KNOWN)).toBe(
        `(("msg" IS NOT NULL AND str_match_ignore_case("msg", 'a_b')))`,
      );
    });

    it("passes re: prefixes and * wrapping through to the backend", () => {
      expect(renderFts("re:timeout")).toBe("match_all('re:timeout')");
      expect(renderFts("*timeout*")).toBe("match_all('*timeout*')");
    });

    it("doubles a quote inside a term", () => {
      expect(renderFts(`"it's broken"`)).toBe("match_all('it''s broken')");
      expect(renderFts("'it''s'")).toBe("match_all('it''s')");
    });

    it("keeps placeholder-like text, ; and -- inside literals inert", () => {
      expect(renderFts("__o2ft_0__")).toBe("match_all('__o2ft_0__')");
      expect(renderFts("'a; DROP -- x'")).toBe("match_all('a; DROP -- x')");
      expect(renderFts("abc;def")).toBe("match_all('abc;def')");
      expect(renderFts("timeout /* note */ error")).toBe(
        "match_all('timeout') AND match_all('error')",
      );
      expect(renderFts("timeout\n-- note\nerror")).toBe(
        "match_all('timeout') AND match_all('error')",
      );
      expect(renderFts("x' OR '1'='1")).toBe(legacyWhere("x' OR '1'='1", KNOWN));
    });

    it("double-quotes malicious scan identifiers with doubled quotes", () => {
      const plan = planFilter("timeout", FIELDS, { targetMode: "scan" });
      const target: TextSearchTarget = { mode: "scan", fields: ['a"b', 'x") OR 1=1 --'] };
      expect(renderPlan(plan, target, KNOWN)).toBe(
        `(("a""b" IS NOT NULL AND str_match_ignore_case("a""b", 'timeout')) OR ` +
          `("x"") OR 1=1 --" IS NOT NULL AND str_match_ignore_case("x"") OR 1=1 --", 'timeout')))`,
      );
    });

    it("allows unicode terms", () => {
      expect(renderFts("café")).toBe("match_all('café')");
      expect(renderFts("日本")).toBe("match_all('日本')");
    });

    it("applies the parser-free pure-text test past SQL_PARSE_MAX_DEPTH", () => {
      const deep = `${"(".repeat(14)}timeout${")".repeat(14)}`;
      expect(planFilter(deep, FIELDS).kind).toBe("freeText");
      expect(suggestRecovery(`${deep} AND status=500`, FIELDS, true)).toEqual({
        runSuggestion: null,
        freeTextCandidate: null,
      });
    });
  });

  describe("lexer quote rules", () => {
    it("starts a quote only at token start", () => {
      expect(planFilter("it's", FIELDS)).toMatchObject({ kind: "freeText", units: ["it's"] });
      expect(planFilter("(timeout)", FIELDS)).toMatchObject({
        kind: "freeText",
        units: ["timeout"],
      });
    });

    it("rejects empty quoted units", () => {
      expect(planFilter("''", FIELDS)).toEqual({ kind: "sql", filter: "''" });
      expect(planFilter('""', FIELDS)).toEqual({ kind: "sql", filter: '""' });
    });

    it.each([["'abc"], ['"abc'], ['a("b'], ["timeout /* open"]])("%s is unclassified", (raw) => {
      expect(planFilter(raw, FIELDS)).toEqual({ kind: "unclassified", filter: raw });
    });

    it("treats a quoted token glued to an operand as identifier syntax", () => {
      expect(planFilter('"x".y', FIELDS).kind).toBe("sql");
      expect(planFilter("'a'b", FIELDS).kind).toBe("sql");
    });

    it("treats a spaced call or a quoted name before ( as SQL", () => {
      expect(planFilter("timeout (error)", FIELDS).kind).toBe("sql");
      expect(planFilter("NOT(timeout)", FIELDS).kind).toBe("freeText");
    });
  });

  describe("field-like detection", () => {
    it.each([
      ["level"],
      ['"level"'],
      ["s.level"],
      ["flags[0]"],
      ["s"],
      ["_timestamp"],
      ["column_all"],
      ["service_name:api"],
      ["Level"],
      ["timeout level"],
    ])("%s is field-like, so the filter is unchanged", (raw) => {
      expect(planFilter(raw, FIELDS).kind).toBe("sql");
    });

    it("lowercases unquoted words and compares quoted words exactly", () => {
      const lower = new Set(["is_error", "s"]);
      for (const raw of ["IS_ERROR", "(IS_ERROR)", "S.IS_ERROR"]) {
        expect(planFilter(raw, lower).kind).toBe("sql");
      }
      expect(planFilter('"IS_ERROR"', lower).kind).toBe("freeText");
      expect(planFilter('"IS_ERROR"', new Set(["IS_ERROR"])).kind).toBe("sql");
    });

    it("keeps a mixed-case stored field unchanged, as today's quoting loop matches it", () => {
      expect(planFilter("Severity", new Set(["Severity"])).kind).toBe("sql");
    });

    it("keeps a non-field left side of left:rest as text", () => {
      for (const raw of ["10:30", "http://x", "ERR:42"]) {
        expect(planFilter(raw, FIELDS).kind).toBe("freeText");
      }
    });
  });

  describe("token gate", () => {
    it("reads the /config limits with the tokenizer's floors", () => {
      expect(tokenLimitsFromConfig(undefined)).toEqual(DEFAULT_TOKEN_LIMITS);
      expect(tokenLimitsFromConfig({})).toEqual({ min: 2, max: 64 });
      expect(
        tokenLimitsFromConfig({
          inverted_index_min_token_length: 8,
          inverted_index_max_token_length: 100,
        }),
      ).toEqual({ min: 8, max: 100 });
      expect(
        tokenLimitsFromConfig({
          inverted_index_min_token_length: 1,
          inverted_index_max_token_length: 10,
        }),
      ).toEqual({ min: 2, max: 64 });
      expect(tokenLimitsFromConfig({ inverted_index_min_token_length: "8" })).toEqual({
        min: 2,
        max: 64,
      });
    });

    it("never auto-rewrites timeout when the minimum token length is 8", () => {
      const tokenLimits = tokenLimitsFromConfig({ inverted_index_min_token_length: 8 });
      expect(planFilter("timeout", FIELDS, { tokenLimits })).toEqual({
        kind: "sql",
        filter: "timeout",
      });
      expect(planFilter("timeouts", FIELDS, { tokenLimits }).kind).toBe("freeText");
    });

    it("drops tokens at or above the maximum, as the tokenizer's RemoveLongFilter does", () => {
      expect(planFilter("a".repeat(63), FIELDS).kind).toBe("freeText");
      expect(planFilter("a".repeat(64), FIELDS).kind).toBe("sql");
    });

    it("needs one eligible token per unit, and skips the gate for scan and blocked targets", () => {
      expect(planFilter("timeout a", FIELDS).kind).toBe("sql");
      expect(planFilter("10.0.0.1", FIELDS).kind).toBe("freeText");
      expect(planFilter("a", FIELDS, { targetMode: "scan" }).kind).toBe("freeText");
      expect(planFilter("'a'", FIELDS, { targetMode: "blocked" }).kind).toBe("freeText");
    });
  });

  describe("phrase recovery (J5)", () => {
    it("quoteFreeTextPhrase emits one single-quoted literal that stays text", () => {
      for (const raw of ["status =", `a("b`, "it's", "a", LONG_TOKEN, "level"]) {
        const quoted = quoteFreeTextPhrase(raw);
        expect(quoted).toBe(`'${raw.replaceAll("'", "''")}'`);
        expect(planFilter(quoted, FIELDS, { targetMode: "scan" })).toMatchObject({
          kind: "freeText",
          units: [raw],
        });
      }
    });

    it.each([["a"], [LONG_TOKEN], ["level"], ["status = "]])(
      "Search text for %s writes match_all that later runs classify as sql",
      (raw) => {
        const editor = renderPlan(phrasePlan(raw), FTS, KNOWN);
        expect(editor).toBe(`match_all('${raw.trim()}')`);
        const replay = planFilter(editor!, FIELDS);
        expect(replay.kind).toBe("sql");
        expect(renderPlan(replay, FTS, KNOWN)).toBe(legacyWhere(editor!, KNOWN));
      },
    );

    it("round-trips quotes and parentheses into a valid phrase plan (AC5.5)", () => {
      expect(planFilter(`a("b`, FIELDS).kind).toBe("unclassified");
      expect(renderPlan(phrasePlan(`a("b`), FTS, KNOWN)).toBe(`match_all('a("b')`);
      expect(renderPlan(phrasePlan(`it's "x" (y`), FTS, KNOWN)).toBe(`match_all('it''s "x" (y')`);
      expect(phrasePlan("   ")).toEqual({ kind: "sql", filter: "   " });
    });

    it("renders a phrase on a no-fts stream as a scan or blocks it", () => {
      expect(renderPlan(phrasePlan("a"), SCAN, KNOWN)).toBe(
        `(("msg_text" IS NOT NULL AND str_match_ignore_case("msg_text", 'a')) OR ` +
          `("detail" IS NOT NULL AND str_match_ignore_case("detail", 'a')))`,
      );
      expect(renderPlan(phrasePlan("a"), BLOCKED, KNOWN)).toBeNull();
    });
  });

  describe("suggestRecovery (§6.3 Step 2, §6.6)", () => {
    it.each([
      ["a BETWEEN 1 AND 5 timeout", "a BETWEEN 1 AND 5 AND match_all('timeout')"],
      [
        "timeout AND (error OR level='x')",
        "match_all('timeout') AND (match_all('error') OR level='x')",
      ],
      [
        "((timeout OR refused)) AND status=500",
        "((match_all('timeout') OR match_all('refused'))) AND status=500",
      ],
      ["NOT timeout AND status=500", "NOT match_all('timeout') AND status=500"],
      ["timeout error status=500", "match_all('timeout') AND match_all('error') AND status=500"],
      [
        "status=500 timeout 'two words'",
        "status=500 AND match_all('timeout') AND match_all('two words')",
      ],
    ])("%s suggests %s", (raw, suggestion) => {
      expect(suggestRecovery(raw, FIELDS, true).runSuggestion).toBe(suggestion);
    });

    it("turns field:value into a comparison (AC5.8)", () => {
      expect(suggestRecovery("service_name:api", FIELDS, true)).toEqual({
        runSuggestion: "service_name='api'",
        freeTextCandidate: null,
      });
      expect(suggestRecovery("service_name:'api' timeout", FIELDS, true).runSuggestion).toBe(
        "service_name='api' AND match_all('timeout')",
      );
      expect(suggestRecovery("service_name:api", FIELDS, false).runSuggestion).toBe(
        "service_name='api'",
      );
    });

    it("offers no Run as when a stream lacks fts, only the phrase card", () => {
      expect(suggestRecovery("service_name='api' timeout", FIELDS, false)).toEqual({
        runSuggestion: null,
        freeTextCandidate: "service_name='api' timeout",
      });
    });

    it.each([
      ["status = ", "status ="],
      ["level", "level"],
      ["a", "a"],
      [`a("b`, `a("b`],
      ["timeout AND", "timeout AND"],
      ["timeout AND status =", "timeout AND status ="],
      ["s.is_error timeout", "s.is_error timeout"],
    ])("%s gets only the Search text card", (raw, candidate) => {
      expect(suggestRecovery(raw, FIELDS, true)).toEqual({
        runSuggestion: null,
        freeTextCandidate: candidate,
      });
    });

    it.each([["levl='error'"], ["levl='error' AND status ="], [""], ["   "], ["-- note"]])(
      "%s gets neither card",
      (raw) => {
        expect(suggestRecovery(raw, FIELDS, true)).toEqual({
          runSuggestion: null,
          freeTextCandidate: null,
        });
      },
    );

    it("never splits mid-expression into an invalid suggestion", () => {
      expect(suggestRecovery("a=1 timeout b=2", FIELDS, true).runSuggestion).toBeNull();
      expect(suggestRecovery("timeout level", FIELDS, true).runSuggestion).toBeNull();
    });
  });

  describe("streamTextTarget (§6.2)", () => {
    const utf8 = (name: string) => ({ name, type: "Utf8" });

    it("unions explicit keys and defaults, intersected with string schema fields", () => {
      const s = stream({
        schema: [utf8("message"), utf8("log"), utf8("custom"), { name: "data", type: "Int64" }],
        settings: { full_text_search_keys: ["custom", "missing"] },
      });
      expect(streamTextTarget(s, ["log", "message", "data"], undefined)).toEqual({
        mode: "fts",
        fields: ["custom", "log", "message"],
      });
      expect(streamTextTarget(s, [], undefined)).toEqual({ mode: "fts", fields: ["custom"] });
      expect(streamTextTarget(stream({ schema: [utf8("log")] }), ["log"], undefined)).toEqual({
        mode: "fts",
        fields: ["log"],
      });
    });

    it("accepts every backend string type and nothing else", () => {
      const s = stream({
        schema: [
          { name: "a_body", type: "Utf8View" },
          { name: "b_body", type: "LargeUtf8" },
          { name: "c_body", type: "Binary" },
        ],
      });
      expect(streamTextTarget(s, ["a_body", "b_body", "c_body"], undefined)).toEqual({
        mode: "fts",
        fields: ["a_body", "b_body"],
      });
    });

    it("blocks a stream whose only fts-named field is not a string (AC3.5)", () => {
      const s = stream({ schema: [{ name: "data", type: "Int64" }, utf8("msg_text")] });
      expect(streamTextTarget(s, ["data"], undefined)).toEqual({
        mode: "blocked",
        candidates: ["msg_text"],
      });
    });

    it("ignores UDS and reads the full schema", () => {
      const s = stream({
        schema: [utf8("body"), utf8("level")],
        settings: { defined_schema_fields: ["level"] } as StreamWithSchema["settings"],
      });
      expect(streamTextTarget(s, ["body"], undefined)).toEqual({ mode: "fts", fields: ["body"] });
    });

    it("blocks on empty default_fts_keys and no explicit keys", () => {
      const s = stream({ schema: [utf8("message")] });
      expect(streamTextTarget(s, [], undefined)).toEqual({
        mode: "blocked",
        candidates: ["message"],
      });
    });

    it("keeps _original and _all_values after removeSchemaFields strips them", () => {
      const { removeSchemaFields } = useStreams((i18nInstance.global as any).t);
      const original = removeSchemaFields({
        name: "s",
        schema: [
          utf8("_timestamp"),
          { name: "code", type: "Int64" },
          utf8("_original"),
          utf8("_o2_id"),
        ],
        settings: { index_original_data: true },
      });
      const allValues = removeSchemaFields({
        name: "s",
        schema: [utf8("_timestamp"), utf8("_all_values")],
        settings: { index_all_values: true },
      });
      expect(original.schema.map((f: { name: string }) => f.name)).toEqual(["_timestamp", "code"]);
      expect(streamTextTarget(original, [], undefined)).toEqual({
        mode: "fts",
        fields: ["_original"],
      });
      expect(streamTextTarget(allValues, [], undefined)).toEqual({
        mode: "fts",
        fields: ["_all_values"],
      });
      expect(
        renderPlan(
          planFilter("timeout", FIELDS),
          streamTextTarget(allValues, [], undefined),
          KNOWN,
        ),
      ).toBe("match_all('timeout')");
    });

    it("ranks scan candidates by name, excludes internal and search-time redacted fields", () => {
      const s = stream({
        schema: [
          utf8("host"),
          utf8("zz"),
          utf8("detail"),
          utf8("secret_msg"),
          utf8("both_text"),
          utf8("msg_text"),
          utf8("_stream_name"),
          utf8("column_all"),
          utf8("_timestamp"),
          { name: "count", type: "Int64" },
        ],
        settings: {
          pattern_associations: [
            { field: "secret_msg", apply_at: "AtSearch" },
            { field: "both_text", apply_at: "Both" },
            { field: "detail", apply_at: "AtIngestion" },
          ],
        },
      });
      expect(streamTextTarget(s, [], undefined)).toEqual({
        mode: "blocked",
        candidates: ["detail", "msg_text", "host", "zz"],
      });
    });

    it("re-validates consent against candidates and the field guard", () => {
      const s = stream({ schema: [utf8("msg_text"), utf8("detail"), utf8("host")] });
      expect(FREE_TEXT_SCAN_MAX_FIELDS).toBe(0);
      expect(streamTextTarget(s, [], ["msg_text"])).toEqual({
        mode: "blocked",
        candidates: ["msg_text", "detail", "host"],
      });
      expect(streamTextTarget(s, [], ["detail", "gone", "msg_text", "host"], 2)).toEqual({
        mode: "scan",
        fields: ["detail", "msg_text"],
      });
      expect(streamTextTarget(s, [], ["gone"], 3).mode).toBe("blocked");
      expect(streamTextTarget(s, [], "bad" as unknown as string[], 3).mode).toBe("blocked");
      expect(streamTextTarget(s, [], [1, null] as unknown as string[], 3).mode).toBe("blocked");
    });

    it("renders every schema variant as SQL text (L-24)", () => {
      const plan = planFilter("timeout", FIELDS, { targetMode: "scan" });
      const variants: Array<[string, StreamWithSchema, string | null]> = [
        ["fts", stream({ schema: [utf8("body")] }), "match_all('timeout')"],
        [
          "scan",
          stream({ schema: [utf8("msg_text")] }),
          `(("msg_text" IS NOT NULL AND str_match_ignore_case("msg_text", 'timeout')))`,
        ],
        ["blocked", stream({ schema: [utf8("msg_text")] }), null],
        ["no string fields", stream({ schema: [{ name: "n", type: "Int64" }] }), null],
      ];
      for (const [name, s, expected] of variants) {
        const consent = name === "scan" ? ["msg_text"] : undefined;
        const target = streamTextTarget(s, ["body"], consent, 3);
        expect({ name, sql: renderPlan(plan, target, KNOWN) }).toEqual({ name, sql: expected });
      }
    });
  });

  describe("materializeFreeText and appendConjunct (§6.4)", () => {
    const ftsCtx = ctxFor({ s: FTS, t: FTS });

    it("returns the predicate for an empty, blank or comment-only filter", () => {
      for (const filter of ["", "   ", "-- note", "/* c */", "-- a\n-- b\n"]) {
        expect(appendConjunct(filter, "level='error'", ["s"], ftsCtx)).toBe("level='error'");
      }
    });

    it("materialises free text and wraps the whole filter (AC6.9)", () => {
      expect(appendConjunct("timeout", "level='error'", ["s"], ftsCtx)).toBe(
        "(\nmatch_all('timeout')\n) AND level='error'",
      );
      expect(appendConjunct("timeout OR refused", "level='error'", ["s", "t"], ftsCtx)).toBe(
        "(\nmatch_all('timeout') OR match_all('refused')\n) AND level='error'",
      );
    });

    it("wraps a plain SQL filter so an inline comment cannot swallow the predicate", () => {
      expect(appendConjunct("status=500 -- note", "level='error'", ["s"], ftsCtx)).toBe(
        "(\nstatus=500 -- note\n) AND level='error'",
      );
      expect(materializeFreeText("status=500", ["s"], ftsCtx)).toBe("status=500");
    });

    it("materialises a single scan stream and marks provenance", () => {
      const ctx = ctxFor({ nofts: SCAN });
      expect(appendConjunct("timeout", "level='error'", ["nofts"], ctx)).toBe(
        '(\n(("msg_text" IS NOT NULL AND str_match_ignore_case("msg_text", \'timeout\')) OR ' +
          "(\"detail\" IS NOT NULL AND str_match_ignore_case(\"detail\", 'timeout')))\n) AND level='error'",
      );
      expect(ctx.freeTextScan?.nofts).toEqual({
        fields: ["msg_text", "detail"],
        materialized: true,
      });
    });

    it("appends as today when one rendering cannot serve every stream", () => {
      const ctx = ctxFor({ s: FTS, nofts: SCAN });
      expect(materializeFreeText("timeout", ["s", "nofts"], ctx)).toBeNull();
      expect(appendConjunct("timeout", "level='error'", ["s", "nofts"], ctx)).toBe(
        "timeout and level='error'",
      );
      expect(ctx.freeTextScan?.nofts.materialized).toBeUndefined();
      expect(materializeFreeText("timeout", ["blocked"], ctxFor({ blocked: BLOCKED }))).toBeNull();
      expect(materializeFreeText("timeout", [], ftsCtx)).toBeNull();
      expect(materializeFreeText("timeout", ["unknown"], ftsCtx)).toBeNull();
    });

    it("honours the token gate from the context", () => {
      const ctx = { ...ftsCtx, tokenLimits: { min: 8, max: 64 } };
      expect(appendConjunct("timeout", "level='error'", ["s"], ctx)).toBe(
        "(\ntimeout\n) AND level='error'",
      );
    });
  });

  describe("isAuthoredStatement and looksLikeSqlStatement", () => {
    const lookup = {
      hasStream: (name: string) => ["s", "cache"].includes(name),
      fieldsOf: (name: string) => (name === "s" ? new Set(["level", "msg"]) : new Set(["hits"])),
    };

    it.each([
      ['SELECT 1 FROM "s"'],
      ['SELECT _timestamp + 1 AS t FROM "s"'],
      ["WITH x AS (select * from s) SELECT * FROM x"],
      ['SELECT level msg FROM "s" WHERE ((('],
      ["-- note\nselect * from s"],
      ["/* c */ select level from s"],
      ["select count(*) from s"],
    ])("%s is an authored statement and flips", (raw) => {
      expect(isAuthoredStatement(raw)).toBe(true);
      expect(looksLikeSqlStatement(raw, lookup)).toBe(true);
      expect(looksLikeSqlStatement(raw)).toBe(true);
    });

    it("keeps sentence-shaped text and text that only contains select in filter mode", () => {
      expect(looksLikeSqlStatement("select messages from cache", lookup)).toBe(false);
      expect(isAuthoredStatement("selected from cache")).toBe(false);
      expect(looksLikeSqlStatement("selected from cache", lookup)).toBe(false);
      expect(isAuthoredStatement("msg='select'")).toBe(false);
      expect(looksLikeSqlStatement("msg='select' from", lookup)).toBe(false);
    });

    it("flips a select of real fields and needs an existing stream", () => {
      expect(looksLikeSqlStatement("select hits from cache", lookup)).toBe(true);
      expect(looksLikeSqlStatement("select level from s", lookup)).toBe(true);
      expect(looksLikeSqlStatement("select * from nowhere", lookup)).toBe(false);
      expect(looksLikeSqlStatement("select 1", lookup)).toBe(false);
    });

    it.each([
      ['WITH q AS (SELECT msg AS message FROM "s") SELECT message FROM q'],
      ['select message from (select msg as message from "s")'],
      ["select hits from s join cache on s.level = cache.hits"],
      ["select message from s union select hits from cache"],
    ])("flips %s, whose projected names are not the stream's own fields", (raw) => {
      expect(looksLikeSqlStatement(raw, lookup)).toBe(true);
    });
  });

  describe("round 2 regressions", () => {
    it("offers no phrase card when a valid predicate sits next to an incomplete segment (F1)", () => {
      for (const allFts of [true, false]) {
        expect(suggestRecovery("status=500 AND timeout AND level =", FIELDS, allFts)).toEqual({
          runSuggestion: null,
          freeTextCandidate: null,
        });
      }
      expect(suggestRecovery("service_name='api' timeout", FIELDS, false).freeTextCandidate).toBe(
        "service_name='api' timeout",
      );
    });

    it("keeps a quoted field value with spaces whole (F2)", () => {
      expect(suggestRecovery("service_name:'two words'", FIELDS, true).runSuggestion).toBe(
        "service_name='two words'",
      );
      expect(suggestRecovery('service_name:"two words" timeout', FIELDS, true).runSuggestion).toBe(
        "service_name='two words' AND match_all('timeout')",
      );
      expect(suggestRecovery("service_name:'it''s ok'", FIELDS, true).runSuggestion).toBe(
        "service_name='it''s ok'",
      );
      expect(planFilter("service_name:'two words'", FIELDS).kind).toBe("sql");
      expect(renderFts("ERR:'a b'")).toBe("match_all('ERR:''a b''')");
    });

    it("declines a field value whose quote never closes (F2)", () => {
      expect(suggestRecovery("service_name:'two words", FIELDS, true).runSuggestion).toBeNull();
      expect(suggestRecovery("service_name:'open timeout", FIELDS, true).runSuggestion).toBeNull();
    });

    it("finds FROM outside literals, comments and quoted identifiers (F3)", () => {
      const lookup = {
        hasStream: (name: string) => name === "s" || name === "my stream",
        fieldsOf: () => new Set(["level"]),
      };
      for (const raw of [
        "SELECT 'from nowhere' FROM s",
        "-- from nowhere\nSELECT * FROM s",
        "/* from nowhere */ select * from s",
        'SELECT "from nowhere" FROM s',
        'select * from "my stream"',
        "SELECT 'it''s from nowhere' FROM s",
      ]) {
        expect({ raw, flips: looksLikeSqlStatement(raw, lookup) }).toEqual({ raw, flips: true });
      }
      expect(looksLikeSqlStatement("SELECT * FROM nowhere -- from s", lookup)).toBe(false);
    });

    it("bounds deep NOT chains and parentheses without throwing (F4)", () => {
      const nots = `${"NOT ".repeat(10000)}timeout`;
      expect(planFilter(nots, FIELDS)).toEqual({ kind: "unclassified", filter: nots });
      expect(suggestRecovery(`${nots} AND status=500`, FIELDS, true)).toEqual({
        runSuggestion: null,
        freeTextCandidate: null,
      });
      const parens = `${"(".repeat(5000)}timeout${")".repeat(5000)}`;
      expect(planFilter(parens, FIELDS).kind).toBe("unclassified");
      expect(appendConjunct(nots, "level='x'", ["s"], ctxFor({ s: FTS }))).toBe(
        `(\n${nots}\n) AND level='x'`,
      );
    });

    it("still classifies nesting past SQL_PARSE_MAX_DEPTH but under the bound (F4)", () => {
      expect(renderFts(`${"NOT ".repeat(40)}timeout`)).toBe(
        `${"NOT ".repeat(40)}match_all('timeout')`,
      );
      const deep = `${"(".repeat(100)}timeout${")".repeat(100)}`;
      expect(renderFts(deep)).toBe(`${"(".repeat(100)}match_all('timeout')${")".repeat(100)}`);
    });
  });

  describe("round 3 regressions", () => {
    it("does not add up NOTs or groups across sibling operands (F4)", () => {
      const flatNots = Array(257).fill("NOT timeout").join(" OR ");
      expect(planFilter(flatNots, FIELDS).kind).toBe("freeText");
      expect(renderFts(flatNots)).toBe(Array(257).fill("NOT match_all('timeout')").join(" OR "));
      const flatGroups = Array(300).fill("(NOT timeout)").join(" AND ");
      expect(renderFts(flatGroups)).toBe(
        Array(300).fill("(NOT match_all('timeout'))").join(" AND "),
      );
      const closedThenNot = `${"(".repeat(200)}error${")".repeat(200)} ${"NOT ".repeat(200)}timeout`;
      expect(planFilter(closedThenNot, FIELDS).kind).toBe("freeText");
      expect(suggestRecovery(flatNots, FIELDS, true)).toEqual({
        runSuggestion: null,
        freeTextCandidate: flatNots,
      });
    });

    it("still bounds NOTs and groups that are open together (F4)", () => {
      const notGroups = `${"NOT (".repeat(128)}timeout${")".repeat(128)}`;
      expect(planFilter(notGroups, FIELDS).kind).toBe("freeText");
      const deeper = `${"NOT (".repeat(129)}timeout${")".repeat(129)}`;
      expect(planFilter(deeper, FIELDS)).toEqual({ kind: "unclassified", filter: deeper });
      const groupThenNots = `${"(".repeat(200)}${"NOT ".repeat(57)}timeout${")".repeat(200)}`;
      expect(planFilter(groupThenNots, FIELDS).kind).toBe("unclassified");
      const atBound = `${"(".repeat(200)}${"NOT ".repeat(56)}timeout${")".repeat(200)}`;
      expect(planFilter(atBound, FIELDS).kind).toBe("freeText");
    });
  });
});
