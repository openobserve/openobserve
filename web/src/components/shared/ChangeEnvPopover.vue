<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <OPopover
    v-model:open="open"
    :aria-label="t('serviceVersions.envEdit.title')"
    :side-offset="sideOffset ?? POPOVER_GAP"
    content-class="w-[27rem]"
  >
    <template #trigger><slot /></template>
    <div class="flex flex-col px-4 py-3.5 text-sm" data-test="svcver-env-popover" @click.stop>
      <div class="flex items-center gap-2">
        <span class="text-text-heading font-semibold">{{
          t("serviceVersions.envEdit.title")
        }}</span>
        <span class="text-text-secondary min-w-0 truncate text-xs">{{ service || whereText }}</span>
        <OButton
          class="ms-auto"
          variant="ghost"
          size="xs"
          icon-left="close"
          :aria-label="t('common.close')"
          data-test="svcver-env-close"
          @click="open = false"
        />
      </div>
      <div class="mt-1.5 mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span class="text-text-secondary">{{ t("serviceVersions.envEdit.now") }}</span>
        <ODimensionChip
          dim-key="env"
          :key-label="t('serviceVersions.compare.envChip')"
          :value="identity.no_env ? t('serviceVersions.env.noEnv') : identity.env"
          :variant="identity.no_env ? 'default-soft' : 'success-soft'"
          :muted="identity.no_env"
          :value-tooltip="false"
        />
        <span class="text-text-secondary">{{ sentence }}</span>
      </div>
      <div
        v-if="readOnly"
        class="text-text-secondary rounded-default bg-surface-panel border-border-default border px-3 py-2"
        data-test="svcver-env-readonly"
      >
        {{ t("serviceVersions.envEdit.readonly") }}
      </div>
      <div v-else-if="loading" class="flex flex-col gap-2" data-test="svcver-env-loading">
        <OSkeleton class="h-8 w-full" />
        <OSkeleton class="h-24 w-full" />
      </div>
      <div
        v-else-if="loadFailed"
        class="text-text-secondary flex items-center gap-2"
        data-test="svcver-env-load-error"
      >
        <span>{{ t("serviceVersions.envEdit.loadError") }}</span>
        <OButton variant="ghost-primary" size="xs" @click="reload">{{
          t("serviceVersions.actions.retry")
        }}</OButton>
      </div>
      <div v-else class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-text-secondary text-xs font-medium">{{
            t("serviceVersions.envEdit.appliesTo")
          }}</span>
          <OSelect v-model="scope" :searchable="false" data-test="svcver-env-scope">
            <OSelectItem
              v-for="option in scopes"
              :key="option.value"
              :value="option.value"
              :label="option.label"
              :data-test="`svcver-env-scope-${option.value}`"
            />
          </OSelect>
          <span v-if="hint" class="text-text-secondary text-xs">{{ hint }}</span>
        </div>
        <div
          class="rounded-default bg-surface-panel border-border-default border px-3 py-2 text-[0.8125rem]"
          data-test="svcver-env-impact"
        >
          <div>
            <b class="text-text-heading">{{ impactCounts }}</b>
            {{ t("serviceVersions.envEdit.impactTail") }}
          </div>
          <div class="text-text-secondary mt-0.5">
            {{ t("serviceVersions.envEdit.impactNote") }}
          </div>
          <div
            v-for="row in shadowing"
            :key="row.rule_key"
            class="text-status-warning-text mt-0.5"
            data-test="svcver-env-shadow"
          >
            {{
              t("serviceVersions.envEdit.shadow.replaces", {
                scope: ruleScope(row),
                env: row.value,
              })
            }}
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-text-secondary text-xs font-medium">{{
            t("serviceVersions.envEdit.setTo")
          }}</span>
          <div
            class="rounded-default border-border-default flex flex-col border p-1"
            role="listbox"
          >
            <button
              v-for="row in rows"
              :key="row.env"
              type="button"
              role="option"
              :aria-selected="row.current"
              :disabled="row.current || busy"
              :class="[
                'rounded-default flex items-center justify-between gap-3 px-2 py-1.5 text-start',
                row.current ? 'opacity-55' : 'hover:bg-dropdown-item-hover-bg cursor-pointer',
              ]"
              :data-test="`svcver-env-option-${row.env}`"
              @click="apply(row.env)"
            >
              <ODimensionChip
                dim-key="env"
                :key-label="t('serviceVersions.compare.envChip')"
                :value="row.env"
                variant="success-soft"
                :value-tooltip="false"
              />
              <span class="text-text-secondary text-xs tabular-nums">{{ row.note }}</span>
            </button>
            <OSeparator class="my-1" />
            <form
              v-if="adding"
              class="flex flex-col gap-1 px-1 py-1"
              data-test="svcver-env-new-form"
              @submit.prevent="submitNew"
            >
              <OInput
                v-model="newValue"
                size="sm"
                autofocus
                :placeholder="t('serviceVersions.envEdit.newPlaceholder')"
                :error="Boolean(newError)"
                :error-message="newError"
                :disabled="busy"
                data-test="svcver-env-new-input"
              />
            </form>
            <button
              v-else
              type="button"
              class="text-text-link hover:bg-dropdown-item-hover-bg rounded-default flex cursor-pointer items-center justify-between gap-3 px-2 py-1.5 text-start"
              data-test="svcver-env-new"
              :disabled="busy"
              @click="adding = true"
            >
              <span class="flex items-center gap-1"
                ><OIcon name="add" size="xs" />{{ t("serviceVersions.envEdit.new") }}</span
              >
              <span class="text-text-secondary text-xs">{{
                t("serviceVersions.envEdit.newHint")
              }}</span>
            </button>
          </div>
        </div>
        <div
          v-if="error"
          class="text-status-error-text text-xs"
          role="alert"
          data-test="svcver-env-error"
        >
          {{ error }}
        </div>
      </div>
      <div class="text-text-secondary mt-2.5 text-xs">
        {{ t("serviceVersions.envEdit.footer") }}
      </div>
    </div>
  </OPopover>
  <Teleport to="body">
    <div
      v-if="undo"
      class="rounded-default shadow-toast bg-toast-default-bg border-toast-default-border text-toast-fg pointer-events-auto fixed bottom-6 left-1/2 z-10001 flex -translate-x-1/2 items-center gap-3 border px-4 py-2.5 text-sm whitespace-nowrap"
      role="status"
      data-test="svcver-env-undo-bar"
    >
      <span>{{ undo.error || undo.message }}</span>
      <OButton
        v-if="undo.canUndo && !undo.error"
        variant="ghost-primary"
        size="xs"
        :loading="undo.busy"
        data-test="svcver-env-undo"
        @click="runUndo"
        >{{ t("serviceVersions.envEdit.undo") }}</OButton
      >
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="svcver-env-view-overrides"
        @click="viewOverrides"
        >{{ t("serviceVersions.envEdit.viewOverrides") }}</OButton
      >
    </div>
  </Teleport>
