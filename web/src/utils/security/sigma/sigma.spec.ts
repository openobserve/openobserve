// Copyright 2026 OpenObserve Inc.
//
// The compiler's job is to preserve meaning, so these tests are mostly about
// meaning rather than string shape: what a rule matches, what it must not
// match, and what it refuses to guess at.

import { describe, expect, it } from "vitest";

import { compileSigmaRule } from "./compile";
import { expandPattern, parseCondition } from "./condition";
import { catalogErrors, rulesForLogsource, sigmaCatalog } from "./catalog";
import { matchesLogsource, parseSigmaRule, sigmaLevelToSeverity } from "./parse";
import { applicableRules, blockedReason, caveat } from "./index";
import { SOURCE_TYPE_BY_ID } from "../sourceTypes";

const rule = (body: string) => {
  const result = parseSigmaRule(body);
  if (!result.ok) throw new Error(`fixture failed to parse: ${result.error.message}`);
  return result.rule;
};

const compile = (body: string, options = {}) => compileSigmaRule(rule(body), options);

const RULE = (detection: string) => `title: Test
logsource:
  product: windows
detection:
${detection}`;

describe("parseSigmaRule", () => {
  it("reads a complete rule", () => {
    const parsed = rule(`title: Encoded PowerShell
id: 1234
status: stable
description: A thing
author: Someone
references:
  - https://example.com/a
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    Image|endswith: '\\powershell.exe'
  condition: selection
falsepositives:
  - Admin scripts
level: high
tags:
  - attack.execution
  - attack.t1059.001`);

    expect(parsed.title).toBe("Encoded PowerShell");
    expect(parsed.logsource).toMatchObject({ category: "process_creation", product: "windows" });
    expect(Object.keys(parsed.searches)).toEqual(["selection"]);
    expect(parsed.condition).toEqual(["selection"]);
    expect(parsed.level).toBe("high");
    expect(parsed.references).toEqual(["https://example.com/a"]);
  });

  it("separates ATT&CK techniques from tactics and group ids", () => {
    const parsed = rule(`title: T
logsource: {product: windows}
detection: {selection: {a: 1}, condition: selection}
tags:
  - attack.credential_access
  - attack.t1110
  - attack.t1078.004
  - attack.g0016
  - cve.2021-44228`);

    expect(parsed.techniques).toEqual(["T1110", "T1078.004"]);
    expect(parsed.tactics).toEqual(["credential_access"]);
  });

  it("normalises a single condition into a list", () => {
    expect(rule(RULE("  a: {x: 1}\n  condition: a")).condition).toEqual(["a"]);
    expect(
      rule(RULE("  a: {x: 1}\n  b: {y: 2}\n  condition:\n    - a\n    - b")).condition,
    ).toEqual(["a", "b"]);
  });

  it("reports a bad rule instead of dropping it", () => {
    const noCondition = parseSigmaRule(
      "title: T\nlogsource: {product: windows}\ndetection: {a: {x: 1}}",
    );
    expect(noCondition.ok).toBe(false);
    if (!noCondition.ok) expect(noCondition.error.message).toMatch(/condition/i);

    const notYaml = parseSigmaRule("title: [unclosed");
    expect(notYaml.ok).toBe(false);

    const noTitle = parseSigmaRule(
      "logsource: {product: windows}\ndetection: {a: {x: 1}, condition: a}",
    );
    expect(noTitle.ok).toBe(false);
    if (!noTitle.ok) expect(noTitle.error.message).toMatch(/title/i);
  });

  it("keeps the original text so a rule can be shown as written", () => {
    const text = RULE("  a: {x: 1}\n  condition: a");
    expect(rule(text).yaml).toBe(text);
  });

  it("maps the level onto the OCSF severity scale", () => {
    expect(sigmaLevelToSeverity("critical")).toBe(5);
    expect(sigmaLevelToSeverity("low")).toBe(2);
    // An untagged rule is treated as medium rather than as unknown, because a
    // detection with no severity still has to sort somewhere sensible.
    expect(sigmaLevelToSeverity(undefined)).toBe(3);
  });
});

