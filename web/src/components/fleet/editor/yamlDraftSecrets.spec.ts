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
import { parseDocument } from "yaml";
import {
  blankYamlSecretKeys,
  changedYamlSecrets,
  redactYamlSecrets,
  restoreYamlSecrets,
  yamlSecretLabel,
  YAML_NOT_STORED,
} from "./yamlDraftSecrets";

const yaml = (...lines: string[]) => lines.join("\n");

/** What the Fleet editor stores for `edited`, what Continue gives back against `saved`, and which secrets Save waits for. */
const continueDraft = (edited: string, saved: string) => {
  const redacted = redactYamlSecrets(edited);
  const changed = changedYamlSecrets(redacted, edited, saved);
  const kept = redacted.ids.filter((id) => !changed.includes(id));
  const text = restoreYamlSecrets(redacted.text, kept, saved);
  const notKept = [...new Set([...changed, ...blankYamlSecretKeys(text, kept)])];
  return {
    stored: redacted.text,
    text,
    notKept: notKept.map(yamlSecretLabel),
    blocked: blankYamlSecretKeys(text, notKept).map(yamlSecretLabel),
    retyped: (next: string) => blankYamlSecretKeys(next, notKept).map(yamlSecretLabel),
  };
};

const parses = (text: string) => parseDocument(text).errors.length === 0;

const expectNone = (text: string, secrets: string[]) => {
  for (const secret of secrets) expect(text).not.toContain(secret);
};

describe("redactYamlSecrets", () => {
  it("blanks values under secret keys and keeps comments, quoting and every other byte", () => {
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
    expect(result.ids.map(yamlSecretLabel)).toEqual([
      "exporters.otlphttp.headers.Authorization",
      "exporters.otlphttp.headers.api_key",
    ]);
  });

  it("keeps env references, file paths, empty values and a value-less key", () => {
    const text = yaml(
      "extensions:",
      "  bearertokenauth:",
      "    token: ${env:O2_TOKEN}",
      "    token_file: /etc/o2/token",
      '    password: ""',
      "    secret: # set on the host",
    );
    expect(redactYamlSecrets(text)).toEqual({ text, ids: [] });
  });

  it("drops a secret block scalar's body and keeps its header comment and the keys after it", () => {
    const result = redactYamlSecrets(
      yaml(
        "tls:",
        "  private_key: |- # pem",
        "    -----BEGIN KEY-----",
        "    abc",
        "",
        "  insecure: false",
      ),
    );
    expect(result.text).toBe(yaml("tls:", '  private_key: "" # pem', "", "  insecure: false"));
    expect(parses(result.text)).toBe(true);
  });

  it("drops a multi-line plain secret and keeps it on its own line", () => {
    const result = redactYamlSecrets(
      yaml("auth:", "  password:", "    sekret", "    more", "  user: u"),
    );
    expect(result.text).toBe(yaml("auth:", "  password:", '    ""', "  user: u"));
  });
});

describe("`key`/`name` + `value` entries", () => {
  const saved = yaml(
    "extensions:",
    "  headers_setter:",
    "    headers:",
    "      - action: upsert",
    "        key: Authorization",
    "        value: Bearer abc",
    "      - key: X-Scope-OrgID",
    "        value: tenant-1",
    "      - {key: X-Api-Key, value: k-flow}",
    "processors:",
    "  attributes:",
    "    actions:",
    "      - key: api_token",
    "        value: tok-1",
    "        action: upsert",
  );

  it("stores no value of an entry named like a secret, block or flow, and keeps the rest", () => {
    const result = continueDraft(saved, saved);
    expectNone(result.stored, ["Bearer abc", "k-flow", "tok-1"]);
    expect(result.stored).toContain("value: tenant-1");
    expect(result.stored).toContain('{key: X-Api-Key, value: ""}');
    expect(result.text).toBe(saved);
    expect(result.notKept).toEqual([]);
  });

  it("refills by the entry's key, not its position, and blocks a changed one", () => {
    const edited = saved
      .replace("Bearer abc", "Bearer new")
      .replace("      - action: upsert\n", "      - action: insert\n");
    const result = continueDraft(edited, saved);
    expect(result.blocked).toEqual(["extensions.headers_setter.headers[Authorization].value"]);
    expect(result.text).toContain("value: tok-1");
    expect(result.text).toContain("value: k-flow");
  });
});