</template>

<script lang="ts">
import type {
  Environment,
  IdentityOverride,
  OverrideWrite,
  PutOverrideResponse,
} from "@/services/service_versions";
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import { formatDeployTime, isOutsideK8s } from "@/utils/serviceVersionsCopy";
import { isAxiosError } from "axios";

export type EnvScope = OverrideWrite["scope"];
const SENTENCE_SOURCES = [
  "attribute",
  "namespace",
  "cluster",
  "workload",
  "cluster_name",
  "namespace_name",
  "default",
  "rum",
];
const FALLBACK_SOURCES = ["cluster_name", "namespace_name", "default"];
export const ENV_LABEL = /^[A-Za-z0-9._-]{1,128}$/;
// The org holds at most 1000 overrides, so one page sees every rule that can apply to a chip.
export const CHIP_OVERRIDES_PARAMS = { limit: 1000 };
export const SCOPE_RANK: Record<EnvScope, number> = { service: 0, where: 1, cluster: 2 };

export function envKind(source: string | undefined, t: TranslateFn): string {
  if (!source) return "";
  return SENTENCE_SOURCES.includes(source) || source === "override"
    ? t(`serviceVersions.envEdit.kind.${source}` as I18nKey)
    : source;
}

// The override row carries who/when; the chip's Environment only names its rule key.
export function envSourceSentence(
  identity: Environment,
  t: TranslateFn,
  timezone: string,
  row?: IdentityOverride | null,
): string {
  const source = identity.env_source;
  // No env never quotes a stored "default", and says "outside Kubernetes" only when its where has no K8s place.
  if (identity.no_env && source !== "override")
    return isOutsideK8s(identity.where_key, identity.where)
      ? t("serviceVersions.envEdit.source.default")
      : t("serviceVersions.envEdit.source.defaultInPlace");
  if (source === "override")
    return row
      ? t("serviceVersions.envEdit.source.override", {
          who: row.updated_by || row.created_by,
          date: formatDeployTime(row.updated_at, Date.now(), timezone),
        })
      : t("serviceVersions.envEdit.source.overrideUnknown");
  if (!SENTENCE_SOURCES.includes(source))
    return t("serviceVersions.envEdit.source.attribute", {
      attribute: source,
      value: identity.env,
    });
  if (source === "attribute")
    return t("serviceVersions.envEdit.source.attribute", attributeParts(identity));
  // A name fallback's env is the name itself, so it stands in when the producer sends no value.
  const fallback = FALLBACK_SOURCES.includes(source) ? identity.env : "";
  return t(`serviceVersions.envEdit.source.${source}` as I18nKey, {
    value: identity.env_source_value || fallback,
  });
}

