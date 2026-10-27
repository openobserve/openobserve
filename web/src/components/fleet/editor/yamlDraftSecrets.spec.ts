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
import { changedYamlSecretLines, redactYamlSecrets, restoreYamlSecrets } from "./yamlDraftSecrets";

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
  it("blanks a plain value on the lines under a secret key, and keeps nested maps", () => {
    const result = redactYamlSecrets(
      yaml("auth:", "  password:", "    sekret", "    more", "  basic:", "    user: u", "x: 1"),
    );
    expect(result.text).toBe(yaml("auth:", '  password: ""', "  basic:", "    user: u", "x: 1"));
    expect(result.lines).toEqual([1]);
    expect(redactYamlSecrets(yaml("token:", "  inner: v")).lines).toEqual([]);
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
