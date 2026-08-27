// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  makeRemoteTaskSchema,
  remoteTaskFormDefaults,
  remoteTaskToFormValues,
  toCreatePayload,
  toDraftPayload,
  type RemoteTaskFormValues,
} from "./RemoteTaskForm.schema";

const t = (key: string) => key;
const schema = makeRemoteTaskSchema(t, { requireHttps: true });
const selfHostedSchema = makeRemoteTaskSchema(t, { requireHttps: false });
const editSchema = makeRemoteTaskSchema(t, {
  requireHttps: true,
  preserveSecrets: true,
});

function values(overrides: Partial<RemoteTaskFormValues> = {}): RemoteTaskFormValues {
  return {
    ...remoteTaskFormDefaults(),
    name: "summarizer",
    endpoint: "https://tasks.example.com/run",
    ...overrides,
  };
}

/** Every issue path, joined, so a test can assert on a nested field. */
function issuePaths(input: RemoteTaskFormValues): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("makeRemoteTaskSchema", () => {
  it("accepts a minimal valid registration", () => {
    expect(schema.safeParse(values()).success).toBe(true);
  });

  it("requires a name and an endpoint", () => {
    expect(issuePaths(values({ name: "  " }))).toContain("name");
    expect(issuePaths(values({ endpoint: "" }))).toContain("endpoint");
  });

  it("refuses a non-https endpoint in cloud builds", () => {
    expect(issuePaths(values({ endpoint: "http://tasks.example.com/run" }))).toContain("endpoint");
  });

  it("allows a non-https endpoint in self-hosted builds", () => {
    expect(
      selfHostedSchema.safeParse(values({ endpoint: "http://127.0.0.1:8000/sre/query" })).success,
    ).toBe(true);
  });

  it.each([
    ["bearer", { authType: "bearer" as const }, "token"],
    ["basic", { authType: "basic" as const }, "username"],
    ["api_key_header", { authType: "api_key_header" as const }, "authHeaderName"],
  ])("requires the material %s auth needs", (_label, overrides, field) => {
    expect(issuePaths(values(overrides))).toContain(field);
  });

  it("asks for both halves of basic credentials", () => {
    const paths = issuePaths(values({ authType: "basic", username: "svc" }));
    expect(paths).toContain("password");
    expect(paths).not.toContain("username");
  });

  it("asks for nothing when auth is off", () => {
    expect(schema.safeParse(values({ authType: "none" })).success).toBe(true);
  });

  // A header the user half-filled is an error rather than a silent drop: a
  // header meant to be sent that never is only shows up as someone else's 401.
  it("rejects a half-filled header row by index", () => {
    expect(issuePaths(values({ headers: [{ key: "x-team", value: "" }] }))).toContain(
      "headers.0.value",
    );
    expect(issuePaths(values({ headers: [{ key: "", value: "search" }] }))).toContain(
      "headers.0.key",
    );
  });

  it("ignores a wholly empty header row", () => {
    expect(schema.safeParse(values({ headers: [{ key: "", value: "" }] })).success).toBe(true);
  });

  it("refuses a header name the platform owns", () => {
    expect(
      issuePaths(values({ headers: [{ key: "Authorization", value: "Bearer x" }] })),
    ).toContain("headers.0.key");
  });

  it("requires a dollar-rooted output path", () => {
    expect(issuePaths(values({ responseSchema: "output" }))).toContain("responseSchema");
    expect(issuePaths(values({ responseSchema: "  " }))).toContain("responseSchema");
    expect(schema.safeParse(values({ responseSchema: "$.data[0]['text']" })).success).toBe(true);
  });

  it.each([
    ["timeoutSeconds", "0"],
    ["timeoutSeconds", "601"],
    ["maxAttempts", "4"],
    ["maxAttempts", "0"],
    ["maxConcurrency", "33"],
    ["maxConcurrency", "0"],
  ])("keeps %s inside the server's bounds (%s)", (field, value) => {
    expect(issuePaths(values({ [field]: value } as Partial<RemoteTaskFormValues>))).toContain(
      field,
    );
  });

  it("asks for a signing key only when the operator supplies one", () => {
    expect(schema.safeParse(values({ signingEnabled: true, signingGenerate: true })).success).toBe(
      true,
    );
    expect(issuePaths(values({ signingEnabled: true, signingGenerate: false }))).toContain(
      "signingKey",
    );
  });
});