describe("CRLF text", () => {
  it("blanks secrets in CRLF YAML, keeps the line breaks, and refills them", () => {
    const saved = ["auth:", "  password: hunter2", "  user: bot", "x: 1", ""].join("\r\n");
    const result = continueDraft(saved.replace("x: 1", "x: 2"), saved);
    expect(result.stored).toBe(["auth:", '  password: ""', "  user: bot", "x: 2", ""].join("\r\n"));
    expect(result.text).toBe(saved.replace("x: 1", "x: 2"));
    expect(result.notKept).toEqual([]);
  });

  it("refills a block scalar into CRLF text with CRLF breaks", () => {
    const saved = ["tls:", "  private_key: |", "    line1", "    line2", "x: 1", ""].join("\r\n");
    const result = continueDraft(saved, saved);
    expect(result.stored).toBe(["tls:", '  private_key: ""', "x: 1", ""].join("\r\n"));
    expect(result.text).toBe(saved);
  });
});

describe("commented-out secrets", () => {
  it("blanks the value of commented-out secret lines, alone, nested or in prose", () => {
    const result = redactYamlSecrets(
      yaml(
        "auth:",
        "  # password: oldSecret",
        "  user: bot # token: inline-old",
        "# extensions:",
        "#   basicauth:",
        "#     client_auth:",
        "#       password: nested-old",
        "# TODO set the api_key: prose-old later",
        "api_keys:",
        "  # - listed-old",
        "  - ${env:KEY}",
      ),
    );
    expectNone(result.text, ["oldSecret", "inline-old", "nested-old", "prose-old", "listed-old"]);
    expect(result.text).toBe(
      yaml(
        "auth:",
        '  # password: ""',
        '  user: bot # token: ""',
        "# extensions:",
        "#   basicauth:",
        "#     client_auth:",
        '#       password: ""',
        '# TODO set the api_key: ""',
        "api_keys:",
        '  # - ""',
        "  - ${env:KEY}",
      ),
    );
    expect(result.ids).toEqual([]);
  });
});

describe("multi-line flow lists", () => {
  it("blanks each item of a multi-line flow list in place and blocks Save until retyped", () => {
    const saved = yaml("auth:", "  api_keys: [", "    k1,", "    k2", "  ]", "x: 1");
    const result = continueDraft(saved, saved);
    expect(result.stored).toBe(yaml("auth:", "  api_keys: [", '    "",', '    ""', "  ]", "x: 1"));
    expect(parses(result.stored)).toBe(true);
    expect(result.blocked).toEqual(["auth.api_keys[1]", "auth.api_keys[2]"]);
    expect(result.retyped(saved)).toEqual([]);
  });
});

describe("block scalars of other keys", () => {
  it("never touches the body of a non-secret block scalar", () => {
    const text = yaml(
      "processors:",
      "  transform:",
      "    script: |",
      "      token: abc",
      "      # password: def",
      "      set(attributes['x'], 'y')",
      "x: 1",
    );
    expect(redactYamlSecrets(text)).toEqual({ text, ids: [] });
  });
});

describe("quoting", () => {
  it("blanks a single-quoted secret with a '' escape whole, and a double-quoted one with escapes", () => {
    const saved = yaml("a:", "  password: 'it''s secret, really'", '  token: "x\\"y"', "b: 1");
    const result = continueDraft(saved.replace("b: 1", "b: 2"), saved);
    expect(result.stored).toBe(yaml("a:", '  password: ""', '  token: ""', "b: 2"));
    expect(result.text).toBe(saved.replace("b: 1", "b: 2"));
  });
});

describe("anchors, tags, aliases and flow separators", () => {
  it("keeps anchors, tags and trailing commas and blanks what an alias under a secret key points to", () => {
    const saved = yaml(
      "defaults:",
      "  token: &tok X1 # main",
      "  api_key: !!str Y2",
      "  user: &who bot",
      "flow: {password: Z3, keep: 1}",
      "other:",
      "  credential: *who",
      "  copy: *tok",
    );
    const result = continueDraft(saved, saved);
    expect(result.stored).toBe(
      yaml(
        "defaults:",
        '  token: &tok "" # main',
        '  api_key: !!str ""',
        '  user: &who ""',
        'flow: {password: "", keep: 1}',
        "other:",
        "  credential: *who",
        "  copy: *tok",
      ),
    );
    expect(result.text).toBe(saved);
    expect(result.notKept).toEqual([]);
  });
});

