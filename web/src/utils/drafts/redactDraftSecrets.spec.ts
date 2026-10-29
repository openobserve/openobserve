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
  blankRedactedPaths,
  changedRedactedPaths,
  isSecretKeyName,
  redactDraftSecrets,
  redactedEntryLabels,
  restoreRedacted,
} from "./redactDraftSecrets";

describe("redactDraftSecrets", () => {
  it("blanks string values under secret-looking keys at any depth", () => {
    const input = {
      name: "dest",
      password: "p",
      auth: { api_key: "k", apiKey: "k2", "private-key": "pk", clientSecret: "s" },
      list: [{ token: "t" }, { Authorization: "Bearer x" }],
      credentials: "c",
      passwd: "pw",
    };
    const { data, paths } = redactDraftSecrets(input);

    expect(data).toEqual({
      name: "dest",
      password: "",
      auth: { api_key: "", apiKey: "", "private-key": "", clientSecret: "" },
      list: [{ token: "" }, { Authorization: "" }],
      credentials: "",
      passwd: "",
    });
    expect(paths.sort()).toEqual(
      [
        "/password",
        "/auth/api_key",
        "/auth/apiKey",
        "/auth/private-key",
        "/auth/clientSecret",
        "/list/0/token",
        "/list/1/Authorization",
        "/credentials",
        "/passwd",
      ].sort(),
    );
    expect(input.password).toBe("p");
  });

  it("blanks the value of a key/value or name/value pair whose key is secret", () => {
    const { data, paths } = redactDraftSecrets({
      headers: [
        { key: "Authorization", value: "Bearer x" },
        { key: "Content-Type", value: "json" },
        { name: "X-Api-Key", value: "k" },
      ],
    });
    expect(data.headers).toEqual([
      { key: "Authorization", value: "" },
      { key: "Content-Type", value: "json" },
      { name: "X-Api-Key", value: "" },
    ]);
    expect(paths).toEqual(["/headers/0/value", "/headers/2/value"]);
  });

  it("leaves non-string and empty values alone", () => {
    const { data, paths } = redactDraftSecrets({ max_tokens: 100, token: "", secret: null });
    expect(data).toEqual({ max_tokens: 100, token: "", secret: null });
    expect(paths).toEqual([]);
  });

  it("blanks every string under a secret-looking container key, keeping entry labels", () => {
    const { data, paths } = redactDraftSecrets({
      secrets: [{ name: "X", value: "s3" }, "raw"],
      credentials: { integrationKey: "ik", nested: { region: "eu" }, type: "basic", count: 2 },
      settings: { region: "us" },
    });
    expect(data).toEqual({
      secrets: [{ name: "X", value: "" }, ""],
      credentials: { integrationKey: "", nested: { region: "" }, type: "basic", count: 2 },
      settings: { region: "us" },
    });
    expect(paths.sort()).toEqual(
      [
        "/secrets/0/value",
        "/secrets/1",
        "/credentials/integrationKey",
        "/credentials/nested/region",
      ].sort(),
    );
  });

  it("leaves a secret container's other fields alone when containers is off", () => {
    const { data } = redactDraftSecrets(
      { credentials: { username: "bot", password: "p" } },
      { containers: false },
    );
    expect(data).toEqual({ credentials: { username: "bot", password: "" } });
  });

  it("never blanks an exempt key, even under a secret container", () => {
    const { data, paths } = redactDraftSecrets(
      {
        authApiKeyHeaderName: "X-Key",
        authApiKeyToken: "t",
        credentials: { authApiKeyHeaderName: "Y" },
      },
      { exemptKeys: ["authApiKeyHeaderName"] },
    );
    expect(data).toEqual({
      authApiKeyHeaderName: "X-Key",
      authApiKeyToken: "",
      credentials: { authApiKeyHeaderName: "Y" },
    });
    expect(paths).toEqual(["/authApiKeyToken"]);
  });

  it("escapes slashes and tildes in path segments", () => {
    const { paths } = redactDraftSecrets({ "a/b": { "~token": "x" } });
    expect(paths).toEqual(["/a~1b/~0token"]);
  });
});

