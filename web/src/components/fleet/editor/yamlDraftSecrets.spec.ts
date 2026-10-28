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
  blankYamlSecretKeys,
  changedYamlSecretLines,
  redactYamlSecrets,
  restoreYamlSecrets,
  yamlKeyPathLabel,
  yamlLineKeyPaths,
} from "./yamlDraftSecrets";

const yaml = (...lines: string[]) => lines.join("\n");

describe("redactYamlSecrets", () => {
  it("blanks literal values under secret keys and keeps their comments", () => {
    const result = redactYamlSecrets(
      yaml(
        "exporters:",
        "  otlphttp:",
        "    headers:",
        "      Authorization: Basic abc # prod",
        '      "api_key": "k-123"',
        "    endpoint: https://o2.example.com",
      ),
    );
    expect(result.text).toBe(
      yaml(
        "exporters:",
        "  otlphttp:",
        "    headers:",
        '      Authorization: "" # prod',
        '      "api_key": ""',
        "    endpoint: https://o2.example.com",
      ),
    );
    expect(result.lines).toEqual([3, 4]);
  });

  it("keeps env references, file paths, empty values and nested mappings", () => {
    const text = yaml(
      "extensions:",
      "  bearertokenauth:",
      "    token: ${env:O2_TOKEN}",
      "    token_file: /etc/o2/token",
      '    password: ""',
      "    secret: # set on the host",
    );
    expect(redactYamlSecrets(text)).toEqual({ text, lines: [] });
  });

  it("drops the body of a block scalar under a secret key", () => {
    const result = redactYamlSecrets(
      yaml("tls:", "  private_key: |", "    -----BEGIN KEY-----", "    abc", "  insecure: false"),
    );
    expect(result.text).toBe(yaml("tls:", '  private_key: ""', "  insecure: false"));
    expect(result.lines).toEqual([1]);
  });

  it("blanks a secret inside a list item", () => {
    expect(redactYamlSecrets("users:\n  - password: hunter2\n").text).toBe(
      'users:\n  - password: ""\n',
    );
  });

  it("blanks secret values inside flow-style maps", () => {
    const result = redactYamlSecrets(
      yaml(
        'headers: { Authorization: "Basic abc", x-team: core }',
        'other: {"x-api-key": abc, token: ${env:T}}',
        "  - {name: bot, password: hunter2}",
        "list: [a, b]",
      ),
    );
    expect(result.text).toBe(
      yaml(
        'headers: { Authorization: "", x-team: core }',
        'other: {"x-api-key": "", token: ${env:T}}',
        '  - {name: bot, password: ""}',
        "list: [a, b]",
      ),
    );
    expect(result.lines).toEqual([0, 1, 2]);
  });
});

describe("redactYamlSecrets multi-line plain scalars", () => {
  it("blanks a plain value on the lines under a secret key", () => {
    const result = redactYamlSecrets(
      yaml("auth:", "  password:", "    sekret", "    more", "  basic:", "    user: u", "x: 1"),
    );
    expect(result.text).toBe(yaml("auth:", '  password: ""', "  basic:", "    user: u", "x: 1"));
    expect(result.lines).toEqual([1]);
    expect(redactYamlSecrets(yaml("token:", "  inner: v")).text).toBe(
      yaml("token:", '  inner: ""'),
    );
  });
});

describe("changedYamlSecretLines", () => {
  it("reports the blanked lines whose value differs from the saved YAML", () => {
    const saved = yaml("a:", "  password: one", "  token: two", "  user: u");
    const edited = yaml("a:", "  password: one", "  token: changed", "  user: v", "  secret: new");
    const redacted = redactYamlSecrets(edited);
    expect(changedYamlSecretLines(redacted, edited, saved)).toEqual([2, 4]);
    expect(changedYamlSecretLines(redacted, edited, "")).toEqual([1, 2, 4]);
  });
});