describe("toCreatePayload", () => {
  it("sends seconds as milliseconds and strings as numbers", () => {
    const payload = toCreatePayload(values({ timeoutSeconds: "30", maxAttempts: "2" }));
    expect(payload.timeoutMs).toBe(30_000);
    expect(payload.maxAttempts).toBe(2);
    expect(payload.maxConcurrency).toBe(4);
  });

  it("carries write-only material inline, and no client-made reference", () => {
    const payload = toCreatePayload(values({ authType: "bearer", token: "abc" }));
    expect(payload.auth).toEqual({ type: "bearer", secret: { type: "token", value: "abc" } });
    expect(JSON.stringify(payload)).not.toContain("secret_ref");
  });

  // Omitting `secret` is what asks the server to generate the HMAC material and
  // hand it back exactly once.
  it("omits the secret when the server should generate the signing key", () => {
    const payload = toCreatePayload(values({ signingEnabled: true, signingGenerate: true }));
    expect(payload.signing).toEqual({ enabled: true });
  });

  it("sends supplied signing material and its key id", () => {
    const payload = toCreatePayload(
      values({
        signingEnabled: true,
        signingGenerate: false,
        signingKey: "k",
        signingKeyId: "k1",
      }),
    );
    expect(payload.signing).toEqual({
      enabled: true,
      secret: { type: "token", value: "k" },
      keyId: "k1",
    });
  });

  it("omits signing entirely when it is off", () => {
    expect(toCreatePayload(values()).signing).toBeUndefined();
  });

  it("drops abandoned header rows and trims the rest", () => {
    const payload = toCreatePayload(
      values({
        headers: [
          { key: " x-team ", value: " search " },
          { key: "", value: "" },
        ],
      }),
    );
    expect(payload.customHeaders).toEqual([{ key: "x-team", value: "search" }]);
  });

  it("sends no template when the field is blank, so the server default applies", () => {
    expect(toCreatePayload(values({ requestTemplate: "   " })).requestTemplate).toBeNull();
  });

  it("leaks no form-only discriminator fields into the body", () => {
    const payload = toCreatePayload(values({ authType: "bearer", token: "abc" })) as Record<
      string,
      unknown
    >;
    for (const key of ["authType", "token", "signingGenerate", "timeoutSeconds"]) {
      expect(payload).not.toHaveProperty(key);
    }
  });
});

describe("toDraftPayload", () => {
  it("leaves credential references for the server to carry forward", () => {
    const payload = toDraftPayload(
      values({
        authType: "bearer",
        token: "abc",
        signingEnabled: true,
        signingKey: "signing-key",
        headers: [{ key: "x-api-key", value: "", usesSecret: true }],
      }),
      3,
    );
    expect(payload.auth).toBeUndefined();
    expect(payload.signing).toBeUndefined();
    expect(payload.customHeaders).toEqual([{ key: "x-api-key" }]);
    expect(JSON.stringify(payload)).not.toContain("abc");
    expect(JSON.stringify(payload)).not.toContain("signing-key");
    expect(payload.fromVersion).toBe(3);
  });

  it("omits fromVersion when the head has never published", () => {
    expect(toDraftPayload(values())).not.toHaveProperty("fromVersion");
  });
});

describe("remoteTaskToFormValues", () => {
  it("round-trips a stored task back into editable values", () => {
    const form = remoteTaskToFormValues({
      name: "summarizer",
      description: "does things",
      endpoint: "https://tasks.example.com/run",
      httpMethod: "PATCH",
      auth: { type: "bearer" },
      customHeaders: [{ key: "x-team", value: "search", usesSecret: false }],
      requestTemplate: null,
      responseSchema: "$.answer",
      timeoutMs: 90_000,
      maxAttempts: 2,
      maxConcurrency: 8,
      signing: { enabled: true },
    });
    expect(form.httpMethod).toBe("PATCH");
    expect(form.timeoutSeconds).toBe("90");
    expect(form.maxConcurrency).toBe("8");
    expect(form.headers).toEqual([{ key: "x-team", value: "search", usesSecret: false }]);
    expect(form.responseSchema).toBe("$.answer");
    expect(form.token).toBe("");
    expect(form.authType).toBe("bearer");
    expect(form.signingEnabled).toBe(true);
  });

  it("falls back to POST for a method the form cannot offer", () => {
    const form = remoteTaskToFormValues({
      name: "x",
      endpoint: "https://x.example.com",
      httpMethod: "DELETE",
      auth: { type: "none" },
      customHeaders: [],
      responseSchema: "$.output",
      timeoutMs: 1000,
      maxAttempts: 1,
      maxConcurrency: 1,
      signing: { enabled: false },
    });
    expect(form.httpMethod).toBe("POST");
  });
});

it("validates an edit with stored credentials but no returned material", () => {
  const result = editSchema.safeParse(
    values({
      authType: "bearer",
      token: "",
      signingEnabled: true,
      signingKey: "",
      headers: [{ key: "x-api-key", value: "", usesSecret: true }],
    }),
  );
  expect(result.success).toBe(true);
});