describe("isSecretKeyName", () => {
  it.each([
    "passphrase",
    "ssh_passphrase",
    "access_key",
    "accessKey",
    "AWS_ACCESS_KEY_ID",
    "secret_key",
    "client_secret",
    "session_key",
    "sessionKey",
    "session_cookie",
    "Cookie",
    "Set-Cookie",
    "bearer",
    "bearer_token",
    "refresh_token",
    "id_token",
    "x-api-key",
    "X-Auth-Token",
    "PRIVATE-TOKEN",
    "Ocp-Apim-Subscription-Key",
    "account_key",
    "APIKey",
    "db_password",
  ])("treats %s as a secret", (key) => {
    expect(isSecretKeyName(key)).toBe(true);
  });

  it.each([
    "token_count",
    "max_tokens",
    "maxTokens",
    "input_tokens",
    "completion_tokens",
    "token_limit",
    "token_type",
    "token_url",
    "keyword",
    "keywords",
    "primary_key",
    "partition_key",
    "public_key",
    "key",
    "name",
    "author",
    "auth_type",
    "tokenizer",
  ])("does not treat %s as a secret", (key) => {
    expect(isSecretKeyName(key)).toBe(false);
  });
});

describe("redactDraftSecrets credential names", () => {
  it("blanks common credential fields of a generic object and keeps look-alikes", () => {
    const { data, paths } = redactDraftSecrets(
      {
        passphrase: "hunter2",
        access_key: "AKIA123",
        secret_key: "s",
        client_secret: "cs",
        sessionKey: "sk",
        refresh_token: "rt",
        headers: [
          { key: "Cookie", value: "sid=1" },
          { key: "x-api-key", value: "k" },
          { key: "Accept", value: "json" },
        ],
        llm: { max_tokens: "512", token_count: "10", keyword: "error", primary_key: "id" },
      },
      { containers: false },
    );
    expect(data).toEqual({
      passphrase: "",
      access_key: "",
      secret_key: "",
      client_secret: "",
      sessionKey: "",
      refresh_token: "",
      headers: [
        { key: "Cookie", value: "" },
        { key: "x-api-key", value: "" },
        { key: "Accept", value: "json" },
      ],
      llm: { max_tokens: "512", token_count: "10", keyword: "error", primary_key: "id" },
    });
    expect(paths.sort()).toEqual(
      [
        "/passphrase",
        "/access_key",
        "/secret_key",
        "/client_secret",
        "/sessionKey",
        "/refresh_token",
        "/headers/0/value",
        "/headers/1/value",
      ].sort(),
    );
  });

  it("does not treat a token-count container as a secret container", () => {
    const { data, paths } = redactDraftSecrets({ max_tokens: { model: "gpt-4o", value: "512" } });
    expect(data).toEqual({ max_tokens: { model: "gpt-4o", value: "512" } });
    expect(paths).toEqual([]);
  });
});

describe("changedRedactedPaths and blankRedactedPaths", () => {
  const baseline = {
    url: "https://saved",
    headers: [
      { key: "A", value: "a1" },
      { key: "B", value: "b1" },
    ],
  };

  it("reports the redacted values that differ from the baseline, matching rows by label", () => {
    const data = {
      url: "https://saved",
      headers: [
        { key: "B", value: "b1" },
        { key: "A", value: "a2" },
        { key: "C", value: "c1" },
      ],
    };
    const paths = ["/url", "/headers/0/value", "/headers/1/value", "/headers/2/value"];
    expect(changedRedactedPaths(data, baseline, paths)).toEqual([
      "/headers/1/value",
      "/headers/2/value",
    ]);
    expect(changedRedactedPaths(data, null, ["/url"])).toEqual(["/url"]);
    expect(changedRedactedPaths({ yaml: "x: 1" }, baseline, ["/yaml/0"])).toEqual([]);
  });

  it("reports the paths still blank now, and forgets a deleted row", () => {
    const current = { url: "", headers: [{ key: "B", value: "" }] };
    const labels = { "/headers/0/value": "A", "/headers/1/value": "B" };
    expect(
      blankRedactedPaths(current, ["/url", "/headers/0/value", "/headers/1/value"], labels),
    ).toEqual(["/url", "/headers/1/value"]);
  });
});