describe("restoreYamlSecrets", () => {
  const source = yaml(
    "exporters:",
    "  otlphttp:",
    "    headers:",
    "      Authorization: Basic saved # prod",
    "  other:",
    "    headers: { api_key: k-1, x: y }",
    "tls:",
    "  private_key: |",
    "    -----BEGIN KEY-----",
    "    abc",
    "users:",
    "  - name: alice",
    "    password: a-pass",
    "  - name: bob",
    "    password: b-pass",
  );

  it("refills each blanked line from the same key path, keeping the draft's edits", () => {
    const edited = yaml(
      "exporters:",
      "  added: {}",
      "  otlphttp:",
      "    endpoint: https://new",
      "    headers:",
      "      Authorization: Basic typed # edited",
      "  other:",
      "    headers: { api_key: k-2, x: z }",
      "tls:",
      "    private_key: |",
      "      -----BEGIN KEY-----",
      "      typed",
      "users:",
      "  - name: bob",
      "    password: typed",
      "  - name: alice",
      "    password: typed",
    );
    const redacted = redactYamlSecrets(edited);
    expect(restoreYamlSecrets(redacted.text, redacted.lines, source)).toBe(
      yaml(
        "exporters:",
        "  added: {}",
        "  otlphttp:",
        "    endpoint: https://new",
        "    headers:",
        "      Authorization: Basic saved # edited",
        "  other:",
        "    headers: { api_key: k-1, x: z }",
        "tls:",
        "    private_key: |",
        "      -----BEGIN KEY-----",
        "      abc",
        "users:",
        "  - name: bob",
        "    password: b-pass",
        "  - name: alice",
        "    password: a-pass",
      ),
    );
  });

  it("matches list items by job_name or their first scalar, never by position", () => {
    const saved = yaml(
      "scrape_configs:",
      "  - job_name: a",
      "    basic_auth:",
      "      password: PA",
      "  - job_name: b",
      "    basic_auth:",
      "      password: PB",
      "users:",
      "  - username: a",
      "    password: UA",
      "  - username: b",
      "    password: UB",
    );
    const edited = yaml(
      "scrape_configs:",
      "  - job_name: b",
      "    basic_auth:",
      "      password: typed",
      "users:",
      "  - username: b",
      "    password: typed",
    );
    const redacted = redactYamlSecrets(edited);
    expect(restoreYamlSecrets(redacted.text, redacted.lines, saved)).toBe(
      yaml(
        "scrape_configs:",
        "  - job_name: b",
        "    basic_auth:",
        "      password: PB",
        "users:",
        "  - username: b",
        "    password: UB",
      ),
    );
  });

  it("leaves a secret blank inside a list item with no identity, or one shared by two items", () => {
    const saved = yaml(
      "a:",
      "  - password: P1",
      "  - password: P2",
      "b:",
      "  - name: x",
      "    token: T1",
      "  - name: x",
      "    token: T2",
    );
    const edited = yaml("a:", "  - password: typed", "b:", "  - name: x", "    token: typed");
    const redacted = redactYamlSecrets(edited);
    expect(restoreYamlSecrets(redacted.text, redacted.lines, saved)).toBe(redacted.text);
  });

  it("never cross-fills a flow key that repeats in nested maps or items", () => {
    const saved = yaml(
      "auth: {a: {token: X}, b: {token: Y}}",
      "users: [{username: a, password: PA}, {username: b, password: PB}]",
      "solo: {api_key: K, x: 1}",
    );
    const edited = yaml(
      "auth: {a: {token: X}, b: {token: Y}}",
      "users: [{username: b, password: PB}]",
      "solo: {api_key: K, x: 2}",
    );
    const redacted = redactYamlSecrets(edited);
    expect(restoreYamlSecrets(redacted.text, redacted.lines, saved)).toBe(
      yaml(
        'auth: {a: {token: ""}, b: {token: ""}}',
        'users: [{username: b, password: ""}]',
        "solo: {api_key: K, x: 2}",
      ),
    );
  });

  it("refills a multi-line plain secret", () => {
    const saved = yaml("auth:", "  password:", "    sekret", "  user: u");
    const redacted = redactYamlSecrets(yaml("auth:", "  password: typed", "  user: v"));
    expect(restoreYamlSecrets(redacted.text, redacted.lines, saved)).toBe(
      yaml("auth:", "  password:", "    sekret", "  user: v"),
    );
  });

  it("leaves a blanked line blank when the saved YAML has no value at that path", () => {
    const redacted = redactYamlSecrets(yaml("receivers:", "  new:", "    token: typed"));
    expect(restoreYamlSecrets(redacted.text, redacted.lines, source)).toBe(redacted.text);
  });
});

describe("redactYamlSecrets: lists and maps under a secret key", () => {
  it("blanks every scalar of a block list, a nested map and a block scalar under a secret key", () => {
    const result = redactYamlSecrets(
      yaml(
        "auth:",
        "  api_keys:",
        "    - key-one",
        "    - key-two # second",
        "    - ${env:KEY_THREE}",
        "  credentials:",
        "    user: bot",
        "    nested:",
        "      deep: value",
        "    pem: |",
        "      -----BEGIN-----",
        "    key_file: /etc/key",
        "  endpoint: https://o2",
      ),
    );
    expect(result.text).toBe(
      yaml(
        "auth:",
        "  api_keys:",
        '    - ""',
        '    - "" # second',
        "    - ${env:KEY_THREE}",
        "  credentials:",
        '    user: ""',
        "    nested:",
        '      deep: ""',
        '    pem: ""',
        "    key_file: /etc/key",
        "  endpoint: https://o2",
      ),
    );
    expect(result.text).not.toContain("key-one");
    expect(result.text).not.toContain("BEGIN");
  });

  it("blanks a flow list or map held by a secret key, also nested in a flow map", () => {
    const result = redactYamlSecrets(
      yaml(
        "api_keys: [k1, k2]",
        "auth: {tokens: [t1, t2], mode: basic}",
        "opts: {headers: {a: b}}",
      ),
    );
    expect(result.text).toBe(
      yaml('api_keys: ""', 'auth: {tokens: "", mode: basic}', "opts: {headers: {a: b}}"),
    );
    expect(result.lines).toEqual([0, 1]);
  });

  it("restores a nested map's secrets by key path and leaves list items blank", () => {
    const saved = yaml("auth:", "  credentials:", "    user: bot", "  api_keys:", "    - k1");
    const redacted = redactYamlSecrets(saved);
    expect(restoreYamlSecrets(redacted.text, redacted.lines, saved)).toBe(
      yaml("auth:", "  credentials:", "    user: bot", "  api_keys:", '    - ""'),
    );
  });
});

