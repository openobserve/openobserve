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
const schema = makeRemoteTaskSchema(t);

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

  // The server refuses plain http, so the form says so before a round trip.
  it("refuses a non-https endpoint", () => {
    expect(issuePaths(values({ endpoint: "http://tasks.example.com/run" }))).toContain("endpoint");
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
  // A draft save carries no material at all — secrets belong to the dedicated
  // auth/header/signing routes — which is why edit is offered only for a task
  // that holds none.
  it("carries no secret material and no signing", () => {
    const payload = toDraftPayload(values({ authType: "bearer", token: "abc" }), 3);
    expect(payload.auth).toEqual({ type: "none" });
    expect(payload.signing).toEqual({ enabled: false });
    expect(JSON.stringify(payload)).not.toContain("abc");
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
      customHeaders: [{ key: "x-team", value: "search" }],
      requestTemplate: null,
      responseSchema: "$.answer",
      timeoutMs: 90_000,
      maxAttempts: 2,
      maxConcurrency: 8,
    });
    expect(form.httpMethod).toBe("PATCH");
    expect(form.timeoutSeconds).toBe("90");
    expect(form.maxConcurrency).toBe("8");
    expect(form.headers).toEqual([{ key: "x-team", value: "search" }]);
    expect(form.responseSchema).toBe("$.answer");
    // Credentials are never returned, so they stay blank by construction.
    expect(form.token).toBe("");
    expect(form.authType).toBe("none");
  });

  it("falls back to POST for a method the form cannot offer", () => {
    const form = remoteTaskToFormValues({
      name: "x",
      endpoint: "https://x.example.com",
      httpMethod: "DELETE",
      customHeaders: [],
      responseSchema: "$.output",
      timeoutMs: 1000,
      maxAttempts: 1,
      maxConcurrency: 1,
    });
    expect(form.httpMethod).toBe("POST");
  });
});
