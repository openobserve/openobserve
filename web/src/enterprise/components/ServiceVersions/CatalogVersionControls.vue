<template>
  <div class="flex shrink-0 items-center gap-2" data-test="svcver-catalog-controls">
    <div class="w-36 shrink-0" data-test="svcver-env-filter-slot">
      <OSelect
        :searchable="false"
        :model-value="envDisabled ? null : env || null"
        class="w-full"
        data-test="svcver-env-filter"
        :disabled="envDisabled"
        @update:model-value="$emit('env', String($event || ''))"
      >
        <template #trigger>
          <span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
            ><span class="text-text-secondary shrink-0 text-xs">{{
              t("serviceVersions.catalog.env")
            }}</span
            ><OTruncatedText
              :class="envDisabled ? '' : 'text-select-text'"
              data-test="svcver-env-filter-value"
              >{{ envLabel }}</OTruncatedText
            ></span
          >
        </template>
        <OSelectItem
          :value="null"
          :label="t('serviceVersions.catalog.allEnvs')"
          data-test="svcver-env-option-all"
        >
          <span class="flex w-full items-center justify-between gap-3"
            >{{ t("serviceVersions.catalog.allEnvs")
            }}<span
              v-if="envTotal !== undefined"
              class="text-text-secondary tabular-nums"
              data-test="svcver-env-option-all-count"
              >{{ envTotal }}</span
            ></span
          >
        </OSelectItem>
        <OSeparator v-if="realEnvs.length" class="my-1" />
        <OSelectItem
          v-for="item in realEnvs"
          :key="item.env"
          :value="item.env"
          :label="raw(item.env)"
          :data-test="`svcver-env-option-${item.env}`"
        >
          <span class="flex w-full min-w-0 items-center justify-between gap-3"
            ><span class="min-w-0 truncate"
              >{{ item.env
              }}<span
                v-if="envFacts.get(item.env)?.inferred"
                class="text-text-secondary"
                :data-test="`svcver-env-option-${item.env}-inferred`"
                >{{ raw(" · ") }}{{ t("serviceVersions.env.inferred") }}</span
              ></span
            ><span
              class="text-text-secondary shrink-0 tabular-nums"
              :data-test="`svcver-env-option-${item.env}-count`"
              >{{ item.count }}</span
            ></span
          >
        </OSelectItem>
        <template v-if="noEnvCount">
          <OSeparator class="my-1" />
          <OSelectItem
            :value="NO_ENV"
            :label="t('serviceVersions.env.noEnv')"
            data-test="svcver-env-option-none"
          >
            <span class="flex w-full items-center justify-between gap-3"
              >{{ t("serviceVersions.env.noEnv")
              }}<span
                class="text-text-secondary tabular-nums"
                data-test="svcver-env-option-none-count"
                >{{ noEnvCount }}</span
              ></span
            >
          </OSelectItem>
        </template>
      </OSelect>
      <OTooltip v-if="envReason" :content="envReason" />
    </div>
    <div class="w-64 shrink-0" data-test="svcver-verdict-filter-slot">
      <OSelect
        :searchable="false"
        :model-value="filterDisabled ? null : verdict || null"
        class="w-full"
        :disabled="filterDisabled"
        data-test="svcver-verdict-filter"
        @update:model-value="$emit('verdict', String($event || ''))"
      >
        <template #trigger>
          <span class="flex min-w-0 flex-1 items-center gap-1.5"
            ><span class="text-text-secondary shrink-0 text-xs">{{
              t("serviceVersions.catalog.deployVerdict")
            }}</span
            ><span
              :class="['min-w-0 truncate', filterDisabled ? '' : 'text-select-text']"
              data-test="svcver-verdict-filter-value"
              >{{
                verdictOff
                  ? t("serviceVersions.catalog.disabled")
                  : verdict && !filterDisabled
                    ? label(verdict)
                    : t("serviceVersions.catalog.any")
              }}</span
            ></span
          >
        </template>
        <OSelectItem
          :value="null"
          :label="t('serviceVersions.catalog.any')"
          data-test="svcver-verdict-option-all"
        >
          <span class="flex w-full items-center justify-between gap-3"
            >{{ t("serviceVersions.catalog.any")
            }}<span class="text-text-secondary tabular-nums">{{ summary.total }}</span></span
          >
        </OSelectItem>
        <OSelectItem
          v-for="value in options"
          :key="value"
          :value="value"
          :label="label(value)"
          :disabled="!summary.counts[value] && verdict !== value"
          :data-test="`svcver-verdict-option-${value}`"
        >
          <span class="flex w-full items-center justify-between gap-3"
            >{{ label(value)
            }}<span class="text-text-secondary tabular-nums">{{
              summary.counts[value] || 0
            }}</span></span
          >
        </OSelectItem>
      </OSelect>
      <OTooltip v-if="verdictReason" :content="verdictReason" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Scope, ServicesResponse } from "@/services/service_versions";
