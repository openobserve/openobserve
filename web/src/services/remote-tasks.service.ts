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

/// Auth as it comes back from the server: the shape, and whether a Secret is
/// configured — never the Secret itself.
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

/// A custom header on the way out. A Secret-backed header reports that it is,
/// and carries no value.
export interface RemoteTaskHeaderView {
  key: string;
  value?: string;
  usesSecret: boolean;
}

export interface RemoteTask {
  id: string;
  orgId: string;
  entityId: string;
  /// 0 marks the head's draft, which no experiment can reference.
  version: number;
  isDraft: boolean;
  isReferenceable: boolean;
  /// `name@version`, present only when there is a version to pin.
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

/// A write carries Secret references, never Secret values — the write-only rule
/// the registration form depends on.
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
  /// The published version an edit started from. Ignored when a draft exists.
  fromVersion?: number;
}

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

/// The outcome of a test connection. `published` is false when it failed, in
/// which case no version was minted and the draft is unchanged bar the reason.
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
    unwrapList<RemoteTask>(await http().get(`/api/${orgId}/remote_tasks`)),

  get: async (orgId: string, entityId: string): Promise<RemoteTask> =>
    (await http().get(`/api/${orgId}/remote_tasks/${entityId}`)).data,

  versions: async (orgId: string, entityId: string): Promise<RemoteTask[]> =>
    unwrapList<RemoteTask>(
      await http().get(`/api/${orgId}/remote_tasks/${entityId}/versions`),
    ),

  create: async (orgId: string, payload: RemoteTaskPayload): Promise<RemoteTask> =>
    (await http().post(`/api/${orgId}/remote_tasks`, payload)).data,

  /// Save the head's single draft. Published versions are untouched.
  saveDraft: async (
    orgId: string,
    entityId: string,
    payload: RemoteTaskPayload,
  ): Promise<RemoteTask> =>
    (await http().put(`/api/${orgId}/remote_tasks/${entityId}`, payload)).data,

  getDraft: async (orgId: string, entityId: string): Promise<RemoteTask> =>
    (await http().get(`/api/${orgId}/remote_tasks/${entityId}/draft`)).data,

  discardDraft: async (orgId: string, entityId: string): Promise<void> => {
    await http().delete(`/api/${orgId}/remote_tasks/${entityId}/draft`);
  },

  /// Test connection, and publish on success. The only way a version is minted.
  testConnection: async (
    orgId: string,
    entityId: string,
    payload: RemoteTaskTestConnectionPayload = {},
  ): Promise<RemoteTaskPublishResult> =>
    (await http().post(`/api/${orgId}/remote_tasks/${entityId}/test_connection`, payload))
      .data,

  /// Volatile test-run bench. Returns the per-row exchange and nothing durable.
  testRun: async (
    orgId: string,
    entityId: string,
    samples: RemoteTaskTestRunSample[],
  ): Promise<RemoteTaskTestRunRow[]> => {
    const response = await http().post(
      `/api/${orgId}/remote_tasks/${entityId}/test_run`,
      { samples },
    );
    return response?.data?.results ?? [];
  },

  delete: async (orgId: string, entityId: string): Promise<void> => {
    await http().delete(`/api/${orgId}/remote_tasks/${entityId}`);
  },
};

export default remoteTasksService;
