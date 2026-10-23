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

import {
  computed,
  nextTick,
  onScopeDispose,
  readonly,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { useOrgId } from "@/composables/query/useOrgId";
import { gt, type I18nKey } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import {
  dryRunHook,
  type DryRunResult,
  type HttpAuthMode,
  type HttpCredential,
  type HttpTriggerConfig,
  type HttpTriggerPermissions,
  type HttpTriggerState,
  type OverlapSeconds,
  type PutHttpTriggerPayload,
} from "@/services/workflows";
import {
  deleteHttpTriggerMutation,
  httpTriggerSecretMutationKey,
  putHttpTriggerMutation,
  revealHttpCredentialSecretMutation,
  revokeHttpCredentialMutation,
  rotateHttpCredentialMutation,
  workflowHttpTriggerQuery,
} from "@/services/workflows.queries";
import { DEFAULT_SAMPLE_BODY } from "./httpSnippets";
import { buildHttpRequestSample } from "./httpRequestSample";

export type EndpointPhase = "loading" | "error" | "off" | "unsaved" | "revealing" | "steady";

/** Where the endpoint stands for the panel and the header chip. */
export type EndpointStatus = "unsaved" | "not_configured" | "off" | "draft" | "paused" | "on";

export type RevealKind = "created" | "rotated" | "switched";

/** Where the panel is open: the editor runs tests on its canvas, the list cannot. */
export type EndpointContext = "editor" | "list";

/** What the panel does on Run test: the editor closes it and opens Test with `seed`. */
export type RunTestAction =
  { kind: "open_test"; seed: unknown[] } | { kind: "open_workflow"; hint: I18nKey };

export interface UseWorkflowHttpEndpointArgs {
  workflowId: Ref<string | null>;
  isDraftOnly: Ref<boolean>;
  /** A paused workflow refuses calls; omit when the caller does not know. */
  workflowEnabled?: Ref<boolean>;
  context?: EndpointContext;
  /** Unsaved workflow (no id): called before PUT; the editor passes `persistDraft`. */
  beforeCreate?: () => Promise<boolean>;
}

const NO_PERMISSIONS: HttpTriggerPermissions = { edit: false, test: false, reveal: false };
const CREDENTIAL_ROLES = new Set(["admin", "root"]);

const errorMessage = (err: unknown): string => {
  const e = err as { response?: { data?: { message?: string } }; message?: string } | null;
  return e?.response?.data?.message ?? e?.message ?? gt("common.unknownError");
};

const errorStatus = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | null)?.response?.status;

const without = (record: Record<string, string>, key: string): Record<string, string> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** A revoked row is never live; a retiring one only until `expires_at` (µs). */
export const isLiveCredential = (c: HttpCredential, nowUs = Date.now() * 1000): boolean =>
  c.state === "active" || (c.state === "retiring" && (c.expires_at ?? 0) > nowUs);

