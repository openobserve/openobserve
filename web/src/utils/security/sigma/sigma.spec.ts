// Copyright 2026 OpenObserve Inc.

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
    // Medium, not unknown: an untagged detection still has to sort somewhere sensible.
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
    expect(where).toBe(`TRY_CAST("EventID" AS DOUBLE) = 4625`);
    expect(runnable).toBe(true);
  });

  it("compares strings without regard to case, which is Sigma's default", () => {
    const { where } = compile(RULE("  s: {User: Administrator}\n  condition: s"));
    expect(where).toBe(`lower(CAST("User" AS VARCHAR)) = 'administrator'`);
  });

  it("reads a quoted value against an integer-typed field as text", () => {
    const { where } = compile(RULE("  s: {EventID: '4625'}\n  condition: s"), {
      availableFields: ["EventID"],
    });
    expect(where).toBe(`lower(CAST("EventID" AS VARCHAR)) = '4625'`);
  });

  it("does not wrap a numeric comparison in a string function", () => {
    // lower() on an integer column is a type error in DataFusion.
    const { where } = compile(RULE("  s: {LogonType: 3}\n  condition: s"));
    expect(where).not.toContain("lower");
  });

  it("turns a list into OR and the all modifier into AND", () => {
    const anyOf = compile(RULE("  s:\n    EventID: [4625, 4624]\n  condition: s"));
    expect(anyOf.where).toBe(
      `(TRY_CAST("EventID" AS DOUBLE) = 4625 OR TRY_CAST("EventID" AS DOUBLE) = 4624)`,
    );

    const allOf = compile(
      RULE("  s:\n    CommandLine|contains|all: ['delete', 'shadows']\n  condition: s"),
    );
    expect(allOf.where).toBe(
      `(lower(CAST("CommandLine" AS VARCHAR)) LIKE '%delete%' AND lower(CAST("CommandLine" AS VARCHAR)) LIKE '%shadows%')`,
    );
  });

  it("ANDs the entries of one map", () => {
    const { where } = compile(RULE("  s: {EventID: 4625, LogonType: 3}\n  condition: s"));
    expect(where).toBe(
      `(TRY_CAST("EventID" AS DOUBLE) = 4625 AND TRY_CAST("LogonType" AS DOUBLE) = 3)`,
    );
  });

  it("ORs a list of maps", () => {
    const { where } = compile(
      RULE("  s:\n    - {EventID: 4625}\n    - {EventID: 4740}\n  condition: s"),
    );
    expect(where).toBe(
      `(TRY_CAST("EventID" AS DOUBLE) = 4625 OR TRY_CAST("EventID" AS DOUBLE) = 4740)`,
    );
  });

  it("compiles the string modifiers to the right side of the wildcard", () => {
    const contains = compile(RULE("  s: {CommandLine|contains: enc}\n  condition: s"));
    expect(contains.where).toBe(`lower(CAST("CommandLine" AS VARCHAR)) LIKE '%enc%'`);

    // arrow's LIKE kernel drops a lone `\` before a non-wildcard, so `\U` would match a bare "U".
    const starts = compile(RULE("  s: {Image|startswith: 'C:\\Users'}\n  condition: s"));
    expect(starts.where).toBe(`lower(CAST("Image" AS VARCHAR)) LIKE 'c:\\\\users%'`);

    const ends = compile(RULE("  s: {Image|endswith: '\\cmd.exe'}\n  condition: s"));
    expect(ends.where).toBe(`lower(CAST("Image" AS VARCHAR)) LIKE '%\\\\cmd.exe'`);
  });

  it("translates Sigma wildcards into LIKE wildcards", () => {
    const { where } = compile(RULE("  s: {path: '/api/*/admin'}\n  condition: s"));
    expect(where).toBe(`lower(CAST("path" AS VARCHAR)) LIKE '/api/%/admin'`);

    const single = compile(RULE("  s: {code: 'HTTP?'}\n  condition: s"));
    expect(single.where).toBe(`lower(CAST("code" AS VARCHAR)) LIKE 'http_'`);
  });

  it("escapes LIKE metacharacters that appear literally in a value", () => {
    // A percent sign in a URL is a literal, not "match anything".
    const { where } = compile(RULE("  s: {path|contains: '%2e%2e/'}\n  condition: s"));
    expect(where).toBe(`lower(CAST("path" AS VARCHAR)) LIKE '%\\%2e\\%2e/%'`);
  });

  it("treats an escaped Sigma wildcard as a literal character", () => {
    const { where } = compile(RULE("  s: {q: 'a\\*b'}\n  condition: s"));
    // No wildcard survived, so this is an equality test, not a LIKE.
    expect(where).toBe(`lower(CAST("q" AS VARCHAR)) = 'a*b'`);
  });

  it("escapes a quote rather than ending the literal", () => {
    const { where } = compile(RULE(`  s: {c-uri|contains: "' or '1'='1"}\n  condition: s`));
    expect(where).toBe(`lower(CAST("c-uri" AS VARCHAR)) LIKE '%'' or ''1''=''1%'`);
  });

  it("compiles null and exists to the null tests", () => {
    expect(compile(RULE("  s: {User: null}\n  condition: s")).where).toBe(`"User" IS NULL`);
    expect(compile(RULE("  s: {User|exists: true}\n  condition: s")).where).toBe(
      `"User" IS NOT NULL`,
    );
    expect(compile(RULE("  s: {User|exists: false}\n  condition: s")).where).toBe(`"User" IS NULL`);
  });

  it("compiles the numeric comparisons", () => {
    expect(compile(RULE("  s: {status|gte: 500}\n  condition: s")).where).toBe(
      `TRY_CAST("status" AS DOUBLE) >= 500`,
    );
    expect(compile(RULE("  s: {count|lt: 3}\n  condition: s")).where).toBe(
      `TRY_CAST("count" AS DOUBLE) < 3`,
    );
  });

  it("compiles a regex, with the case-insensitive flag inline", () => {
    expect(compile(RULE("  s: {query|re: '^[a-z]{40,}'}\n  condition: s")).where).toBe(
      `re_match(CAST("query" AS VARCHAR), '^[a-z]{40,}')`,
    );
    expect(compile(RULE("  s: {query|re|i: 'admin'}\n  condition: s")).where).toBe(
      `re_match(CAST("query" AS VARCHAR), '(?i)admin')`,
    );
  });

  it("refuses a regex using lookaround or a backreference", () => {
    for (const pattern of ["'foo(?=bar)'", "'(?<!x)y'", "'(a)\\1'"]) {
      const compiled = compile(RULE(`  s: {query|re: ${pattern}}\n  condition: s`));
      expect(compiled.runnable).toBe(false);
      expect(compiled.unsupported[0]).toMatch(/^re: lookaround or backreference/);
    }
  });

  it("compiles IPv4 CIDR exactly, including masks inside an octet", () => {
    const octet = "(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
    const shape = `re_match(CAST("src_ip" AS VARCHAR), '^${octet}(\\.${octet}){3}$')`;
    const aligned = compile(RULE("  s: {src_ip|cidr: '10.0.0.0/8'}\n  condition: s"));
    expect(aligned.where).toBe(`(${shape} AND CAST("src_ip" AS VARCHAR) LIKE '10.%')`);
    expect(aligned.runnable).toBe(true);

    expect(compile(RULE("  s: {src_ip|cidr: '10.1.2.3/32'}\n  condition: s")).where).toBe(
      `CAST("src_ip" AS VARCHAR) = '10.1.2.3'`,
    );
    // Any IPv4 address, and nothing that is not one.
    expect(compile(RULE("  s: {src_ip|cidr: '0.0.0.0/0'}\n  condition: s")).where).toBe(shape);

    // A /17 keeps two octets and splits the third: 128..255.
    expect(compile(RULE("  s: {src_ip|cidr: '40.108.128.0/17'}\n  condition: s")).where).toBe(
      `(${shape} AND CAST("src_ip" AS VARCHAR) LIKE '40.108.%' AND TRY_CAST(split_part(CAST("src_ip" AS VARCHAR), '.', 3) AS INT) BETWEEN 128 AND 255)`,
    );
    // A /26 inside the last octet: 64..127.
    expect(compile(RULE("  s: {src_ip|cidr: '10.0.0.64/26'}\n  condition: s")).where).toBe(
      `(${shape} AND CAST("src_ip" AS VARCHAR) LIKE '10.0.0.%' AND TRY_CAST(split_part(CAST("src_ip" AS VARCHAR), '.', 4) AS INT) BETWEEN 64 AND 127)`,
    );
  });

  it("rejects event addresses whose octets exceed 255", () => {
    const { where } = compile(RULE("  s: {src_ip|cidr: '10.0.0.0/8'}\n  condition: s"));
    const pattern = where.match(/re_match\(CAST\("src_ip" AS VARCHAR\), '([^']+)'\)/)?.[1];
    expect(pattern).toBeDefined();
    const shape = new RegExp(pattern!);
    expect(shape.test("10.1.2.3")).toBe(true);
    expect(shape.test("10.255.250.0")).toBe(true);
    expect(shape.test("10.999.999.999")).toBe(false);
    expect(shape.test("10.0.0.256")).toBe(false);
  });

  it("refuses IPv6 and malformed CIDR rather than approximating", () => {
    for (const block of ["2603:1006:2000::/48", "10.0.0/8", "300.0.0.0/8", "10.0.0.0/33"]) {
      const compiled = compile(RULE(`  s: {src_ip|cidr: '${block}'}\n  condition: s`));
      expect(compiled.runnable).toBe(false);
      expect(compiled.unsupported[0]).toMatch(/cidr/);
    }
  });

  it("compiles fieldref as equality between two columns", () => {
    const { where, runnable } = compile(
      RULE("  s: {TargetUserName|fieldref: SubjectUserName}\n  condition: s"),
    );
    expect(runnable).toBe(true);
    expect(where).toBe(`CAST("TargetUserName" AS VARCHAR) = CAST("SubjectUserName" AS VARCHAR)`);
  });

  it("compiles base64offset|contains to pySigma's three encodings", () => {
    const { where, runnable } = compile(
      RULE("  s: {CommandLine|base64offset|contains: /bin/bash}\n  condition: s"),
    );
    expect(runnable).toBe(true);
    // The values pySigma produces for the same input.
    for (const variant of ["L2Jpbi9iYXNo", "9iaW4vYmFza", "vYmluL2Jhc2"]) {
      expect(where).toContain(`CAST("CommandLine" AS VARCHAR) LIKE '%${variant}%'`);
    }
  });

  it("expands windash into the dash forms Windows accepts", () => {
    const { where } = compile(
      RULE("  s: {CommandLine|windash|contains: ' -enc '}\n  condition: s"),
    );
    expect(where).toContain(`lower(CAST("CommandLine" AS VARCHAR)) LIKE '% -enc %'`);
    expect(where).toContain(`lower(CAST("CommandLine" AS VARCHAR)) LIKE '% /enc %'`);
    expect(where).toContain("–"); // en dash, which is the point of the modifier
  });

  it("replaces every flag dash in a windash value with the same dash", () => {
    const { where } = compile(
      RULE("  s: {CommandLine|windash|contains: ' -nop -enc '}\n  condition: s"),
    );
    expect(where).toContain(`lower(CAST("CommandLine" AS VARCHAR)) LIKE '% -nop -enc %'`);
    expect(where).toContain(`lower(CAST("CommandLine" AS VARCHAR)) LIKE '% /nop /enc %'`);
    expect(where).toContain(`lower(CAST("CommandLine" AS VARCHAR)) LIKE '% –nop –enc %'`);
    expect(where).not.toContain(`/nop -enc`);
  });

  it("negates through COALESCE so a null column does not swallow the row", () => {
    const { where } = compile(RULE("  s: {a: 1}\n  f: {b: 2}\n  condition: s and not f"));
    expect(where).toBe(
      `(TRY_CAST("a" AS DOUBLE) = 1 AND NOT COALESCE(TRY_CAST("b" AS DOUBLE) = 2, false))`,
    );
  });

  it("compiles 1 of, all of, and N of", () => {
    const body = "  sel_a: {a: 1}\n  sel_b: {b: 2}\n  sel_c: {c: 3}\n  condition: ";
    expect(compile(RULE(`${body}1 of sel_*`)).where).toBe(
      `(TRY_CAST("a" AS DOUBLE) = 1 OR TRY_CAST("b" AS DOUBLE) = 2 OR TRY_CAST("c" AS DOUBLE) = 3)`,
    );
    expect(compile(RULE(`${body}all of them`)).where).toBe(
      `(TRY_CAST("a" AS DOUBLE) = 1 AND TRY_CAST("b" AS DOUBLE) = 2 AND TRY_CAST("c" AS DOUBLE) = 3)`,
    );
    expect(compile(RULE(`${body}2 of sel_*`)).where).toBe(
      `(CASE WHEN TRY_CAST("a" AS DOUBLE) = 1 THEN 1 ELSE 0 END + CASE WHEN TRY_CAST("b" AS DOUBLE) = 2 THEN 1 ELSE 0 END + CASE WHEN TRY_CAST("c" AS DOUBLE) = 3 THEN 1 ELSE 0 END) >= 2`,
    );
  });

  it("ORs a rule that carries several conditions", () => {
    const { where } = compile(RULE("  a: {x: 1}\n  b: {y: 2}\n  condition:\n    - a\n    - b"));
    expect(where).toBe(`(TRY_CAST("x" AS DOUBLE) = 1 OR TRY_CAST("y" AS DOUBLE) = 2)`);
  });

  it("searches the configured full-text columns for a keyword rule", () => {
    const { where, runnable } = compile(
      `title: T\nlogsource: {product: linux}\ndetection:\n  keywords:\n    - 'Failed password for'\n  condition: keywords`,
      { keywordFields: ["message"], availableFields: ["message"] },
    );
    expect(where).toBe(`lower(CAST("message" AS VARCHAR)) LIKE '%failed password for%'`);
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
    expect(where).toBe(`lower(CAST("path" AS VARCHAR)) LIKE '%../%'`);
    expect(fields).toEqual(["path"]);
  });

  it("matches a column that differs only in case", () => {
    const { where } = compile(RULE("  s: {eventid: 4625}\n  condition: s"), {
      availableFields: ["EventID"],
    });
    expect(where).toBe(`TRY_CAST("EventID" AS DOUBLE) = 4625`);
  });

  it("targets the column ingest produced, not the one the rule was written against", () => {
    // Nested keys are flattened and lower-cased at ingest, so userIdentity.type must become useridentity_type.
    const { where, runnable } = compile(RULE("  s: {userIdentity.type: Root}\n  condition: s"), {
      availableFields: ["eventname", "useridentity_type"],
    });
    expect(where).toBe(`lower(CAST("useridentity_type" AS VARCHAR)) = 'root'`);
    expect(runnable).toBe(true);
  });

  it("reports a rule that cannot fire here rather than running a query that errors", () => {
    // An unknown column is a query error in DataFusion, not a non-match, so the selection folds to false.
    const compiled = compile(RULE("  s: {CommandLine|contains: enc}\n  condition: s"), {
      availableFields: ["EventID", "Computer"],
    });
    expect(compiled.runnable).toBe(false);
    expect(compiled.assumedAbsent).toEqual(["CommandLine"]);
    expect(blockedReason(compiled)).toBe("Cannot match: this stream has no CommandLine");
  });

  it("refuses a rule whose exclusion names a field the stream lacks", () => {
    // Folded away, the filter would exclude nothing and the rule would fire on the rows it meant to skip.
    const compiled = compile(
      RULE("  s: {eventName: ConsoleLogin}\n  f: {SamlProviderArn: x}\n  condition: s and not f"),
      { availableFields: ["eventName"] },
    );
    expect(compiled.runnable).toBe(false);
    expect(compiled.unsupported).toEqual([
      "not over absent field 'SamlProviderArn': cannot prove the exclusion",
    ]);
    expect(blockedReason(compiled)).toMatch(/not over absent field 'SamlProviderArn'/);
  });

  it("refuses an absent field under a negated quantifier, but not under a double negation", () => {
    const quantified = compile(
      RULE("  s: {a: 1}\n  filter_x: {gone: x}\n  condition: s and not 1 of filter_*"),
      { availableFields: ["a"] },
    );
    expect(quantified.runnable).toBe(false);
    expect(quantified.unsupported).toEqual([
      "not over absent field 'gone': cannot prove the exclusion",
    ]);
    const doubled = compile(RULE("  s: {a: 1}\n  f: {gone: x}\n  condition: s or not not f"), {
      availableFields: ["a"],
    });
    expect(doubled.unsupported).toEqual([]);
    expect(doubled.runnable).toBe(true);
  });

  it("still folds an absent field in a positive selection to false", () => {
    const compiled = compile(RULE("  s: {a: 1}\n  t: {gone: x}\n  condition: s or t"), {
      availableFields: ["a"],
    });
    expect(compiled.runnable).toBe(true);
    expect(compiled.where).toBe(`TRY_CAST("a" AS DOUBLE) = 1`);
    expect(compiled.unsupported).toEqual([]);
    expect(compiled.assumedAbsent).toEqual(["gone"]);
    expect(caveat(compiled)).toMatch(/gone/);
  });

  it("folds an absent field to the truth value it actually has", () => {
    const present = compile(RULE("  s: {a: 1, gone|exists: false}\n  condition: s"), {
      availableFields: ["a"],
    });
    // exists:false on an absent column is true for every row, so it drops out of the AND.
    expect(present.where).toBe(`TRY_CAST("a" AS DOUBLE) = 1`);
    expect(present.runnable).toBe(true);

    const orBranch = compile(RULE("  s:\n    - {a: 1}\n    - {gone: 2}\n  condition: s"), {
      availableFields: ["a"],
    });
    // The absent branch is false everywhere, so the OR keeps only the live one.
    expect(orBranch.where).toBe(`TRY_CAST("a" AS DOUBLE) = 1`);
  });

  it("refuses an unknown modifier by name instead of ignoring it", () => {
    const compiled = compile(RULE("  s: {CommandLine|utf16le|contains: whoami}\n  condition: s"));
    expect(compiled.runnable).toBe(false);
    expect(compiled.unsupported).toContain("modifier: utf16le");
  });

  it("refuses an aggregation rule rather than running its filter half alone", () => {
    const compiled = compile(
      RULE("  s: {EventID: 4625}\n  condition: s | count() by TargetUserName > 5"),
    );
    // The predicate stays for callers building the aggregate, but is not runnable as a plain search.
    expect(compiled.where).toBe(`TRY_CAST("EventID" AS DOUBLE) = 4625`);
    expect(compiled.runnable).toBe(false);
    expect(compiled.unsupported[0]).toMatch(/aggregation/);
  });

  it("reports a condition that names an undefined search", () => {
    const compiled = compile(RULE("  s: {a: 1}\n  condition: s and missing"));
    expect(compiled.runnable).toBe(false);
    expect(compiled.error).toMatch(/missing/);
  });

  it("refuses a rule that folds to matching every row", () => {
    const compiled = compile(RULE("  s: {gone|exists: false}\n  condition: s"), {
      availableFields: ["a"],
    });
    expect(compiled.where).toBe("TRUE");
    expect(compiled.runnable).toBe(false);
    expect(blockedReason(compiled)).toBe("Rule matches every row");
  });

  it("names an empty search or value list instead of blocking silently", () => {
    for (const body of ["  s: []\n  condition: s", "  s: {}\n  condition: s"]) {
      const compiled = compile(RULE(body));
      expect(compiled.runnable).toBe(false);
      expect(compiled.error).toBe("Search 's' is empty");
    }
    const emptyValues = compile(RULE("  s: {a: []}\n  condition: s"));
    expect(emptyValues.runnable).toBe(false);
    expect(emptyValues.error).toBe("Field 'a' has an empty value list");
  });

  it("quotes an identifier containing a dot, which is how nested fields arrive", () => {
    const { where } = compile(RULE("  s: {userIdentity.type: Root}\n  condition: s"));
    expect(where).toBe(`lower(CAST("userIdentity.type" AS VARCHAR)) = 'root'`);
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
    // A source that classifies but has no content is a dead end for the analyst.
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
    expect(rootActivity.compiled.where).toContain(
      `lower(CAST("userIdentity.type" AS VARCHAR)) = 'root'`,
    );
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
    // With only the two required CloudTrail fields, rules on identity or response cannot run.
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
    expect(sshFailure.compiled.where).toContain(
      `lower(CAST("message" AS VARCHAR)) LIKE '%failed password for%'`,
    );
  });

  it("uses the field map for a web server stream that spells things its own way", () => {
    const source = SOURCE_TYPE_BY_ID.get("webserver_access")!;
    const applicable = applicableRules(source, ["path", "method", "status", "remote_addr"]);
    const traversal = applicable.find((entry) => entry.rule.title.includes("Path Traversal"))!;

    expect(traversal.compiled.runnable).toBe(true);
    expect(traversal.compiled.where).toContain(`lower(CAST("path" AS VARCHAR))`);
  });
});

