// Copyright 2026 OpenObserve Inc.

// The Remote Task registration contract, in one place.
//
// Auth is a discriminated union on `authType`, so "a bearer task needs a token,
// a basic task needs a username and password" is a schema fact rather than four
// `v-if`-guarded manual checks in the submit handler.

import { z } from "zod";
import {
  ATTEMPTS_MAX,
  ATTEMPTS_MIN,
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  DEFAULT_RESPONSE_SCHEMA,
  RESERVED_HEADERS,
  TIMEOUT_SECONDS_MAX,
  TIMEOUT_SECONDS_MIN,
} from "./remoteTaskContent";
import type {
  CreateRemoteTaskAuthPayload,
  CreateRemoteTaskHeaderPayload,
  CreateRemoteTaskPayload,
  CreateRemoteTaskSigningPayload,
  RemoteTaskHttpMethod,
} from "@/services/remote-tasks.service";

export const REMOTE_TASK_AUTH_TYPES = ["none", "bearer", "basic", "api_key_header"] as const;
export const REMOTE_TASK_METHODS = ["POST", "PUT", "PATCH"] as const;

const filled = (message: string) =>
  z.string().refine((value) => value.trim().length > 0, { message });

/** A number typed into an OFormInput arrives as a string; validate the raw text. */
const boundedNumber = (min: number, max: number, message: string) =>
  z.any().refine((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max;
  }, message);

export const makeRemoteTaskSchema = (
  t: (_key: string) => string,
  options: { requireHttps: boolean },
) =>
  z
    .object({
      name: filled(t("aiObservability.remoteTasks.form.validation.nameRequired")),
      description: z.string().optional().default(""),
      httpMethod: z.enum(REMOTE_TASK_METHODS).default("POST"),
      endpoint: filled(t("aiObservability.remoteTasks.form.validation.endpointRequired")),
      authType: z.enum(REMOTE_TASK_AUTH_TYPES).default("none"),
      token: z.string().optional().default(""),
      username: z.string().optional().default(""),
      password: z.string().optional().default(""),
      authHeaderName: z.string().optional().default(""),
      headers: z
        .array(z.object({ key: z.string().default(""), value: z.string().default("") }))
        .default([]),
      requestTemplate: z.string().optional().default(""),
      responseSchema: filled(
        t("aiObservability.remoteTasks.form.validation.responsePathRequired"),
      ).refine(
        (value) => value.trim().startsWith("$"),
        t("aiObservability.remoteTasks.form.validation.responsePathRoot"),
      ),
      timeoutSeconds: boundedNumber(
        TIMEOUT_SECONDS_MIN,
        TIMEOUT_SECONDS_MAX,
        t("aiObservability.remoteTasks.form.validation.timeoutRange"),
      ),
      maxAttempts: boundedNumber(
        ATTEMPTS_MIN,
        ATTEMPTS_MAX,
        t("aiObservability.remoteTasks.form.validation.attemptsRange"),
      ),
      maxConcurrency: boundedNumber(
        CONCURRENCY_MIN,
        CONCURRENCY_MAX,
        t("aiObservability.remoteTasks.form.validation.concurrencyRange"),
      ),
      signingEnabled: z.boolean().default(false),
      /** Machine-generated, never typed. Held here so it reaches the payload. */
      signingKey: z.string().optional().default(""),
    })
    .superRefine((values, ctx) => {
      // Cloud only accepts public HTTPS destinations. Self-hosted builds may
      // use plain HTTP for private and loopback services; the server still
      // rejects public plaintext endpoints.
      if (
        options.requireHttps &&
        values.endpoint.trim() &&
        !/^https:\/\//i.test(values.endpoint.trim())
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endpoint"],
          message: t("aiObservability.remoteTasks.form.validation.endpointHttps"),
        });
      }

      const requireFilled = (value: string, path: string, message: string) => {
        if (!value.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
        }
      };

      if (values.authType === "bearer") {
        requireFilled(
          values.token,
          "token",
          t("aiObservability.remoteTasks.form.validation.tokenRequired"),
        );
      }
      if (values.authType === "basic") {
        requireFilled(
          values.username,
          "username",
          t("aiObservability.remoteTasks.form.validation.usernameRequired"),
        );
        requireFilled(
          values.password,
          "password",
          t("aiObservability.remoteTasks.form.validation.passwordRequired"),
        );
      }
      if (values.authType === "api_key_header") {
        requireFilled(
          values.authHeaderName,
          "authHeaderName",
          t("aiObservability.remoteTasks.form.validation.headerNameRequired"),
        );
        requireFilled(
          values.token,
          "token",
          t("aiObservability.remoteTasks.form.validation.tokenRequired"),
        );
      }

      // A row the user started and abandoned is a validation error rather than a
      // silent drop: a header meant to be sent that never is, is the kind of bug
      // that only shows up as a 401 from someone else's service.
      values.headers.forEach((header, index) => {
        const key = header.key.trim();
        const value = header.value.trim();
        if (!key && !value) return;
        if (!key) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["headers", index, "key"],
            message: t("aiObservability.remoteTasks.form.validation.headerKeyRequired"),
          });
        } else if (RESERVED_HEADERS.includes(key.toLowerCase() as never)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["headers", index, "key"],
            message: t("aiObservability.remoteTasks.form.validation.headerReserved"),
          });
        }
        if (!value) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["headers", index, "value"],
            message: t("aiObservability.remoteTasks.form.validation.headerValueRequired"),
          });
        }
      });

      // The form fills this the moment signing is switched on, so an empty key
      // means the generator failed rather than that the operator skipped a
      // field. Registering unsigned-but-marked-signed would be worse than
      // refusing.
      if (values.signingEnabled && !values.signingKey.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["signingKey"],
          message: t("aiObservability.remoteTasks.form.validation.signingKeyRequired"),
        });
      }
    });