// The producer sends "key=value"; the sentence names the attribute and its value in words, never the raw pair.
function attributeParts(identity: Environment) {
  const raw = identity.env_source_value || "";
  const split = raw.indexOf("=");
  const key = split < 0 ? raw : raw.slice(0, split);
  return {
    attribute: !key || key === "deployment.environment.name" ? "deployment.environment" : key,
    value: split < 0 ? identity.env : raw.slice(split + 1),
  };
}

export function envDetectedLine(identity: Environment, t: TranslateFn): string {
  if (!overrideDetected(identity)) return "";
  return t("serviceVersions.envEdit.detectedLine", {
    env: identity.env_inferred,
    kind: envKind(identity.env_inferred_source, t),
  });
}

// An override over a scope where nothing was inferred has no detected env to offer back.
export function overrideDetected(identity: Environment) {
  return identity.env_source === "override" && identity.env_inferred_source !== "default"
    ? identity.env_inferred || ""
    : "";
}

export function envWhereLine(identity: Environment, t: TranslateFn): string {
  const where = identity.where;
  if (where?.kind === "k8s")
    return where.k8s_cluster
      ? t("serviceVersions.envEdit.where.k8s", {
          cluster: where.k8s_cluster,
          namespace: where.k8s_namespace,
        })
      : t("serviceVersions.envEdit.where.noCluster", { namespace: where.k8s_namespace });
  if (isOutsideK8s(identity.where_key, where)) return t("serviceVersions.envEdit.where.none");
  return t("serviceVersions.envEdit.where.flat", { where: flatWhere(identity.where_key) });
}

export const POPOVER_GAP = 4;

export function belowRowOffset(trigger: Element | null) {
  const row = trigger?.closest("tr");
  if (!trigger || !row) return POPOVER_GAP;
  const gap = row.getBoundingClientRect().bottom - trigger.getBoundingClientRect().bottom;
  return Math.max(0, Math.ceil(gap)) + POPOVER_GAP;
}

export function flatWhere(whereKey: string) {
  return whereKey.replace(/^[a-z0-9_]+:/, "") || whereKey;
}

export function overrideWrite(row: IdentityOverride): OverrideWrite {
  return {
    scope: row.scope,
    where_key: row.where_key,
    k8s_cluster: row.k8s_cluster,
    service_name: row.service_name,
    value: row.value,
  };
}