describe("OCSF bridge", () => {
  // Imported here so the section reads on its own.
  const load = async () => {
    const { compileForSource, ruleAppliesTo } = await import("./index");
    const { SOURCE_TYPE_BY_ID } = await import("../sourceTypes");
    return { compileForSource, ruleAppliesTo, ocsf: SOURCE_TYPE_BY_ID.get("ocsf_native")! };
  };
  const winRule = rule(`title: Office spawns a shell
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    ParentImage|endswith: '\\winword.exe'
    Image|endswith: '\\cmd.exe'
  condition: 1 of them`);
  // Ingest flattens three levels; the parent's path stays JSON one level up.
  const fields = [
    "_timestamp",
    "class_uid",
    "activity_id",
    "process_file_path",
    "process_parent_process_file",
  ];

  it("applies process-creation rules to OCSF data", async () => {
    const { ruleAppliesTo, ocsf } = await load();
    expect(ruleAppliesTo(winRule, ocsf)).toBe(true);
  });

  it("maps fields onto OCSF paths, reads past the flatten depth, and guards the class", async () => {
    const { compileForSource, ocsf } = await load();
    const compiled = compileForSource(winRule, ocsf, fields);
    expect(compiled.runnable).toBe(true);
    expect(compiled.where).toBe(
      `((TRY_CAST("class_uid" AS DOUBLE) = 1007 AND TRY_CAST("activity_id" AS DOUBLE) = 1)) AND ` +
        `((lower(CAST(json_as_text("process_parent_process_file", 'path') AS VARCHAR)) LIKE '%\\\\winword.exe' AND lower(CAST("process_file_path" AS VARCHAR)) LIKE '%\\\\cmd.exe'))`,
    );
  });

  it("refuses to run unguarded when the stream has no class column", async () => {
    const { compileForSource, ocsf } = await load();
    // Both of the rule's own fields are present; only the guard columns are not.
    const compiled = compileForSource(winRule, ocsf, [
      "_timestamp",
      "process_file_path",
      "process_parent_process_file",
    ]);
    expect(compiled.runnable).toBe(false);
    expect(compiled.where).toBe("");
    expect(compiled.assumedAbsent).toEqual(expect.arrayContaining(["class_uid", "activity_id"]));
  });

  it("treats a Sigma field with no OCSF mapping as absent, even if a column shares its name", async () => {
    const { compileForSource, ocsf } = await load();
    const r = rule(`title: t
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    Image|endswith: '\\cmd.exe'
    Hashes|contains: 'abc'
  condition: selection`);
    const compiled = compileForSource(r, ocsf, [...fields, "hashes"]);
    expect(compiled.assumedAbsent).toContain("Hashes");
    expect(compiled.runnable).toBe(false);
  });

  it("refuses AWS Root Account Activity rather than fold away its AwsServiceEvent exclusion", async () => {
    const { compileForSource, ocsf } = await load();
    const root = sigmaCatalog().find((r) => r.title === "AWS Root Account Activity")!;
    const compiled = compileForSource(root, ocsf, [
      "class_uid",
      "metadata_product_name",
      "actor_user_type",
      "eventtype",
    ]);
    expect(compiled.runnable).toBe(false);
    expect(compiled.where).not.toMatch(/eventtype/i);
    expect(compiled.unsupported).toEqual([
      "not over absent field 'eventType': cannot prove the exclusion",
    ]);
  });
});