describe("restoreRedacted", () => {
  it("fills blanked paths from the current item and leaves the rest of the draft", () => {
    const input = {
      url: "https://edited",
      password: "draft-secret",
      headers: [{ key: "Authorization", value: "Bearer draft" }],
    };
    const { data, paths } = redactDraftSecrets(input);
    const current = {
      url: "https://saved",
      password: "saved-secret",
      headers: [{ key: "Authorization", value: "Bearer saved" }],
    };

    expect(restoreRedacted(data, current, paths, redactedEntryLabels(input, paths))).toEqual({
      url: "https://edited",
      password: "saved-secret",
      headers: [{ key: "Authorization", value: "Bearer saved" }],
    });
  });

  it("matches a list entry by its label after a row was deleted or reordered", () => {
    const draft = {
      headers: [
        { key: "X-Api-Key", value: "" },
        { key: "Authorization", value: "" },
      ],
    };
    const paths = ["/headers/0/value", "/headers/1/value"];
    const labels = { "/headers/0/value": "X-Api-Key", "/headers/1/value": "Authorization" };
    const current = {
      headers: [
        { key: "Authorization", value: "Bearer A" },
        { key: "X-Api-Key", value: "K" },
      ],
    };
    expect(restoreRedacted(draft, current, paths, labels).headers).toEqual([
      { key: "X-Api-Key", value: "K" },
      { key: "Authorization", value: "Bearer A" },
    ]);

    const deleted = { headers: [{ key: "X-Api-Key", value: "K" }] };
    expect(restoreRedacted(draft, deleted, paths, labels).headers).toEqual([
      { key: "X-Api-Key", value: "K" },
      { key: "Authorization", value: "" },
    ]);
  });

  it("labels a cookie by name and domain, and never refills from an ambiguous label", () => {
    const cookies = [
      { name: "sid", domain: "app.test", value: "A" },
      { name: "sid", domain: "api.test", value: "B" },
    ];
    const draft = { cookies: [{ name: "sid", domain: "api.test", value: "" }] };
    const paths = ["/cookies/0/value"];
    const labels = redactedEntryLabels({ cookies: [cookies[1]] }, paths);
    expect(labels).toEqual({ "/cookies/0/value": "sid@api.test" });
    expect(restoreRedacted(draft, { cookies }, paths, labels).cookies[0].value).toBe("B");

    const headers = {
      headers: [
        { key: "X", value: "one" },
        { key: "X", value: "two" },
      ],
    };
    const blank = { headers: [{ key: "X", value: "" }] };
    expect(
      restoreRedacted(blank, headers, ["/headers/0/value"], { "/headers/0/value": "X" }),
    ).toEqual(blank);
  });

  it("leaves a list entry blank when its label is unknown or gone", () => {
    const draft = { headers: [{ key: "Renamed", value: "" }], list: [{ token: "" }] };
    const current = { headers: [{ key: "Old", value: "v" }], list: [{ token: "t" }] };
    const paths = ["/headers/0/value", "/list/0/token"];
    expect(restoreRedacted(draft, current, paths, { "/headers/0/value": "Renamed" })).toEqual(
      draft,
    );
  });

  it("records the label of the list entry each path sits in", () => {
    const data = {
      headers: [{ key: "Authorization", value: "x" }],
      secrets: [{ id: "s1", value: "y" }],
      password: "z",
    };
    expect(
      redactedEntryLabels(data, ["/headers/0/value", "/secrets/0/value", "/password"]),
    ).toEqual({ "/headers/0/value": "Authorization", "/secrets/0/value": "s1" });
  });

  it("keeps a path blank when the current item has no string there", () => {
    const { data, paths } = redactDraftSecrets({ password: "x", nested: { token: "y" } });
    expect(restoreRedacted(data, { password: 5 }, paths)).toEqual({
      password: "",
      nested: { token: "" },
    });
    expect(restoreRedacted(data, null, paths)).toEqual({ password: "", nested: { token: "" } });
  });

  it("notes a path into a string without restoring it", () => {
    const draft = { yaml: "key: ''" };
    expect(restoreRedacted(draft, { yaml: "key: real" }, ["/yaml/3"])).toEqual(draft);
  });

  it("round-trips escaped segments", () => {
    const { data, paths } = redactDraftSecrets({ "a/b": { "~token": "x" } });
    expect(restoreRedacted(data, { "a/b": { "~token": "now" } }, paths)).toEqual({
      "a/b": { "~token": "now" },
    });
  });
});