export type RemoteTaskFormValues = z.infer<ReturnType<typeof makeRemoteTaskSchema>>;

export const remoteTaskFormDefaults = (): RemoteTaskFormValues => ({
  name: "",
  description: "",
  httpMethod: "POST",
  endpoint: "",
  authType: "none",
  token: "",
  username: "",
  password: "",
  authHeaderName: "",
  headers: [],
  requestTemplate: "",
  responseSchema: DEFAULT_RESPONSE_SCHEMA,
  timeoutSeconds: "60",
  maxAttempts: "3",
  maxConcurrency: "4",
  signingEnabled: false,
  signingKey: "",
});

function authPayload(values: RemoteTaskFormValues): CreateRemoteTaskAuthPayload {
  switch (values.authType) {
    case "bearer":
      return { type: "bearer", secret: { type: "token", value: values.token } };
    case "basic":
      return {
        type: "basic",
        secret: { type: "basic", username: values.username, password: values.password },
      };
    case "api_key_header":
      return {
        type: "api_key_header",
        headerName: values.authHeaderName.trim(),
        secret: { type: "token", value: values.token },
      };
    default:
      return { type: "none" };
  }
}

function signingPayload(values: RemoteTaskFormValues): CreateRemoteTaskSigningPayload | undefined {
  if (!values.signingEnabled) return undefined;
  // The key travels with the registration rather than being generated
  // server-side, because the operator needs it in their own service before the
  // test connection — which is signed — ever runs.
  //
  // No key id: a first registration has exactly one key, so `kid` distinguishes
  // nothing. The server assigns one, and naming a key first matters at rotation,
  // which is where the field lives.
  return { enabled: true, secret: { type: "token", value: values.signingKey } };
}

function headerPayloads(values: RemoteTaskFormValues): CreateRemoteTaskHeaderPayload[] {
  return values.headers
    .filter((header) => header.key.trim() && header.value.trim())
    .map((header) => ({ key: header.key.trim(), value: header.value.trim() }));
}

/** Explicit keys, never a spread: the form carries discriminator fields the API
 *  would reject and numbers the inputs emit as strings. */
export function toCreatePayload(values: RemoteTaskFormValues): CreateRemoteTaskPayload {
  const template = values.requestTemplate.trim();
  const headers = headerPayloads(values);
  const signing = signingPayload(values);
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    endpoint: values.endpoint.trim(),
    httpMethod: values.httpMethod as RemoteTaskHttpMethod,
    auth: authPayload(values),
    ...(headers.length ? { customHeaders: headers } : {}),
    requestTemplate: template || null,
    responseSchema: values.responseSchema.trim(),
    timeoutMs: Number(values.timeoutSeconds) * 1000,
    maxAttempts: Number(values.maxAttempts),
    maxConcurrency: Number(values.maxConcurrency),
    ...(signing ? { signing } : {}),
  };
}

/**
 * The draft-save payload. It carries no secret material at all — secrets are
 * owned by the dedicated auth/header/signing routes — which is why edit is only
 * offered for a task that holds none (see `canEditRemoteTask`).
 */
export function toDraftPayload(values: RemoteTaskFormValues, fromVersion?: number) {
  const template = values.requestTemplate.trim();
  const headers = headerPayloads(values);
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    endpoint: values.endpoint.trim(),
    httpMethod: values.httpMethod as RemoteTaskHttpMethod,
    auth: { type: "none" as const },
    ...(headers.length ? { customHeaders: headers } : {}),
    requestTemplate: template || null,
    responseSchema: values.responseSchema.trim(),
    timeoutMs: Number(values.timeoutSeconds) * 1000,
    maxAttempts: Number(values.maxAttempts),
    maxConcurrency: Number(values.maxConcurrency),
    signing: { enabled: false },
    ...(fromVersion !== undefined ? { fromVersion } : {}),
  };
}

/** Prefill for the edit form. Only reached for a task carrying no secrets, so
 *  every credential field stays blank by construction. */
export function remoteTaskToFormValues(task: {
  name: string;
  description?: string | null;
  endpoint: string;
  httpMethod: string;
  customHeaders: { key: string; value?: string }[];
  requestTemplate?: string | null;
  responseSchema: string;
  timeoutMs: number;
  maxAttempts: number;
  maxConcurrency: number;
}): RemoteTaskFormValues {
  return {
    ...remoteTaskFormDefaults(),
    name: task.name,
    description: task.description ?? "",
    httpMethod: (REMOTE_TASK_METHODS as readonly string[]).includes(task.httpMethod)
      ? (task.httpMethod as RemoteTaskHttpMethod)
      : "POST",
    endpoint: task.endpoint,
    headers: task.customHeaders.map((header) => ({
      key: header.key,
      value: header.value ?? "",
    })),
    requestTemplate: task.requestTemplate ?? "",
    responseSchema: task.responseSchema,
    timeoutSeconds: String(Math.round(task.timeoutMs / 1000)),
    maxAttempts: String(task.maxAttempts),
    maxConcurrency: String(task.maxConcurrency),
  };
}