describe("lists and flow collections under a secret key: nothing lost, nothing leaked", () => {
  /** What Continue gives back and which keys Save waits for, for a draft of `edited` against `saved`. */
  const continueDraft = (edited: string, saved: string) => {
    const redacted = redactYamlSecrets(edited);
    const changed = changedYamlSecretLines(redacted, edited, saved);
    const kept = redacted.lines.filter((line) => !changed.includes(line));
    const text = restoreYamlSecrets(redacted.text, kept, saved);
    const notKept = yamlLineKeyPaths(redacted.text, changed);
    return { stored: redacted.text, text, notKept, blank: blankYamlSecretKeys(text, notKept) };
  };

  it("a block list of keys is never silently saved blank", () => {
    const saved = yaml("auth:", "  api_keys:", "    - key-one", "    - key-two", "x: 1");
    const result = continueDraft(saved.replace("x: 1", "x: 2"), saved);
    expect(result.stored).not.toMatch(/key-one|key-two/);
    expect(result.text).toBe(yaml("auth:", "  api_keys:", '    - ""', '    - ""', "x: 2"));
    expect(result.blank.map(yamlKeyPathLabel)).toEqual(["auth.api_keys[1]", "auth.api_keys[2]"]);

    const retyped = result.text.replace('    - ""\n    - ""', "    - key-one\n    - key-two");
    expect(blankYamlSecretKeys(retyped, result.notKept)).toEqual([]);
  });

  it("refills `- name/value` items under a secret key by their name and keeps the names", () => {
    const saved = yaml(
      "auth:",
      "  api_keys:",
      "    - name: prod",
      "      value: k-prod",
      "    - name: dev",
      "      value: k-dev",
    );
    const edited = yaml("auth:", "  api_keys:", "    - name: dev", "      value: k-dev");
    const result = continueDraft(edited, saved);
    expect(result.stored).toBe(yaml("auth:", "  api_keys:", "    - name: dev", '      value: ""'));
    expect(result.text).toBe(edited);
    expect(result.notKept).toEqual([]);
  });

  it("a changed `value` in a named item is left blank and blocks Save under its name", () => {
    const saved = yaml("auth:", "  api_keys:", "    - name: prod", "      value: k-prod");
    const result = continueDraft(saved.replace("k-prod", "k-new"), saved);
    expect(result.stored).not.toContain("k-new");
    expect(result.text).toContain('value: ""');
    expect(result.blank.map(yamlKeyPathLabel)).toEqual(["auth.api_keys[prod].value"]);
  });

  it("refills a flow list under a secret key inside a flow map, never as a YAML null", () => {
    const saved = "opts: {auth: {api_key: [k1, k2]}, x: 1}";
    const result = continueDraft("opts: {auth: {api_key: [k1, k2]}, x: 2}", saved);
    expect(result.stored).toBe('opts: {auth: {api_key: ""}, x: 2}');
    expect(result.text).toBe("opts: {auth: {api_key: [k1, k2]}, x: 2}");
    expect(result.notKept).toEqual([]);
  });

  it("a changed flow list under a secret key is left blank and blocks Save", () => {
    const saved = "opts: {auth: {api_key: [k1, k2]}, x: 1}";
    const result = continueDraft("opts: {auth: {api_key: [k1, k3]}, x: 1}", saved);
    expect(result.text).toBe('opts: {auth: {api_key: ""}, x: 1}');
    expect(result.blank).toEqual(["opts"]);
  });

  it("blanks a list at the secret key's own indent and stops at the next key", () => {
    const saved = yaml("api_keys:", "- k1", "- k2", "other: 1");
    const result = continueDraft(saved, saved);
    expect(result.stored).toBe(yaml("api_keys:", '- ""', '- ""', "other: 1"));
    expect(result.stored).not.toMatch(/k1|k2/);
    expect(result.blank.map(yamlKeyPathLabel)).toEqual(["api_keys[1]", "api_keys[2]"]);
    expect(
      redactYamlSecrets(yaml("auth:", "  tokens:", "  - name: a", "    value: t", "  x: 1")).text,
    ).toBe(yaml("auth:", "  tokens:", "  - name: a", '    value: ""', "  x: 1"));
  });

  it("keeps the keys after a block scalar inside a list item", () => {
    const saved = yaml("users:", "  - private_key: |", "      abc", "    name: x", "    mode: m");
    const result = continueDraft(saved, saved);
    expect(result.stored).toBe(yaml("users:", '  - private_key: ""', "    name: x", "    mode: m"));
    expect(result.text).toBe(saved);
  });
});