// Maps the PUT/DELETE error bodies as built to copy; 403 is handled by the caller.
export function overrideErrorKey(error: unknown): I18nKey {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  const data = isAxiosError(error) ? error.response?.data : undefined;
  const message = String(data?.error ?? data?.message ?? "").toLowerCase();
  if (status === 503) return "serviceVersions.envEdit.errors.unavailable";
  if (status === 404) return "serviceVersions.envEdit.errors.notFound";
  if (status === 400 && message.includes("limit")) return "serviceVersions.envEdit.errors.limit";
  if (status === 400 && message.includes("scope")) return "serviceVersions.envEdit.errors.scope";
  if (status === 400 && message.includes("value"))
    return "serviceVersions.envEdit.errors.invalidValue";
  return "serviceVersions.envEdit.errors.generic";
}

export function isDenied(error: unknown) {
  return isAxiosError(error) && error.response?.status === 403;
}

// Live rules that apply to one chip, narrowest first, in the resolver's service > where > cluster order.
export function chipChain(
  rows: IdentityOverride[],
  identity: Environment,
  service: string,
): IdentityOverride[] {
  const cluster = identity.where?.kind === "k8s" ? identity.where.k8s_cluster : "";
  return rows
    .filter(
      (row) =>
        !row.deleted_at &&
        (row.rule_key === identity.override_key ||
          (row.scope === "service" &&
            row.where_key === identity.where_key &&
            row.service_name === service) ||
          (row.scope === "where" && row.where_key === identity.where_key) ||
          (row.scope === "cluster" && Boolean(cluster) && row.k8s_cluster === cluster)),
    )
    .sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]);
}

export interface EnvPlan {
  put: OverrideWrite | null;
  remove: IdentityOverride[];
  blockedBy: IdentityOverride | null;
}

// The chip must end on the picked label: narrower rules would shadow the write, broader ones outlive a detection restore.
export function envPlan(
  chain: IdentityOverride[],
  write: OverrideWrite,
  restoreDetected: boolean,
): EnvPlan {
  const rank = SCOPE_RANK[write.scope];
  if (!restoreDetected)
    return {
      put: write,
      remove: chain.filter((row) => SCOPE_RANK[row.scope] < rank),
      blockedBy: null,
    };
  const blockedBy = chain.find((row) => SCOPE_RANK[row.scope] > rank) ?? null;
  const remove = blockedBy ? [] : chain.filter((row) => SCOPE_RANK[row.scope] <= rank);
  return { put: blockedBy || remove.length ? null : write, remove, blockedBy };
}

export interface RuleSnapshot {
  key: OverrideWrite;
  before: IdentityOverride | null;
  remove: boolean;
  // Unset: not sent yet; "unknown": failed, so it may have committed; else the row the server confirmed, null when gone.
  wrote?: IdentityOverride | null | "unknown";
}

export interface RestoreSteps {
  put: OverrideWrite[];
  remove: string[];
  uncertain: number;
}

export interface UndoState {
  message: I18nText | string;
  snapshot: RuleSnapshot[];
  canUndo: boolean;
  busy: boolean;
  error: string;
}

// The rule key hashes exactly these four fields, so equal fields mean the same rule.
export function sameRule(row: IdentityOverride, key: OverrideWrite) {
  return (
    row.scope === key.scope &&
    row.where_key === key.where_key &&
    row.k8s_cluster === key.k8s_cluster &&
    row.service_name === key.service_name
  );
}

// The rows come from a fresh server read, so a write target absent from them had no live rule.
export function planSnapshot(plan: EnvPlan, rows: IdentityOverride[]): RuleSnapshot[] {
  const target = plan.put;
  const live = rows.filter((row) => !row.deleted_at);
  return [
    ...(target
      ? [{ key: target, before: live.find((row) => sameRule(row, target)) ?? null, remove: false }]
      : []),
    ...plan.remove.map((row) => ({ key: overrideWrite(row), before: row, remove: true })),
  ];
}

// Every write stamps updated_at, so an equal value and stamp mean nobody rewrote the rule since.
export function sameState(now: IdentityOverride | null, then: IdentityOverride | null) {
  if (!now || !then) return now === then;
  return now.value === then.value && now.updated_at === then.updated_at;
}