describe("block scalars and aliases of collections", () => {
  it("refills a keep-chomped block scalar with its trailing blank lines, and one at the end of the text", () => {
    for (const saved of [
      yaml("a:", "  token: |+", "    x", "", "", "b: 1", ""),
      yaml("a:", "  token: |", "    x"),
    ]) {
      const result = continueDraft(saved, saved);
      expectNone(result.stored, ["x"]);
      expect(result.text).toBe(saved);
    }
  });

  it("blanks every scalar of a map an alias under a secret key points to", () => {
    const saved = yaml("creds: &c", "  user: u1", "  pass: p1", "other:", "  secret: *c");
    const result = continueDraft(saved, saved);
    expect(result.stored).toBe(
      yaml("creds: &c", '  user: ""', '  pass: ""', "other:", "  secret: *c"),
    );
    expect(result.text).toBe(saved);
  });
});

describe("bare list dashes", () => {
  it("blanks a list item whose value sits on the next line", () => {
    const saved = yaml("api_keys:", "  -", "    k-next-line", "  - k2", "x: 1");
    const result = continueDraft(saved, saved);
    expect(result.stored).toBe(yaml("api_keys:", "  -", '    ""', '  - ""', "x: 1"));
    expect(result.blocked).toEqual(["api_keys[1]", "api_keys[2]"]);
  });
});