describe("matchesLogsource", () => {
  const stream = { category: "process_creation", product: "windows" };

  it("matches when every part the rule states matches", () => {
    expect(matchesLogsource({ logsource: { category: "process_creation" } }, stream)).toBe(true);
    expect(matchesLogsource({ logsource: {} }, stream)).toBe(true);
    expect(
      matchesLogsource({ logsource: { category: "process_creation", product: "windows" } }, stream),
    ).toBe(true);
  });

  it("does not match when the rule states a part the stream contradicts", () => {
    expect(matchesLogsource({ logsource: { product: "linux" } }, stream)).toBe(false);
    // The rule asks for a service; this stream has none, so the rule was not
    // written for it.
    expect(matchesLogsource({ logsource: { service: "security" } }, stream)).toBe(false);
  });
});

describe("parseCondition", () => {
  it("binds and tighter than or", () => {
    const parsed = parseCondition("a and b or c");
    expect(parsed.node).toEqual({
      type: "or",
      operands: [
        {
          type: "and",
          operands: [
            { type: "identifier", name: "a" },
            { type: "identifier", name: "b" },
          ],
        },
        { type: "identifier", name: "c" },
      ],
    });
  });

  it("honours parentheses, which is the whole reason for a real parser", () => {
    const flat = parseCondition("sel and not f1 and not f2");
    const grouped = parseCondition("sel and not (f1 or f2)");
    expect(flat.node).not.toEqual(grouped.node);
    expect(grouped.node).toMatchObject({
      type: "and",
      operands: [{ type: "identifier" }, { type: "not", operand: { type: "or" } }],
    });
  });

  it("reads the quantifier forms", () => {
    expect(parseCondition("1 of selection_*").node).toEqual({
      type: "quantifier",
      count: 1,
      pattern: "selection_*",
    });
    expect(parseCondition("all of them").node).toEqual({
      type: "quantifier",
      count: "all",
      pattern: "*",
    });
    expect(parseCondition("2 of filter_*").node).toMatchObject({ count: 2 });
    expect(parseCondition("any of sel*").node).toMatchObject({ count: 1 });
  });

  it("names aggregation rather than pretending to handle it", () => {
    const parsed = parseCondition("selection | count() by TargetUserName > 5");
    expect(parsed.unsupported[0]).toMatch(/aggregation/);
    // The filter half still parses, so the caller can decide what to do with it.
    expect(parsed.node).toEqual({ type: "identifier", name: "selection" });
  });

  it("rejects malformed input with a reason", () => {
    expect(parseCondition("a and").error).toBeTruthy();
    expect(parseCondition("(a or b").error).toMatch(/parenthes/i);
    expect(parseCondition("a b").error).toBeTruthy();
  });
});

describe("expandPattern", () => {
  const names = ["selection_a", "selection_b", "filter_x", "keywords"];

  it("expands a prefix glob", () => {
    expect(expandPattern("selection_*", names)).toEqual(["selection_a", "selection_b"]);
  });

  it("expands them to everything", () => {
    expect(expandPattern("*", names)).toEqual(names);
  });
});