// Undo only what this client wrote: another writer's row matches neither the snapshot nor our write.
export function ruleState(rule: RuleSnapshot, now: IdentityOverride | null, user: string) {
  if (rule.wrote === undefined || sameState(now, rule.before)) return "before";
  if (rule.wrote !== "unknown") return sameState(now, rule.wrote) ? "ours" : "other";
  if (rule.remove) return now ? "other" : "ours";
  const ours =
    now?.value === rule.key.value &&
    now.updated_by.toLowerCase() === user.toLowerCase() &&
    now.updated_at > (rule.before?.updated_at ?? -Infinity);
  return ours ? "ours" : "other";
}

export function restoreSteps(
  snapshot: RuleSnapshot[],
  rows: IdentityOverride[],
  user: string,
): RestoreSteps {
  const live = rows.filter((row) => !row.deleted_at);
  const steps: RestoreSteps = { put: [], remove: [], uncertain: 0 };
  for (const rule of snapshot) {
    const now = live.find((row) => sameRule(row, rule.key)) ?? null;
    const state = ruleState(rule, now, user);
    if (state === "other") steps.uncertain += 1;
    else if (state === "ours" && rule.before) steps.put.push(overrideWrite(rule.before));
    else if (state === "ours" && now) steps.remove.push(now.rule_key);
  }
  return steps;
}

// Read-only check after a failed restore step, which may itself have committed.
export function restored(snapshot: RuleSnapshot[], rows: IdentityOverride[], user: string) {
  const live = rows.filter((row) => !row.deleted_at);
  return snapshot.every(({ key, before, wrote }) => {
    if (wrote === undefined) return true;
    const now = live.find((row) => sameRule(row, key)) ?? null;
    if (!now || !before) return now === before;
    return (
      now.value === before.value &&
      (now.updated_at === before.updated_at || now.updated_by.toLowerCase() === user.toLowerCase())
    );
  });
}

