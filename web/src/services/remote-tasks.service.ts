// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import http from "@/services/http";

export type RemoteTaskAuthType = "none" | "bearer" | "basic" | "api_key_header";
export type RemoteTaskVerificationStatus = "unverified" | "verified" | "failed";
export type RemoteTaskHttpMethod = "POST" | "PUT" | "PATCH";

/**
 * Auth as it comes back from the server: the shape, and whether a Secret is
 * configured — never the Secret itself.
 */
export interface RemoteTaskAuthView {
  type: RemoteTaskAuthType;
  usesSecret: boolean;
  headerName?: string;
}

export interface RemoteTaskSigningView {
  enabled: boolean;
  usesSecret: boolean;
  keyId?: string;
}

/**
 * A custom header on the way out. A Secret-backed header reports that it is,
 * and carries no value.
 */
export interface RemoteTaskHeaderView {
  key: string;
  value?: string;
  usesSecret: boolean;
}

export interface RemoteTask {
  id: string;
  orgId: string;
  entityId: string;
  /** 0 marks the head's draft, which no experiment can reference. */
  version: number;
  isDraft: boolean;
  isReferenceable: boolean;
  /** `name@version`, present only when there is a version to pin. */
  taskRef?: string;
  name: string;
  description?: string | null;
  endpoint: string;
  httpMethod: RemoteTaskHttpMethod;
  auth: RemoteTaskAuthView;
  customHeaders: RemoteTaskHeaderView[];
  contentType: string;
  requestTemplate?: string | null;
  responseSchema: string;
  timeoutMs: number;
  maxAttempts: number;
  maxConcurrency: number;
  signing: RemoteTaskSigningView;
  verificationStatus: RemoteTaskVerificationStatus;
  verificationError?: string | null;
  verifiedAt?: number | null;
  draftSourceVersion?: number | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * A write carries Secret references, never Secret values — the write-only rule
 * the registration form depends on.
 */
export interface RemoteTaskAuthPayload {
  type: RemoteTaskAuthType;
  secretRef?: string;
  headerName?: string;
}

export interface RemoteTaskSigningPayload {
  enabled: boolean;
  secretRef?: string;
  keyId?: string;
}

export interface RemoteTaskHeaderPayload {
  key: string;
  value?: string;
  secretRef?: string;
}

export interface RemoteTaskPayload {
  name: string;
  description?: string | null;
  endpoint: string;
  httpMethod?: RemoteTaskHttpMethod;
  auth?: RemoteTaskAuthPayload;
  customHeaders?: RemoteTaskHeaderPayload[];
  contentType?: string;
  requestTemplate?: string | null;
  responseSchema?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  maxConcurrency?: number;
  signing?: RemoteTaskSigningPayload;
  /** The published version an edit started from. Ignored when a draft exists. */
  fromVersion?: number;
}

export type RemoteTaskSecretMaterial =
  { type: "token"; value: string } | { type: "basic"; username: string; password: string };

export interface RemoteTaskCredentialMetadata {
  purpose: "auth" | "signing";
  keyId?: string | null;
  state: string;
  lastVerifiedAt?: number | null;
  graceExpiresAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteTaskCredentialWrite {
  metadata: RemoteTaskCredentialMetadata;
  /** Returned exactly once for a generated signing candidate. */
  material: RemoteTaskSecretMaterial;
}

export interface RemoteTaskSigningStatus {
  keys: RemoteTaskCredentialMetadata[];
}

export type CreateRemoteTaskAuthPayload =
  | { type: "none" }
  | { type: "bearer"; secret: RemoteTaskSecretMaterial }
  | { type: "basic"; secret: RemoteTaskSecretMaterial }
  | {
      type: "api_key_header";
      headerName: string;
      secret: RemoteTaskSecretMaterial;
    };

export interface CreateRemoteTaskHeaderPayload {
  key: string;
  value?: string;
  secret?: RemoteTaskSecretMaterial;
}

export interface CreateRemoteTaskSigningPayload {
  enabled: boolean;
  /** Omit to have OpenObserve generate HMAC material. */
  secret?: RemoteTaskSecretMaterial;
  keyId?: string;
}

export type CreateRemoteTaskPayload = Omit<
  RemoteTaskPayload,
  "auth" | "customHeaders" | "signing" | "fromVersion"
> & {
  auth?: CreateRemoteTaskAuthPayload;
  customHeaders?: CreateRemoteTaskHeaderPayload[];
  signing?: CreateRemoteTaskSigningPayload;
};

export interface GeneratedRemoteTaskSigningSecret {
  keyId: string;
  material: RemoteTaskSecretMaterial;
}

export type CreateRemoteTaskResult = RemoteTask & {
  /** Present only for server-generated HMAC material; show or copy it now. */
  generatedSigningSecret?: GeneratedRemoteTaskSigningSecret | null;
};

export interface RemoteTaskTestConnectionPayload {
  input?: any;
  metadata?: any;
}

export interface RemoteTaskVerificationReport {
  rawRequest: string;
  rawResponse: string;
  statusCode?: number;
  parsedOutput?: any;
  latencyMs: number;
}

/**
 * The outcome of a test connection. `published` is false when it failed, in
 * which case no version was minted and the draft is unchanged bar the reason.
 */
export interface RemoteTaskPublishResult {
  published: boolean;
  versionBumped: boolean;
  error?: string;
  task: RemoteTask;
  report: RemoteTaskVerificationReport;
}

export interface RemoteTaskTestRunSample {
  rowId?: string;
  input: any;
  metadata?: any;
}

export interface RemoteTaskTestRunRow {
  rowId: string;
  input: any;
  status: "ok" | "skipped" | "error";
  parsedOutput?: any;
  rawRequest: string;
  rawResponse: string;
  httpStatus?: number;
  latencyMs: number;
  error?: string;
}

const unwrapList = <T>(response: any, key = "list"): T[] => {
  const data = response?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  return [];
};

const remoteTasksService = {
  list: async (orgId: string): Promise<RemoteTask[]> =>
    unwrapList<RemoteTask>(await http().get(`/api/${orgId}/tasks`)),

  get: async (orgId: string, entityId: string): Promise<RemoteTask> =>
    (await http().get(`/api/${orgId}/tasks/${entityId}`)).data,

  versions: async (orgId: string, entityId: string): Promise<RemoteTask[]> =>
    unwrapList<RemoteTask>(await http().get(`/api/${orgId}/tasks/${entityId}/versions`)),

  create: async (
    orgId: string,
    payload: CreateRemoteTaskPayload,
  ): Promise<CreateRemoteTaskResult> => (await http().post(`/api/${orgId}/tasks`, payload)).data,

  replaceAuth: async (
    orgId: string,
    entityId: string,
    material: RemoteTaskSecretMaterial,
  ): Promise<RemoteTaskCredentialMetadata> =>
    (await http().put(`/api/${orgId}/tasks/${entityId}/auth`, { material })).data,

  revokeAuth: async (orgId: string, entityId: string): Promise<void> => {
    await http().delete(`/api/${orgId}/tasks/${entityId}/auth`);
  },

  replaceHeaderSecret: async (
    orgId: string,
    entityId: string,
    headerName: string,
    material: RemoteTaskSecretMaterial,
  ): Promise<RemoteTaskCredentialMetadata> =>
    (
      await http().put(
        `/api/${orgId}/tasks/${entityId}/headers/${encodeURIComponent(headerName)}/secret`,
        { material },
      )
    ).data,

  revokeHeaderSecret: async (
    orgId: string,
    entityId: string,
    headerName: string,
  ): Promise<void> => {
    await http().delete(
      `/api/${orgId}/tasks/${entityId}/headers/${encodeURIComponent(headerName)}/secret`,
    );
  },

  getSigningStatus: async (orgId: string, entityId: string): Promise<RemoteTaskSigningStatus> =>
    (await http().get(`/api/${orgId}/tasks/${entityId}/signing`)).data,

  rotateSigning: async (
    orgId: string,
    entityId: string,
    payload: { material?: RemoteTaskSecretMaterial; keyId?: string } = {},
  ): Promise<RemoteTaskCredentialWrite> =>
    (await http().post(`/api/${orgId}/tasks/${entityId}/signing/rotate`, payload)).data,

  testSigningCandidate: async (
    orgId: string,
    entityId: string,
    payload: RemoteTaskTestConnectionPayload = {},
  ): Promise<{ verified: boolean; error?: string; report: RemoteTaskVerificationReport }> =>
    (await http().post(`/api/${orgId}/tasks/${entityId}/signing/test`, payload)).data,

  activateSigning: async (
    orgId: string,
    entityId: string,
    gracePeriodMs: number,
  ): Promise<RemoteTaskCredentialMetadata> =>
    (
      await http().post(`/api/${orgId}/tasks/${entityId}/signing/activate`, {
        gracePeriodMs,
      })
    ).data,

  endSigningGrace: async (orgId: string, entityId: string): Promise<void> => {
    await http().post(`/api/${orgId}/tasks/${entityId}/signing/end_grace`);
  },

  revokeSigning: async (orgId: string, entityId: string): Promise<void> => {
    await http().delete(`/api/${orgId}/tasks/${entityId}/signing`);
  },

  /** Save the head's single draft. Published versions are untouched. */
  saveDraft: async (
    orgId: string,
    entityId: string,
    payload: RemoteTaskPayload,
  ): Promise<RemoteTask> => (await http().put(`/api/${orgId}/tasks/${entityId}`, payload)).data,

  getDraft: async (orgId: string, entityId: string): Promise<RemoteTask> =>
    (await http().get(`/api/${orgId}/tasks/${entityId}/draft`)).data,

  discardDraft: async (orgId: string, entityId: string): Promise<void> => {
    await http().delete(`/api/${orgId}/tasks/${entityId}/draft`);
  },

  /** Test connection, and publish on success. The only way a version is minted. */
  testConnection: async (
    orgId: string,
    entityId: string,
    payload: RemoteTaskTestConnectionPayload = {},
  ): Promise<RemoteTaskPublishResult> =>
    (await http().post(`/api/${orgId}/tasks/${entityId}/test_connection`, payload)).data,

  /** Volatile test-run bench. Returns the per-row exchange and nothing durable. */
  testRun: async (
    orgId: string,
    entityId: string,
    samples: RemoteTaskTestRunSample[],
  ): Promise<RemoteTaskTestRunRow[]> => {
    const response = await http().post(`/api/${orgId}/tasks/${entityId}/test_run`, {
      samples,
    });
    return response?.data?.results ?? [];
  },

  delete: async (orgId: string, entityId: string): Promise<void> => {
    await http().delete(`/api/${orgId}/tasks/${entityId}`);
  },
};

export default remoteTasksService;