describe("compileSigmaRule", () => {
  it("compiles an exact match case-insensitively", () => {
    const { where, runnable } = compile(RULE("  s: {EventID: 4625}\n  condition: s"));
    expect(where).toBe(`"EventID" = 4625`);
    expect(runnable).toBe(true);
  });

  it("compares strings without regard to case, which is Sigma's default", () => {
    const { where } = compile(RULE("  s: {User: Administrator}\n  condition: s"));
    expect(where).toBe(`lower("User") = 'administrator'`);
  });

  it("does not wrap a numeric comparison in a string function", () => {
    // lower() on an integer column is a type error in DataFusion, so a rule
    // that compares a number must not go anywhere near it.
    const { where } = compile(RULE("  s: {LogonType: 3}\n  condition: s"));
    expect(where).not.toContain("lower");
  });

  it("turns a list into OR and the all modifier into AND", () => {
    const anyOf = compile(RULE("  s:\n    EventID: [4625, 4624]\n  condition: s"));
    expect(anyOf.where).toBe(`("EventID" = 4625 OR "EventID" = 4624)`);

    const allOf = compile(
      RULE("  s:\n    CommandLine|contains|all: ['delete', 'shadows']\n  condition: s"),
    );
    expect(allOf.where).toBe(
      `(lower("CommandLine") LIKE '%delete%' AND lower("CommandLine") LIKE '%shadows%')`,
    );
  });

  it("ANDs the entries of one map", () => {
    const { where } = compile(RULE("  s: {EventID: 4625, LogonType: 3}\n  condition: s"));
    expect(where).toBe(`("EventID" = 4625 AND "LogonType" = 3)`);
  });

  it("ORs a list of maps", () => {
    const { where } = compile(
      RULE("  s:\n    - {EventID: 4625}\n    - {EventID: 4740}\n  condition: s"),
    );
    expect(where).toBe(`("EventID" = 4625 OR "EventID" = 4740)`);
  });

  it("compiles the string modifiers to the right side of the wildcard", () => {
    const contains = compile(RULE("  s: {CommandLine|contains: enc}\n  condition: s"));
    expect(contains.where).toBe(`lower("CommandLine") LIKE '%enc%'`);

    // A literal backslash has to be doubled: arrow's LIKE kernel treats `\` as
    // the escape character and drops it before a non-wildcard, so a single `\U`
    // would match a bare "U" and the Windows path rules would all silently miss.
    const starts = compile(RULE("  s: {Image|startswith: 'C:\\Users'}\n  condition: s"));
    expect(starts.where).toBe(`lower("Image") LIKE 'c:\\\\users%'`);

    const ends = compile(RULE("  s: {Image|endswith: '\\cmd.exe'}\n  condition: s"));
    expect(ends.where).toBe(`lower("Image") LIKE '%\\\\cmd.exe'`);
  });

  it("translates Sigma wildcards into LIKE wildcards", () => {
    const { where } = compile(RULE("  s: {path: '/api/*/admin'}\n  condition: s"));
    expect(where).toBe(`lower("path") LIKE '/api/%/admin'`);

    const single = compile(RULE("  s: {code: 'HTTP?'}\n  condition: s"));
    expect(single.where).toBe(`lower("code") LIKE 'http_'`);
  });

  it("escapes LIKE metacharacters that appear literally in a value", () => {
    // A percent sign in a URL is a literal, not "match anything".
    const { where } = compile(RULE("  s: {path|contains: '%2e%2e/'}\n  condition: s"));
    expect(where).toBe(`lower("path") LIKE '%\\%2e\\%2e/%'`);
  });

  it("treats an escaped Sigma wildcard as a literal character", () => {
    const { where } = compile(RULE("  s: {q: 'a\\*b'}\n  condition: s"));
    // No wildcard survived, so this is an equality test, not a LIKE.
    expect(where).toBe(`lower("q") = 'a*b'`);
  });

  it("escapes a quote rather than ending the literal", () => {
    const { where } = compile(RULE(`  s: {c-uri|contains: "' or '1'='1"}\n  condition: s`));
    expect(where).toBe(`lower("c-uri") LIKE '%'' or ''1''=''1%'`);
  });

  it("compiles null and exists to the null tests", () => {
    expect(compile(RULE("  s: {User: null}\n  condition: s")).where).toBe(`"User" IS NULL`);
    expect(compile(RULE("  s: {User|exists: true}\n  condition: s")).where).toBe(
      `"User" IS NOT NULL`,
    );
    expect(compile(RULE("  s: {User|exists: false}\n  condition: s")).where).toBe(`"User" IS NULL`);
  });

  it("compiles the numeric comparisons", () => {
    expect(compile(RULE("  s: {status|gte: 500}\n  condition: s")).where).toBe(`"status" >= 500`);
    expect(compile(RULE("  s: {count|lt: 3}\n  condition: s")).where).toBe(`"count" < 3`);
  });

  it("compiles a regex, with the case-insensitive flag inline", () => {
    expect(compile(RULE("  s: {query|re: '^[a-z]{40,}'}\n  condition: s")).where).toBe(
      `re_match("query", '^[a-z]{40,}')`,
    );
    expect(compile(RULE("  s: {query|re|i: 'admin'}\n  condition: s")).where).toBe(
      `re_match("query", '(?i)admin')`,
    );
  });

  it("compiles byte-aligned CIDR to a prefix and refuses the rest", () => {
    const aligned = compile(RULE("  s: {src_ip|cidr: '10.0.0.0/8'}\n  condition: s"));
    expect(aligned.where).toBe(`"src_ip" LIKE '10.%'`);
    expect(aligned.runnable).toBe(true);

    // A /26 is not a text prefix, and approximating it would silently widen or
    // narrow the rule.
    const odd = compile(RULE("  s: {src_ip|cidr: '10.0.0.0/26'}\n  condition: s"));
    expect(odd.runnable).toBe(false);
    expect(odd.unsupported[0]).toMatch(/cidr/);
  });

  it("expands windash into the dash forms Windows accepts", () => {
    const { where } = compile(
      RULE("  s: {CommandLine|windash|contains: ' -enc '}\n  condition: s"),
    );
    expect(where).toContain(`lower("CommandLine") LIKE '% -enc %'`);
    expect(where).toContain(`lower("CommandLine") LIKE '% /enc %'`);
    expect(where).toContain("–"); // en dash, which is the point of the modifier
  });

  it("negates through COALESCE so a null column does not swallow the row", () => {
    const { where } = compile(RULE("  s: {a: 1}\n  f: {b: 2}\n  condition: s and not f"));
    expect(where).toBe(`("a" = 1 AND NOT COALESCE("b" = 2, false))`);
  });

  it("compiles 1 of, all of, and N of", () => {
    const body = "  sel_a: {a: 1}\n  sel_b: {b: 2}\n  sel_c: {c: 3}\n  condition: ";
    expect(compile(RULE(`${body}1 of sel_*`)).where).toBe(`("a" = 1 OR "b" = 2 OR "c" = 3)`);
    expect(compile(RULE(`${body}all of them`)).where).toBe(`("a" = 1 AND "b" = 2 AND "c" = 3)`);
    expect(compile(RULE(`${body}2 of sel_*`)).where).toBe(
      `(CASE WHEN "a" = 1 THEN 1 ELSE 0 END + CASE WHEN "b" = 2 THEN 1 ELSE 0 END + CASE WHEN "c" = 3 THEN 1 ELSE 0 END) >= 2`,
    );
  });

  it("ORs a rule that carries several conditions", () => {
    const { where } = compile(RULE("  a: {x: 1}\n  b: {y: 2}\n  condition:\n    - a\n    - b"));
    expect(where).toBe(`("x" = 1 OR "y" = 2)`);
  });

  it("searches the configured full-text columns for a keyword rule", () => {
    const { where, runnable } = compile(
      `title: T\nlogsource: {product: linux}\ndetection:\n  keywords:\n    - 'Failed password for'\n  condition: keywords`,
      { keywordFields: ["message"], availableFields: ["message"] },
    );
    expect(where).toBe(`lower("message") LIKE '%failed password for%'`);
    expect(runnable).toBe(true);
  });

  it("refuses a keyword rule when the stream has no text column to search", () => {
    const compiled = compile(
      `title: T\nlogsource: {product: linux}\ndetection:\n  keywords: ['boom']\n  condition: keywords`,
      { keywordFields: [], availableFields: ["a"] },
    );
    expect(compiled.runnable).toBe(false);
    expect(blockedReason(compiled)).toMatch(/full-text/);
  });

  it("maps a Sigma field name onto the column the stream actually uses", () => {
    const { where, fields } = compile(RULE("  s: {c-uri|contains: '../'}\n  condition: s"), {
      fieldMap: { "c-uri": "path" },
      availableFields: ["path", "status"],
    });
    expect(where).toBe(`lower("path") LIKE '%../%'`);
    expect(fields).toEqual(["path"]);
  });

  it("matches a column that differs only in case", () => {
    const { where } = compile(RULE("  s: {eventid: 4625}\n  condition: s"), {
      availableFields: ["EventID"],
    });
    expect(where).toBe(`"EventID" = 4625`);
  });

  it("targets the column ingest produced, not the one the rule was written against", () => {
    // Nested keys are flattened and lower-cased on the way in, so a rule that
    // says userIdentity.type has to compile to useridentity_type. Getting this
    // wrong is not a miss, it is a query error against a column that is not there.
    const { where, runnable } = compile(RULE("  s: {userIdentity.type: Root}\n  condition: s"), {
      availableFields: ["eventname", "useridentity_type"],
    });
    expect(where).toBe(`lower("useridentity_type") = 'root'`);
    expect(runnable).toBe(true);
  });

  it("reports a rule that cannot fire here rather than running a query that errors", () => {
    // An unknown column is a query error in DataFusion, not a row that fails to
    // match. The whole selection folds to false, so the rule is incapable of
    // firing against this stream and says so.
    const compiled = compile(RULE("  s: {CommandLine|contains: enc}\n  condition: s"), {
      availableFields: ["EventID", "Computer"],
    });
    expect(compiled.runnable).toBe(false);
    expect(compiled.assumedAbsent).toEqual(["CommandLine"]);
    expect(blockedReason(compiled)).toBe("Cannot match: this stream has no CommandLine");
  });

  it("keeps a rule whose optional filter names a field the stream never emits", () => {
    // The filter exists to suppress SSO logins. A stream with no SSO has no such
    // column, which means the filter excludes nothing, which means the rule is
    // still exactly right. Discarding it here would lose a real detection.
    const compiled = compile(
      RULE(
        "  s: {eventName: ConsoleLogin}\n  f: {SamlProviderArn|exists: true}\n  condition: s and not f",
      ),
      { availableFields: ["eventName"] },
    );
    expect(compiled.runnable).toBe(true);
    expect(compiled.where).toBe(`lower("eventName") = 'consolelogin'`);
    expect(compiled.assumedAbsent).toEqual(["SamlProviderArn"]);
    expect(caveat(compiled)).toMatch(/SamlProviderArn/);
  });

  it("folds an absent field to the truth value it actually has", () => {
    const present = compile(RULE("  s: {a: 1, gone|exists: false}\n  condition: s"), {
      availableFields: ["a"],
    });
    // exists:false on a column that does not exist is true for every row, so it
    // drops out of the AND rather than killing it.
    expect(present.where).toBe(`"a" = 1`);
    expect(present.runnable).toBe(true);

    const orBranch = compile(RULE("  s:\n    - {a: 1}\n    - {gone: 2}\n  condition: s"), {
      availableFields: ["a"],
    });
    // The absent branch is false everywhere, so the OR keeps only the live one.
    expect(orBranch.where).toBe(`"a" = 1`);
  });

  it("refuses an unknown modifier by name instead of ignoring it", () => {
    const compiled = compile(
      RULE("  s: {CommandLine|base64offset|contains: whoami}\n  condition: s"),
    );
    expect(compiled.runnable).toBe(false);
    expect(compiled.unsupported).toContain("modifier: base64offset");
  });

  it("refuses an aggregation rule rather than running its filter half alone", () => {
    const compiled = compile(
      RULE("  s: {EventID: 4625}\n  condition: s | count() by TargetUserName > 5"),
    );
    // The predicate is still there for a caller that wants to build the
    // aggregate itself, but the rule is not runnable as a plain search.
    expect(compiled.where).toBe(`"EventID" = 4625`);
    expect(compiled.runnable).toBe(false);
    expect(compiled.unsupported[0]).toMatch(/aggregation/);
  });

  it("reports a condition that names an undefined search", () => {
    const compiled = compile(RULE("  s: {a: 1}\n  condition: s and missing"));
    expect(compiled.runnable).toBe(false);
    expect(compiled.error).toMatch(/missing/);
  });

  it("quotes an identifier containing a dot, which is how nested fields arrive", () => {
    const { where } = compile(RULE("  s: {userIdentity.type: Root}\n  condition: s"));
    expect(where).toBe(`lower("userIdentity.type") = 'root'`);
  });
});