/** Drives the endpoint panel; every secret it reveals lives only in its own refs, never in a cache. */
export function useWorkflowHttpEndpoint(args: UseWorkflowHttpEndpointArgs) {
  const { workflowId, isDraftOnly, workflowEnabled, beforeCreate, context = "editor" } = args;
  const store = useStore();
  const queryClient = useQueryClient();
  const orgId = useOrgId();
  const id = computed(() => workflowId.value ?? "");

  const trigger = useQuery(() => workflowHttpTriggerQuery(orgId.value, id.value));
  const put = useMutation(() => putHttpTriggerMutation(orgId.value, id.value));
  const remove = useMutation(() => deleteHttpTriggerMutation(orgId.value, id.value));
  const rotation = useMutation(() => rotateHttpCredentialMutation(orgId.value, id.value));
  const revocation = useMutation(() => revokeHttpCredentialMutation(orgId.value, id.value));
  const reveal = useMutation(() => revealHttpCredentialSecretMutation(orgId.value, id.value));

  const revealedSecret = ref<string | null>(null);
  const revealedMode = ref<HttpAuthMode | null>(null);
  const revealKind = ref<RevealKind | null>(null);
  const endpointExists = ref(false);
  const revealedCredentials = ref<Record<string, string>>({});
  const revealing = ref<string | null>(null);
  const revealError = ref<Record<string, string>>({});
  const revoking = ref<string | null>(null);

  const state: ComputedRef<HttpTriggerState | undefined> = computed(() => trigger.data.value);
  const config = computed<HttpTriggerConfig | undefined>(() =>
    state.value?.configured ? state.value : undefined,
  );
  const permissions = computed(() => state.value?.permissions ?? NO_PERMISSIONS);
  const credentials = computed(() => config.value?.credentials ?? []);
  const liveCredentials = computed(() => credentials.value.filter((c) => isLiveCredential(c)));
  const activeCredential = computed(() => liveCredentials.value.find((c) => c.state === "active"));
  const retiringCredential = computed(() =>
    liveCredentials.value.find((c) => c.state === "retiring"),
  );

  // An unsaved workflow has no id to ask the server with, so the org role decides (request/organization/mod.rs).
  const mayCreateCredentials = computed(
    () =>
      store.state.zoConfig?.rbac_enabled === true ||
      CREDENTIAL_ROLES.has(String(store.state.currentuser?.role ?? "").toLowerCase()),
  );

  const status = computed<EndpointStatus | undefined>(() => {
    if (!workflowId.value) return "unsaved";
    if (!state.value) return undefined;
    if (!config.value) return "not_configured";
    if (!config.value.enabled) return "off";
    if (isDraftOnly.value) return "draft";
    if (workflowEnabled?.value === false) return "paused";
    return "on";
  });

  const phase = computed<EndpointPhase>(() => {
    if (!workflowId.value) return "unsaved";
    if (revealedSecret.value !== null) return "revealing";
    if (!state.value) return trigger.isError.value ? "error" : "loading";
    return config.value?.enabled ? "steady" : "off";
  });

  const chip = computed<"success" | "warning" | null>(() => {
    if (status.value === "on") return "success";
    if (status.value === "draft" || status.value === "paused") return "warning";
    return null;
  });

  const canTurnOn = computed(() => {
    if (!workflowId.value) return mayCreateCredentials.value;
    if (config.value) return permissions.value.edit;
    return permissions.value.edit && permissions.value.reveal;
  });

  const canRunTest = computed(
    () => !!config.value && permissions.value.edit && permissions.value.test,
  );

  const runTestHint = computed<I18nKey>(() =>
    context === "list" ? "workflow.http.runTestHintList" : "workflow.http.runTestHint",
  );

  const rotateBlocked = computed(() => !!retiringCredential.value);
  const canRotate = computed(
    () =>
      permissions.value.edit &&
      permissions.value.reveal &&
      !!activeCredential.value &&
      !rotateBlocked.value,
  );

  // reset() alone leaves the settled mutation, data included, in the MutationCache until its gcTime.
  const dropSecretMutations = () => {
    const cache = queryClient.getMutationCache();
    for (const m of cache.findAll({
      mutationKey: httpTriggerSecretMutationKey(orgId.value, id.value),
    })) {
      if (m.state.status !== "pending") cache.remove(m);
    }
  };

  const takeSecret = (
    secret: string | null,
    mode: HttpAuthMode,
    kind: RevealKind,
    reset: () => void,
  ) => {
    reset();
    dropSecretMutations();
    if (secret === null) return;
    revealedSecret.value = secret;
    revealedMode.value = mode;
    revealKind.value = kind;
  };

  const forgetRows = () => {
    revealedCredentials.value = {};
    revealError.value = {};
  };

  const endReveal = () => {
    revealedSecret.value = null;
    revealedMode.value = null;
    revealKind.value = null;
    endpointExists.value = false;
    forgetRows();
  };

  const fetchSecret = async (credentialId: string): Promise<string> => {
    try {
      return (await reveal.mutateAsync({ credential_id: credentialId })).secret;
    } finally {
      reveal.reset();
      dropSecretMutations();
    }
  };

  /** Refetches the endpoint; false when the read failed (the last good data stays on screen). */
  const refresh = async (): Promise<boolean> => {
    const result = await trigger.refetch();
    return !result.isError;
  };

  const revealCredential = async (credentialId: string) => {
    if (!permissions.value.reveal) return;
    revealing.value = credentialId;
    revealError.value = without(revealError.value, credentialId);
    try {
      const value = await fetchSecret(credentialId);
      revealedCredentials.value = { ...revealedCredentials.value, [credentialId]: value };
    } catch (err) {
      revealError.value = { ...revealError.value, [credentialId]: errorMessage(err) };
      if (errorStatus(err) === 404) void refresh();
    } finally {
      revealing.value = null;
    }
  };

  const hideCredential = (credentialId: string) => {
    revealedCredentials.value = without(revealedCredentials.value, credentialId);
  };

  /** Copies the shown value, else fetches one, copies it and keeps nothing; the caller toasts. */
  const copyCredential = async (credentialId: string): Promise<boolean> => {
    const value = revealedCredentials.value[credentialId] ?? (await fetchSecret(credentialId));
    return copyToClipboard(value, gt, { silent: true });
  };

  const putAndReveal = async (payload: PutHttpTriggerPayload, kind: RevealKind) => {
    const result = await put.mutateAsync(payload);
    takeSecret(result.secret, payload.auth_mode, kind, put.reset);
    return result;
  };

  const turnOn = async (mode: HttpAuthMode = "token") => {
    if (!workflowId.value) {
      if (!beforeCreate || !(await beforeCreate())) return;
      // Lets the mutation options pick up the id the editor assigned while saving the draft.
      await nextTick();
      if (!workflowId.value) return;
    }
    const existing = config.value;
    const result = await putAndReveal(
      { enabled: true, auth_mode: existing?.auth_mode ?? mode },
      "created",
    );
    endpointExists.value = !existing && result.secret === null;
  };

  const turnOff = async () => {
    const current = config.value;
    if (!current) return;
    await putAndReveal({ enabled: false, auth_mode: current.auth_mode }, "created");
  };

  const switchMode = async (mode: HttpAuthMode) => {
    const current = config.value;
    if (!current || current.auth_mode === mode) return;
    forgetRows();
    await putAndReveal({ enabled: current.enabled, auth_mode: mode }, "switched");
  };

  const saveLimits = async (limits: { max_body_bytes: number; rate_limit_per_minute: number }) => {
    const current = config.value;
    if (!current) return;
    await putAndReveal(
      { enabled: current.enabled, auth_mode: current.auth_mode, ...limits },
      "created",
    );
  };

  const rotate = async (overlapSeconds: OverlapSeconds) => {
    const current = config.value;
    if (!current || !canRotate.value) return;
    const result = await rotation.mutateAsync({ overlap_seconds: overlapSeconds });
    takeSecret(result.secret, current.auth_mode, "rotated", rotation.reset);
  };

  const revoke = async (credentialId: string) => {
    revoking.value = credentialId;
    try {
      await revocation.mutateAsync({ credential_id: credentialId });
      hideCredential(credentialId);
    } finally {
      revoking.value = null;
    }
  };

  const deleteEndpoint = async () => {
    await remove.mutateAsync();
    endReveal();
  };

  /** Dry run from the browser with the value on screen, else the active one fetched for this call only. */
  const sendTest = async (body: string = DEFAULT_SAMPLE_BODY): Promise<DryRunResult> => {
    const current = config.value;
    if (!current) throw new Error("no HTTP endpoint is configured");
    let mode = revealedMode.value ?? current.auth_mode;
    let secret = revealedSecret.value;
    if (secret === null) {
      const active = activeCredential.value;
      if (!active) throw new Error("no live credential");
      mode = current.auth_mode;
      secret = revealedCredentials.value[active.id] ?? (await fetchSecret(active.id));
    }
    return dryRunHook({
      url: current.url,
      auth: mode === "token" ? { mode, token: secret } : { mode, secret },
      body,
      contentType: "application/json",
    });
  };

  /** The Test dialog always runs the in-memory graph, so the seed is the latest HTTP input or the sample. */
  const runTest = (latestInput?: unknown[] | null): RunTestAction => {
    if (context === "list") return { kind: "open_workflow", hint: runTestHint.value };
    const seed = latestInput?.length ? latestInput : buildHttpRequestSample({ trigger_id: "test" });
    return { kind: "open_test", seed };
  };

  watch(orgId, endReveal);
  watch(workflowId, endReveal);
  // Keyed on the fetch settling, not dataUpdatedAt, which a refetch in the same millisecond leaves unchanged.
  watch(trigger.isFetching, (fetching, wasFetching) => {
    if (wasFetching && !fetching) revealedCredentials.value = {};
  });
  onScopeDispose(endReveal);

  return {
    state,
    config,
    phase,
    status,
    chip,
    permissions,
    credentials,
    liveCredentials,
    activeCredential,
    retiringCredential,
    storageWarning: computed(() => state.value?.secrets_encrypted_at_rest === false),
    canTurnOn,
    canRotate,
    canRunTest,
    runTestHint,
    rotateBlocked,
    endpointExists: readonly(endpointExists),
    revealedSecret: readonly(revealedSecret),
    revealKind: readonly(revealKind),
    revealActive: computed(() => revealedSecret.value !== null),
    revealedCredentials: readonly(revealedCredentials),
    revealing: readonly(revealing),
    revealError: readonly(revealError),
    revoking: readonly(revoking),
    saving: put.isPending,
    rotating: rotation.isPending,
    deleting: remove.isPending,
    loading: trigger.isPending,
    fetching: trigger.isFetching,
    revealCredential,
    hideCredential,
    copyCredential,
    turnOn,
    turnOff,
    switchMode,
    rotate,
    revoke,
    saveLimits,
    deleteEndpoint,
    sendTest,
    runTest,
    endReveal,
    refresh,
  };
}