import { identityQuery } from "@/services/service_versions.queries";
import { NO_ENV } from "@/services/service_versions.envs";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import {
  catalogExtraVerdictOptions,
  catalogSummary,
  catalogVerdictLabel,
  catalogVerdictOptions,
  type CatalogVerdictFilter,
} from "@/plugins/traces/servicesCatalogVersions";
const props = defineProps<{
  data?: ServicesResponse;
  scopes?: Scope[];
  state: "loading" | "locked" | "error" | "ready";
  env: string;
  verdict: string;
  // Spans that never carry an env cannot match any env or verdict, so both filters would empty the table.
  noEnvStamps?: boolean;
  // From the selected stream's last complete load; absent while its first load runs.
  envCounts?: Map<string, number>;
  // The stream has no spans in the range, a different reason from spans that carry no env.
  noSpans?: boolean;
  // Rows of that same load; an env-scoped row can count under several envs, so the counts cannot sum to it.
  envTotal?: number;
}>();
defineEmits<{ env: [string]; verdict: [string] }>();
const { t } = useI18nTyped();
const store = useStore();
const org = computed(() => String(store?.state?.selectedOrganization?.identifier || ""));
// Read only for the inferred marker; its counts are org-wide, not the stream's.
const envsRead = useQuery(
  computed(() => ({
    ...identityQuery(org.value, String(store?.state?.userInfo?.email || ""), "identityEnvs"),
    enabled: props.state === "ready" && Boolean(org.value),
  })),
);
const envFacts = computed(
  () =>
    new Map(
      (envsRead.isError.value ? [] : envsRead.data.value?.envs || [])
        .filter((item) => !item.no_env)
        .map((item) => [item.env, item]),
    ),
);
const realEnvs = computed(() =>
  [...(props.envCounts || [])]
    .filter(([env]) => env && env !== NO_ENV)
    .map(([env, count]) => ({ env, count }))
    .sort((a, b) => a.env.localeCompare(b.env)),
);
const noEnvCount = computed(() => props.envCounts?.get(NO_ENV) || 0);
// Both filters wait for the stream's rows, so neither offers zero counts mid-load and then turns off.
const rowsMissing = computed(() => !props.envCounts || props.noSpans || props.noEnvStamps);
const envDisabled = computed(() => props.state !== "ready" || rowsMissing.value);
const rowsReason = computed(() => {
  if (props.noSpans) return t("serviceVersions.catalog.noSpansInRange");
  return props.noEnvStamps ? t("serviceVersions.catalog.noEnvStamps") : "";
});
const summary = computed(() => catalogSummary(props.data, props.env, props.scopes));
const filterUnavailable = computed(
  () => props.state !== "ready" || props.data?.verdict_status === "unavailable",
);
const filterDisabled = computed(() => filterUnavailable.value || rowsMissing.value);
// A loading filter keeps its placeholder; "Disabled" is only for a verdict that will not come.
const verdictOff = computed(() => props.state !== "loading" && filterUnavailable.value);
const envReason = computed(() => (props.state === "ready" ? rowsReason.value : ""));
const verdictReason = computed(() =>
  props.state === "error" ||
  (props.state === "ready" && props.data?.verdict_status === "unavailable")
    ? t("serviceVersions.catalog.unavailable")
    : envReason.value,
);
// Rare states stay out of the menu until a scope actually has them, so the default list matches the design.
const options = computed<CatalogVerdictFilter[]>(() => [
  ...catalogVerdictOptions,
  ...catalogExtraVerdictOptions.filter(
    (value) => summary.value.counts[value] || props.verdict === value,
  ),
]);
// The trigger already says Env, so it names the pick as plain text rather than a keyed chip.
const envLabel = computed(() => {
  if (!props.env || envDisabled.value) return t("serviceVersions.catalog.allEnvs");
  return props.env === NO_ENV ? t("serviceVersions.env.noEnv") : raw(props.env);
});
const label = (value: string) => catalogVerdictLabel(value, t);
</script>