describe("the shipped catalog", () => {
  it("parses every rule it ships", () => {
    expect(catalogErrors()).toEqual([]);
    expect(sigmaCatalog().length).toBeGreaterThan(30);
  });

  it("gives every rule an id, a level and an ATT&CK technique", () => {
    for (const entry of sigmaCatalog()) {
      expect(entry.id, entry.title).toBeTruthy();
      expect(entry.level, entry.title).toBeTruthy();
      expect(entry.techniques.length, entry.title).toBeGreaterThan(0);
    }
  });

  it("does not ship two rules with the same id", () => {
    const ids = sigmaCatalog().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every security source the classifier can recognise", () => {
    // A source that classifies but has no content is a dead end for the analyst:
    // the page says it knows what the stream is and then offers nothing.
    const uncovered = [...SOURCE_TYPE_BY_ID.values()]
      .filter((source) => !source.telemetryOnly)
      .filter((source) => !rulesForLogsource(source.sigma).length)
      .map((source) => source.id);

    expect(uncovered).toEqual([]);
  });
});

describe("applicableRules", () => {
  const cloudtrailFields = [
    "eventTime",
    "eventName",
    "eventSource",
    "userIdentity.type",
    "eventType",
    "errorCode",
    "responseElements.ConsoleLogin",
    "additionalEventData.MFAUsed",
    "additionalEventData.SamlProviderArn",
    "requestParameters",
  ];

  it("compiles the rules for a stream against its real columns", () => {
    const source = SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!;
    const applicable = applicableRules(source, cloudtrailFields);

    expect(applicable.length).toBeGreaterThan(4);
    const rootActivity = applicable.find((entry) => entry.rule.title.includes("Root Account"))!;
    expect(rootActivity.compiled.runnable).toBe(true);
    expect(rootActivity.compiled.where).toContain(`lower("userIdentity.type") = 'root'`);
  });

  it("puts the runnable rules first, most severe first within them", () => {
    const source = SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!;
    const applicable = applicableRules(source, cloudtrailFields);
    const runnable = applicable.map((entry) => entry.compiled.runnable);

    expect(
      runnable.indexOf(false) === -1 || runnable.lastIndexOf(true) < runnable.indexOf(false),
    ).toBe(true);
  });

  it("marks a rule unrunnable when the stream is missing what it needs", () => {
    const source = SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!;
    // A stream with only the two required CloudTrail fields cannot run the rules
    // that look at the identity or the response.
    const applicable = applicableRules(source, ["eventName", "eventSource"]);
    const blocked = applicable.filter((entry) => !entry.compiled.runnable);

    expect(blocked.length).toBeGreaterThan(0);
    for (const entry of blocked) expect(blockedReason(entry.compiled)).toBeTruthy();
  });

  it("runs a keyword rule against a syslog stream's message column", () => {
    const source = SOURCE_TYPE_BY_ID.get("linux_auth")!;
    const applicable = applicableRules(source, ["message", "program", "hostname"]);
    const sshFailure = applicable.find((entry) => entry.rule.title.includes("SSH Authentication"))!;

    expect(sshFailure.compiled.runnable).toBe(true);
    expect(sshFailure.compiled.where).toContain(`lower("message") LIKE '%failed password for%'`);
  });

  it("uses the field map for a web server stream that spells things its own way", () => {
    const source = SOURCE_TYPE_BY_ID.get("webserver_access")!;
    const applicable = applicableRules(source, ["path", "method", "status", "remote_addr"]);
    const traversal = applicable.find((entry) => entry.rule.title.includes("Path Traversal"))!;

    expect(traversal.compiled.runnable).toBe(true);
    expect(traversal.compiled.where).toContain(`lower("path")`);
  });
});