describe("flatten-depth JSON fallback", () => {
  it("reads only a path deeper than the flatten level, from the level-3 column", () => {
    const deep = compile(RULE("  s: {a.b.c.d: x}\n  condition: s"), { availableFields: ["a_b_c"] });
    expect(deep.where).toBe(`lower(CAST(json_as_text("a_b_c", 'd') AS VARCHAR)) = 'x'`);
    // A shallower column of the same name is a plain value: the field is absent.
    const shallow = compile(RULE("  s: {missing.deep.field.x: 1}\n  condition: s"), {
      availableFields: ["missing"],
    });
    expect(shallow.runnable).toBe(false);
    expect(shallow.assumedAbsent).toContain("missing.deep.field.x");
  });

  it("keeps a number under a string modifier as text, readable from an integer column", () => {
    expect(compile(RULE("  s: {CommandLine|contains: 1337}\n  condition: s")).where).toBe(
      `lower(CAST("CommandLine" AS VARCHAR)) LIKE '%1337%'`,
    );
  });

  it("runs keyword rules on OCSF through the stream's own text column, without false caveats", async () => {
    const { compileForSource } = await import("./index");
    const { SOURCE_TYPE_BY_ID } = await import("../sourceTypes");
    const r = rule(`title: k
logsource:
  category: process_creation
  product: windows
detection:
  keywords:
    - mimikatz
  condition: keywords`);
    const compiled = compileForSource(r, SOURCE_TYPE_BY_ID.get("ocsf_native")!, [
      "class_uid",
      "activity_id",
      "message",
    ]);
    expect(compiled.runnable).toBe(true);
    expect(compiled.where).toContain(`lower(CAST("message" AS VARCHAR)) LIKE '%mimikatz%'`);
    expect(compiled.assumedAbsent).toEqual([]);
  });
});