describe("lists and maps under a secret key", () => {
  it("a block list of keys is never silently saved blank and unblocks once retyped", () => {
    const saved = yaml("auth:", "  api_keys:", "    - key-one", "    - key-two # second", "x: 1");
    const result = continueDraft(saved.replace("x: 1", "x: 2"), saved);
    expectNone(result.stored, ["key-one", "key-two"]);
    expect(result.text).toBe(yaml("auth:", "  api_keys:", '    - ""', '    - "" # second', "x: 2"));
    expect(result.blocked).toEqual(["auth.api_keys[1]", "auth.api_keys[2]"]);
    expect(result.retyped(result.text.replace(/""/g, "k"))).toEqual([]);
  });

  it("blanks every scalar of a nested map under a secret key and keeps names, file keys and env references", () => {
    const result = redactYamlSecrets(
      yaml(
        "auth:",
        "  credentials:",
        "    name: bot",
        "    nested:",
        "      deep: value",
        "    pem: |",
        "      -----BEGIN-----",
        "    key_file: /etc/key",
        "    from_env: ${env:X}",
        "  endpoint: https://o2",
      ),
    );
    expect(result.text).toBe(
      yaml(
        "auth:",
        "  credentials:",
        "    name: bot",
        "    nested:",
        '      deep: ""',
        '    pem: ""',
        "    key_file: /etc/key",
        "    from_env: ${env:X}",
        "  endpoint: https://o2",
      ),
    );
  });

  it("refills `- name/value` items by their name and keeps the names", () => {
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
    expectNone(result.stored, ["k-new"]);
    expect(result.text).toContain('value: ""');
    expect(result.blocked).toEqual(["auth.api_keys[prod].value"]);
  });

  it("blanks a flow list under a secret key inside a flow map item by item and blocks Save", () => {
    const saved = "opts: {auth: {api_key: [k1, k2]}, x: 1}";
    const result = continueDraft("opts: {auth: {api_key: [k1, k2]}, x: 2}", saved);
    expect(result.stored).toBe('opts: {auth: {api_key: ["", ""]}, x: 2}');
    expect(result.text).toBe(result.stored);
    expect(result.blocked).toEqual(["opts.auth.api_key[1]", "opts.auth.api_key[2]"]);
  });

  it("refills secrets of nested flow maps by their own path", () => {
    const saved = yaml(
      "auth: {a: {token: X}, b: {token: Y}}",
      "users: [{username: a, password: PA}, {username: b, password: PB}]",
    );
    const edited = yaml(
      "auth: {a: {token: X}, b: {token: Y}}",
      "users: [{username: b, password: PB}]",
    );
    const result = continueDraft(edited, saved);
    expect(result.stored).toBe(
      yaml('auth: {a: {token: ""}, b: {token: ""}}', 'users: [{username: b, password: ""}]'),
    );
    expect(result.text).toBe(edited);
  });

  it("blanks a list at the secret key's own indent and stops at the next key", () => {
    const saved = yaml("api_keys:", "- k1", "- k2", "other: 1");
    const result = continueDraft(saved, saved);
    expect(result.stored).toBe(yaml("api_keys:", '- ""', '- ""', "other: 1"));
    expect(result.blocked).toEqual(["api_keys[1]", "api_keys[2]"]);
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

  it("refills each blank from the same path, re-indented, keeping the draft's edits", () => {
    const edited = yaml(
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
    );
    const result = continueDraft(edited, source);
    expect(result.text).toBe(edited);
    expect(result.notKept).toEqual([]);
  });

  it("refills a multi-line plain secret onto the key's line", () => {
    const saved = yaml("auth:", "  password:", "    sekret", "    more", "  user: u");
    const redacted = redactYamlSecrets(yaml("auth:", "  password: sekret more", "  user: v"));
    expect(restoreYamlSecrets(redacted.text, redacted.ids, saved)).toBe(
      yaml("auth:", "  password: sekret", "    more", "  user: v"),
    );
  });

  it("matches list items by job_name or their first plain field, never by position", () => {
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
      "      password: PB",
      "users:",
      "  - username: b",
      "    password: UB",
    );
    const result = continueDraft(edited, saved);
    expect(result.text).toBe(edited);
    expect(result.notKept).toEqual([]);
  });

  it("leaves a secret blank in a list item with no identity or one shared by two items", () => {
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
    const edited = yaml("a:", "  - password: P1", "b:", "  - name: x", "    token: T1");
    const result = continueDraft(edited, saved);
    expect(result.text).toBe(result.stored);
    expect(result.blocked).toEqual(["a[1].password", "b[x].token"]);
    expect(restoreYamlSecrets(result.stored, redactYamlSecrets(edited).ids, saved)).toBe(
      result.stored,
    );
  });

  it("leaves a blank blank when the saved YAML has no value there, and marks it not kept", () => {
    const result = continueDraft(yaml("receivers:", "  new:", "    token: typed"), source);
    expect(result.text).toBe(yaml("receivers:", "  new:", '    token: ""'));
    expect(result.blocked).toEqual(["receivers.new.token"]);
  });

  it("marks a secret not kept when the saved value changed after the draft was written", () => {
    const edited = yaml("auth:", "  password: one", "  user: u");
    const redacted = redactYamlSecrets(edited);
    expect(changedYamlSecrets(redacted, edited, edited)).toEqual([]);
    const later = yaml("auth:", "  user: u");
    const text = restoreYamlSecrets(redacted.text, redacted.ids, later);
    expect(blankYamlSecretKeys(text, redacted.ids).map(yamlSecretLabel)).toEqual(["auth.password"]);
  });

  it("never refills a value that would not parse back as the saved one", () => {
    const saved = yaml("auth:", "  token: |", "    multi", "    line");
    const redacted = redactYamlSecrets("auth: {token: x}");
    expect(redacted.text).toBe('auth: {token: ""}');
    expect(restoreYamlSecrets(redacted.text, redacted.ids, saved)).toBe(redacted.text);
  });
});

describe("YAML that does not parse", () => {
  it("stores no text for unreadable YAML with a secret-looking word, and the text as is without one", () => {
    expect(redactYamlSecrets("auth:\n  password: [hunter2\n")).toEqual({
      text: "",
      ids: [YAML_NOT_STORED],
    });
    const plain = "receivers:\n  otlp: [grpc\n";
    expect(redactYamlSecrets(plain)).toEqual({ text: plain, ids: [] });
  });

  it("marks every secret not kept when the saved YAML does not parse", () => {
    const edited = yaml("auth:", "  password: one");
    const result = continueDraft(edited, "auth: [broken");
    expect(result.text).toBe(yaml("auth:", '  password: ""'));
    expect(result.blocked).toEqual(["auth.password"]);
  });

  it("counts a not-kept secret as still blank while the text does not parse", () => {
    const { ids } = redactYamlSecrets(yaml("auth:", "  password: one"));
    expect(blankYamlSecretKeys("auth: [", ids)).toEqual(ids);
    expect(blankYamlSecretKeys("auth:\n  password: two", ids)).toEqual([]);
    expect(blankYamlSecretKeys("auth:\n  user: u", ids)).toEqual([]);
  });
});
