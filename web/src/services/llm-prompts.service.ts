// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import http from "@/services/http";

export type PromptType = "text" | "chat";
export type PromptStatus = "active" | "archived";
export type PromptSource = "ui" | "sdk" | "playground" | "ci" | "agent";
export type PromptWebhookEvent = "version_created" | "label_moved" | "label_deleted" | "archived";

export interface PromptConfig {
  model: string | null;
  params: Record<string, unknown> | null;
  tools: unknown | null;
  responseFormat: unknown | null;
}

export interface PromptLabel {
  name: string;
  version: number | null;
  deletedAt: number | null;
  updatedBy: string;
  updatedAt: number;
}

/** Stable logical Prompt head. `entityId` is used for every mutation and link. */
export interface Prompt {
  entityId: string;
  name: string;
  folderId: string;
  type: PromptType;
  description: string | null;
  tags: string[];
  status: PromptStatus;
  latestVersion: number;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
  labels: PromptLabel[];
}

/** Immutable physical snapshot. `id` identifies this exact stored version. */
export interface PromptVersion {
  id: string;
  entityId: string;
  version: number;
  payload: unknown;
  config: PromptConfig;
  commitMessage: string;
  source: PromptSource;
  baseVersion: number | null;
  contentHash: string;
  createdBy: string;
  createdAt: number;
}

export interface PromptActivity {
  id: string;
  entityId: string;
  label: string;
  fromVersion: number | null;
  toVersion: number | null;
  actor: string;
  via: PromptSource;
  createdAt: number;
}

export interface PromptMutationResult {
  prompt: Prompt;
  version: PromptVersion;
  created: boolean;
  replayed: boolean;
}

export interface ResolvedPrompt {
  prompt: Prompt;
  version: PromptVersion;
  label: string | null;
}

export interface PromptMatch {
  id: string;
  entityId: string;
  name: string;
  version: number;
  contentHash: string;
}

export interface PromptWebhookSettings {
  endpoint: string;
  events: PromptWebhookEvent[];
  secretConfigured: boolean;
}

export interface PromptSettings {
  protectedLabels: string[];
  webhook: PromptWebhookSettings | null;
}

export interface PromptMachineError {
  code: string;
  message: string;
}

export interface PromptContentInput {
  payload: unknown;
  config?: Partial<PromptConfig>;
}

export interface CreatePromptInput extends PromptContentInput {
  name: string;
  folderId: string;
  type: PromptType;
  description?: string | null;
  tags?: string[];
  commitMessage: string;
  source?: PromptSource;
}

export interface CreatePromptVersionInput extends PromptContentInput {
  commitMessage: string;
  source?: PromptSource;
  baseVersion?: number | null;
  baseHash?: string | null;
}

export interface UpdatePromptInput {
  description?: string | null;
  tags?: string[];
  folderId?: string;
}

export interface ResolvePromptInput {
  name: string;
  label?: string;
  version?: number;
  folder?: string;
}

export interface UpdatePromptSettingsInput {
  protectedLabels: string[];
  webhook: { endpoint: string; events: PromptWebhookEvent[] } | null;
}

const base = (orgId: string) => `/api/${encodeURIComponent(orgId)}/prompts`;
const entityBase = (orgId: string, entityId: string) =>
  `${base(orgId)}/${encodeURIComponent(entityId)}`;

const llmPromptsService = {
  async list(
    orgId: string,
    options: { includeArchived?: boolean; folderId?: string } = {},
  ): Promise<Prompt[]> {
    const response = await http().get(base(orgId), {
      params: {
        includeArchived: options.includeArchived ?? false,
        ...(options.folderId ? { folderId: options.folderId } : {}),
      },
    });
    return response.data?.list ?? [];
  },

  async create(
    orgId: string,
    input: CreatePromptInput,
    idempotencyKey?: string,
  ): Promise<PromptMutationResult> {
    const response = await http().post(base(orgId), input, {
      ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
    });
    return response.data;
  },

  async get(orgId: string, entityId: string): Promise<Prompt> {
    return (await http().get(entityBase(orgId, entityId))).data;
  },

  async update(orgId: string, entityId: string, input: UpdatePromptInput): Promise<Prompt> {
    return (await http().patch(entityBase(orgId, entityId), input)).data;
  },

  async archive(orgId: string, entityId: string): Promise<Prompt> {
    return (await http().post(`${entityBase(orgId, entityId)}/archive`)).data;
  },

  async listVersions(orgId: string, entityId: string): Promise<PromptVersion[]> {
    const response = await http().get(`${entityBase(orgId, entityId)}/versions`);
    return response.data?.versions ?? [];
  },

  async getVersion(orgId: string, entityId: string, version: number): Promise<PromptVersion> {
    return (await http().get(`${entityBase(orgId, entityId)}/versions/${version}`)).data;
  },

  async createVersion(
    orgId: string,
    entityId: string,
    input: CreatePromptVersionInput,
    options: { ifHead?: number; idempotencyKey?: string } = {},
  ): Promise<PromptMutationResult> {
    const response = await http().post(`${entityBase(orgId, entityId)}/versions`, input, {
      params: options.ifHead == null ? undefined : { if_head: options.ifHead },
      ...(options.idempotencyKey
        ? { headers: { "Idempotency-Key": options.idempotencyKey } }
        : {}),
    });
    return response.data;
  },

  async listActivity(orgId: string, entityId: string): Promise<PromptActivity[]> {
    const response = await http().get(`${entityBase(orgId, entityId)}/activity`);
    return response.data?.activity ?? [];
  },

  async moveLabel(
    orgId: string,
    entityId: string,
    label: string,
    version: number,
    ifVersion?: number | null,
  ): Promise<PromptLabel> {
    return (
      await http().put(`${entityBase(orgId, entityId)}/labels/${encodeURIComponent(label)}`, {
        version,
        ifVersion: ifVersion ?? null,
      })
    ).data;
  },

  async deleteLabel(
    orgId: string,
    entityId: string,
    label: string,
    ifVersion?: number | null,
  ): Promise<PromptLabel> {
    return (
      await http().delete(`${entityBase(orgId, entityId)}/labels/${encodeURIComponent(label)}`, {
        params: ifVersion == null ? undefined : { ifVersion },
      })
    ).data;
  },

  async resolve(orgId: string, input: ResolvePromptInput): Promise<ResolvedPrompt> {
    return (await http().get(`${base(orgId)}/resolve`, { params: input })).data;
  },

  async match(
    orgId: string,
    input: PromptContentInput & { type: PromptType },
  ): Promise<PromptMatch[]> {
    const response = await http().post(`${base(orgId)}/match`, input);
    return response.data?.matches ?? [];
  },

  async getSettings(orgId: string): Promise<PromptSettings> {
    return (await http().get(`${base(orgId)}/settings`)).data;
  },

  async updateSettings(
    orgId: string,
    input: UpdatePromptSettingsInput,
  ): Promise<PromptSettings> {
    return (await http().put(`${base(orgId)}/settings`, input)).data;
  },

  async rotateSecret(orgId: string, secret: string): Promise<{ secretConfigured: boolean }> {
    return (await http().put(`${base(orgId)}/settings/secret`, { secret })).data;
  },
};

export default llmPromptsService;
