// Copyright 2026 OpenObserve Inc.
import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import prompts, {
  type CreatePromptInput,
  type CreatePromptVersionInput,
  type UpdatePromptInput,
  type UpdatePromptSettingsInput,
} from "./llm-prompts.service";
import { llmPromptKeys } from "./llm-prompts.service.querykeys";

export const llmPromptsQuery = (org: string) =>
  queryOptions({
    queryKey: llmPromptKeys.list(org),
    queryFn: () => prompts.list(org, { includeArchived: true }),
    staleTime: MEDIUM_STALE_TIME,
  });

export const promptSettingsQuery = (org: string) =>
  queryOptions({
    queryKey: llmPromptKeys.settings(org),
    queryFn: () => prompts.getSettings(org),
    staleTime: MEDIUM_STALE_TIME,
  });

export const createPromptMutation = (org: string) =>
  mutationOptions({
    mutationFn: (variables: { input: CreatePromptInput; idempotencyKey: string }) =>
      prompts.create(org, variables.input, variables.idempotencyKey),
    meta: { invalidates: [llmPromptKeys.all(org)], silentError: true },
  });

export const createPromptVersionMutation = (org: string) =>
  mutationOptions({
    mutationFn: (variables: {
      entityId: string;
      input: CreatePromptVersionInput;
      ifHead: number;
      idempotencyKey: string;
    }) =>
      prompts.createVersion(org, variables.entityId, variables.input, {
        ifHead: variables.ifHead,
        idempotencyKey: variables.idempotencyKey,
      }),
    meta: { invalidates: [llmPromptKeys.all(org)], silentError: true },
  });

export const updatePromptMutation = (org: string) =>
  mutationOptions({
    mutationFn: (variables: { entityId: string; input: UpdatePromptInput }) =>
      prompts.update(org, variables.entityId, variables.input),
    meta: { invalidates: [llmPromptKeys.all(org)], silentError: true },
  });

export const archivePromptMutation = (org: string) =>
  mutationOptions({
    mutationFn: (entityId: string) => prompts.archive(org, entityId),
    meta: { invalidates: [llmPromptKeys.all(org)], silentError: true },
  });

export const movePromptLabelMutation = (org: string) =>
  mutationOptions({
    mutationFn: (variables: {
      entityId: string;
      name: string;
      version: number;
      ifVersion: number | null;
    }) =>
      prompts.moveLabel(
        org,
        variables.entityId,
        variables.name,
        variables.version,
        variables.ifVersion,
      ),
    meta: { invalidates: [llmPromptKeys.all(org)], silentError: true },
  });

export const deletePromptLabelMutation = (org: string) =>
  mutationOptions({
    mutationFn: (variables: { entityId: string; name: string; ifVersion: number }) =>
      prompts.deleteLabel(org, variables.entityId, variables.name, variables.ifVersion),
    meta: { invalidates: [llmPromptKeys.all(org)], silentError: true },
  });

export const updatePromptSettingsMutation = (org: string) =>
  mutationOptions({
    mutationFn: (input: UpdatePromptSettingsInput) => prompts.updateSettings(org, input),
    meta: { invalidates: [llmPromptKeys.all(org)], silentError: true },
  });

export const rotatePromptSecretMutation = (org: string) =>
  mutationOptions({
    mutationFn: (secret: string) => prompts.rotateSecret(org, secret),
    meta: { invalidates: [llmPromptKeys.all(org)], silentError: true },
  });