export function undoStateFor(message: string, snapshot: RuleSnapshot[] = []): UndoState {
  return { message, snapshot, canUndo: snapshot.length > 0, busy: false, error: "" };
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import versionsService from "@/services/service_versions";
import {
  deleteOverrideMutation,
  identityQuery,
  putOverrideMutation,
} from "@/services/service_versions.queries";
import { serviceVersionKeys } from "@/services/service_versions.querykeys";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

const UNDO_MS = 10_000;
const props = defineProps<{ identity: Environment; service?: string; sideOffset?: number }>();
const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const queryClient = useQueryClient();
const org = computed(() => String(store.state.selectedOrganization?.identifier || ""));
const user = computed(() => String(store.state.userInfo?.email || ""));
const timezone = computed(() => String(store.state.timezone || "UTC"));
const open = ref(false);
const scope = ref<EnvScope>("where");
const adding = ref(false);
const newValue = ref("");
const newError = ref<I18nText>();
const error = ref("");
const busy = ref(false);
const denied = ref(false);
const undo = ref<UndoState | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

// One read serves the org's labels, the scope counts and can_edit (Contract item 3).
const envs = useQuery(
  computed(() => ({
    ...identityQuery(org.value, user.value, "identityEnvs", {
      where: props.identity.where_key,
      ...(props.service ? { service: props.service } : {}),
    }),
    enabled: open.value && Boolean(org.value && props.identity.where_key),
  })),
);
// Only a chip with an applied override can have rules in its chain, so the others skip the read.
const needsChain = computed(() => Boolean(props.identity.override_key));
const overrides = useQuery(
  computed(() => ({
    ...identityQuery(org.value, user.value, "identityOverrides", CHIP_OVERRIDES_PARAMS),
    enabled: open.value && Boolean(org.value) && needsChain.value,
  })),
);
const put = useMutation(() => putOverrideMutation(org.value));
const remove = useMutation(() => deleteOverrideMutation(org.value));

const k8sCluster = computed(() =>
  props.identity.where?.kind === "k8s" ? props.identity.where.k8s_cluster : "",
);
const namespace = computed(() => props.identity.where?.k8s_namespace || "");
const whereText = computed(() => envWhereLine(props.identity, t));
const overrideRow = computed(() =>
  overrides.data.value?.overrides.find((row) => row.rule_key === props.identity.override_key),
);
const chipService = computed(
  () =>
    props.service || (overrideRow.value?.scope === "service" ? overrideRow.value.service_name : ""),
);
const chain = computed(() =>
  chipChain(overrides.data.value?.overrides || [], props.identity, chipService.value),
);
const sentence = computed(() =>
  envSourceSentence(props.identity, t, timezone.value, overrideRow.value),
);
const loading = computed(
  () => envs.isPending.value || (needsChain.value && overrides.isPending.value),
);
const loadFailed = computed(
  () => envs.isError.value || (needsChain.value && overrides.isError.value),
);
const detected = computed(() => overrideDetected(props.identity));
const readOnly = computed(
  () => denied.value || envs.data.value?.can_edit === false || isDenied(envs.error.value),
);
const counts = computed(() => envs.data.value?.scope_counts);
const scopes = computed(() => {
  const where = props.identity.where;
  const whereLabel = isOutsideK8s(props.identity.where_key, where)
    ? t("serviceVersions.envEdit.scope.whereNone")
    : where?.kind !== "k8s"
      ? t("serviceVersions.envEdit.scope.whereFlat", { where: flatWhere(props.identity.where_key) })
      : k8sCluster.value
        ? t("serviceVersions.envEdit.scope.where", {
            namespace: namespace.value,
            cluster: k8sCluster.value,
          })
        : t("serviceVersions.envEdit.scope.whereNoCluster", { namespace: namespace.value });
  const list: { value: EnvScope; label: I18nText }[] = [{ value: "where", label: whereLabel }];
  if (chipService.value)
    list.push({
      value: "service",
      label: t("serviceVersions.envEdit.scope.service", { service: chipService.value }),
    });
  if (k8sCluster.value && counts.value?.cluster !== undefined)
    list.push({
      value: "cluster",
      label: t("serviceVersions.envEdit.scope.cluster", { cluster: k8sCluster.value }),
    });
  return list;
});
const hint = computed(() => {
  const widen = scopes.value.some((option) => option.value === "cluster");
  const narrow = Boolean(chipService.value);
  if (widen && narrow)
    return t("serviceVersions.envEdit.hint.both", {
      cluster: k8sCluster.value,
      service: chipService.value,
    });
  if (widen) return t("serviceVersions.envEdit.hint.widen", { cluster: k8sCluster.value });
  return narrow ? t("serviceVersions.envEdit.hint.narrow", { service: chipService.value }) : "";
});
const shadowing = computed(() =>
  chain.value.filter((row) => SCOPE_RANK[row.scope] < SCOPE_RANK[scope.value]),
);
// A server without scope_versions still gets the services count alone.
const impactCounts = computed(() => {
  const services =
    scope.value === "service" ? (counts.value?.service ?? 1) : (counts.value?.[scope.value] ?? 0);
  const label = t("serviceVersions.envEdit.impactServices", { n: services }, services);
  const versions = envs.data.value?.scope_versions?.[scope.value];
  if (versions === undefined) return label;
  return `${label} · ${t("serviceVersions.envEdit.impactVersions", { n: versions }, versions)}`;
});
const rows = computed(() => {
  // No env is an absence, never a label to set, so it is neither an option nor a current row.
  const list = (envs.data.value?.envs || [])
    .filter((row) => !row.no_env)
    .sort((a, b) => b.services - a.services || a.env.localeCompare(b.env));
  const current = props.identity.no_env ? "" : props.identity.env;
  const detectedEnv = detected.value;
  if (detectedEnv && detectedEnv !== current && !list.some((row) => row.env === detectedEnv))
    list.push({ env: detectedEnv, services: 0, wheres: 0, sources: [] });
  const currentRow = list.find((row) => row.env === current);
  const ordered = [
    ...(currentRow
      ? [currentRow]
      : current
        ? [{ env: current, services: 0, wheres: 0, sources: [] }]
        : []),
    ...list.filter((row) => row.env !== current),
  ];
  return ordered.map((row) => {
    const isCurrent = row.env === current;
    const kind =
      row.sources.length === 1 && FALLBACK_SOURCES.includes(row.sources[0])
        ? ` · ${envKind(row.sources[0], t)}`
        : "";
    const marker = row.env === detectedEnv ? ` · ${t("serviceVersions.envEdit.detected")}` : "";
    return {
      env: row.env,
      current: isCurrent,
      note: isCurrent
        ? t("serviceVersions.envEdit.current", { n: row.services }, row.services)
        : `${t("serviceVersions.envEdit.orgServices", { n: row.services }, row.services)}${kind}${marker}`,
    };
  });
});

let scopeSeeded = false;
// The popover edits the rule that controls the chip, so it opens at that rule's scope.
function seedScope() {
  if (scopeSeeded || !open.value || !envs.data.value || (needsChain.value && !overrides.data.value))
    return;
  scopeSeeded = true;
  const scoped = overrideRow.value?.scope;
  if (scoped && scopes.value.some((option) => option.value === scoped)) scope.value = scoped;
}
watch(open, (value) => {
  if (!value) return;
  scopeSeeded = false;
  scope.value = "where";
  seedScope();
  adding.value = false;
  newValue.value = "";
  newError.value = undefined;
  error.value = "";
});
watch([() => overrides.data.value, () => envs.data.value], seedScope);
watch(newValue, () => {
  newError.value = undefined;
});
onBeforeUnmount(() => clearTimeout(undoTimer));

function reload() {
  void envs.refetch();
  if (needsChain.value) void overrides.refetch();
}

function writeFor(value: string): OverrideWrite {
  return {
    scope: scope.value,
    where_key: scope.value === "cluster" ? "" : props.identity.where_key,
    k8s_cluster: k8sCluster.value,
    service_name: scope.value === "service" ? chipService.value : "",
    value,
  };
}

function toastScope(body: OverrideWrite) {
  if (body.scope === "cluster")
    return t("serviceVersions.envEdit.toastScope.cluster", { cluster: body.k8s_cluster });
  const outside = isOutsideK8s(props.identity.where_key, props.identity.where);
  if (outside && body.scope === "service")
    return t("serviceVersions.envEdit.toastScope.serviceOutside", { service: body.service_name });
  const where = outside
    ? t("serviceVersions.envEdit.toastScope.whereNone")
    : props.identity.where?.kind !== "k8s"
      ? t("serviceVersions.envEdit.toastScope.whereFlat", {
          where: flatWhere(props.identity.where_key),
        })
      : k8sCluster.value
        ? t("serviceVersions.envEdit.toastScope.where", {
            namespace: namespace.value,
            cluster: k8sCluster.value,
          })
        : t("serviceVersions.envEdit.toastScope.whereNoCluster", { namespace: namespace.value });
  return body.scope === "service"
    ? t("serviceVersions.envEdit.toastScope.service", { service: body.service_name, where })
    : where;
}

function showUndo(state: UndoState) {
  clearTimeout(undoTimer);
  undo.value = state;
  undoTimer = setTimeout(() => {
    undo.value = null;
  }, UNDO_MS);
}

function ruleScope(row: IdentityOverride) {
  return toastScope(overrideWrite(row));
}

// The listed rows carry affected counts; the DELETE response does not.
function restoreMessage(removed: IdentityOverride[]) {
  const broadest = removed[removed.length - 1];
  const n = Math.max(0, ...removed.map((row) => row.affected?.services ?? 0));
  return savedMessage(detected.value, n, overrideWrite(broadest));
}

// A service-scoped rule names the service and its place once, never "1 service in <service> in <place>".
function savedMessage(env: string, n: number, body: OverrideWrite) {
  const outside =
    body.scope !== "cluster" && isOutsideK8s(props.identity.where_key, props.identity.where);
  if (outside && body.scope === "service")
    return t("serviceVersions.envEdit.savedServiceOutside", { env, service: body.service_name });
  if (outside) return t("serviceVersions.envEdit.savedOutside", { env, n }, n);
  if (body.scope !== "service")
    return t("serviceVersions.envEdit.saved", { env, n, scope: toastScope(body) }, n);
  const where = toastScope({ ...body, scope: "where" });
  return t("serviceVersions.envEdit.savedService", { env, service: body.service_name, where });
}

// A direct read, not the cache: a refetch started before a later write would miss that write's commit.
async function freshOverrides() {
  const { data } = await versionsService.identityOverrides(org.value, CHIP_OVERRIDES_PARAMS);
  return data.overrides;
}

// Restores only rules still holding this client's write; true when the server is back at the snapshot.
async function reconcile(snapshot: RuleSnapshot[]) {
  try {
    const steps = restoreSteps(snapshot, await freshOverrides(), user.value);
    try {
      for (const body of steps.put) await put.mutateAsync(body);
      for (const ruleKey of steps.remove) await remove.mutateAsync(ruleKey);
    } catch {
      return restored(snapshot, await freshOverrides(), user.value) && !steps.uncertain;
    }
    return !steps.uncertain;
  } catch {
    return false;
  } finally {
    // Writes invalidate only on success, and a failed one may still have committed.
    void queryClient.invalidateQueries({ queryKey: serviceVersionKeys.all(org.value) });
  }
}

function partlyChanged(snapshot: RuleSnapshot[]) {
  const state = undoStateFor("", snapshot);
  state.canUndo = false;
  state.error = t("serviceVersions.envEdit.partlyChanged");
  return state;
}

// The plan and its snapshot come from one fresh read taken right before the first write.
async function runPlan(write: OverrideWrite, restoreDetected: boolean, value: string) {
  let serverRows: IdentityOverride[];
  try {
    serverRows = await freshOverrides();
  } catch (failure) {
    return { state: null, failure };
  }
  const plan = envPlan(
    chipChain(serverRows, props.identity, chipService.value),
    write,
    restoreDetected,
  );
  if (plan.blockedBy) return { state: null, failure: undefined, blockedBy: plan.blockedBy };
  let result: PutOverrideResponse | null = null;
  const snapshot = planSnapshot(plan, serverRows);
  try {
    for (const rule of snapshot) {
      rule.wrote = "unknown";
      if (rule.remove && rule.before) {
        // The server's removed row is the authoritative pre-write state.
        rule.before = (await remove.mutateAsync(rule.before.rule_key)).removed;
        rule.wrote = null;
      } else {
        result = await put.mutateAsync(rule.key);
        rule.before = result.previous;
        rule.wrote = result.removed ? null : result.override;
      }
    }
  } catch (failure) {
    return { state: (await reconcile(snapshot)) ? null : partlyChanged(snapshot), failure };
  }
  const n = result?.affected?.services ?? 0;
  const message =
    result && plan.put ? savedMessage(value, n, plan.put) : restoreMessage(plan.remove);
  return { state: undoStateFor(message, snapshot), failure: undefined };
}

async function apply(value: string) {
  if (busy.value || readOnly.value || value === (props.identity.no_env ? "" : props.identity.env))
    return;
  error.value = "";
  busy.value = true;
  const restoreDetected = Boolean(detected.value) && value === detected.value;
  const { state, failure, blockedBy } = await runPlan(writeFor(value), restoreDetected, value);
  busy.value = false;
  if (blockedBy) {
    error.value = t("serviceVersions.envEdit.shadow.broader", {
      scope: ruleScope(blockedBy),
      env: blockedBy.value,
    });
    return;
  }
  if (state) showUndo(state);
  if (failure === undefined) {
    open.value = false;
    return;
  }
  if (isDenied(failure)) denied.value = true;
  else error.value = t(overrideErrorKey(failure));
}

function submitNew() {
  const value = newValue.value.trim();
  if (!ENV_LABEL.test(value)) {
    newError.value = t("serviceVersions.envEdit.invalid");
    return;
  }
  void apply(value);
}

async function runUndo() {
  const state = undo.value;
  if (!state || state.busy) return;
  state.busy = true;
  clearTimeout(undoTimer);
  try {
    if (await reconcile(state.snapshot)) undo.value = null;
    else showUndo(partlyChanged(state.snapshot));
  } finally {
    state.busy = false;
  }
}

function viewOverrides() {
  undo.value = null;
  void router.push({
    name: "correlationSettings",
    params: { tab: "env-versions" },
    query: { org_identifier: org.value },
  });
}

defineExpose({ open });
</script>
