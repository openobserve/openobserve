<template>
  <div class="flex min-w-64 shrink items-center gap-2" data-test="svcver-catalog-controls">
    <div class="w-44 min-w-24 shrink" data-test="svcver-env-filter-slot">
      <OSelect
        :searchable="false"
        :model-value="env || null"
        class="w-full"
        data-test="svcver-env-filter"
        :disabled="state !== 'ready'"
        @update:model-value="$emit('env', String($event || ''))"
      >
        <template #trigger>
          <span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
            ><span class="text-text-secondary shrink-0 text-xs">{{
              t("serviceVersions.catalog.env")
            }}</span
            ><span v-if="envIdentity" class="min-w-0 truncate"
              ><ServiceEnvChip :identity="envIdentity" readonly hide-inferred /></span
            ><span v-else :class="state === 'ready' ? 'text-select-text' : ''">{{
              t("serviceVersions.catalog.allEnvs")
            }}</span></span
          >
        </template>
        <OSelectItem
          :value="null"
          :label="t('serviceVersions.catalog.allEnvs')"
          data-test="svcver-env-option-all"
        >
          <span class="flex w-full items-center justify-between gap-3"
            >{{ t("serviceVersions.catalog.allEnvs")
            }}<span class="text-text-secondary tabular-nums">{{ serviceTotal }}</span></span
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
          <span class="flex w-full items-center justify-between gap-3"
            ><span class="min-w-0 truncate"
              >{{ item.env
              }}<span
                v-if="envCounts.get(item.env)?.inferred"
                class="text-text-secondary"
                :data-test="`svcver-env-option-${item.env}-inferred`"
                >{{ raw(" · ") }}{{ t("serviceVersions.env.inferred") }}</span
              ></span
            ><span
              v-if="envCounts.get(item.env)"
              class="text-text-secondary tabular-nums"
              :data-test="`svcver-env-option-${item.env}-count`"
              >{{ envCounts.get(item.env)?.services }}</span
            ></span
          >
        </OSelectItem>
        <template v-if="noEnvShown">
          <OSeparator class="my-1" />
          <OSelectItem
            :value="NO_ENV"
            :label="t('serviceVersions.env.noEnv')"
            data-test="svcver-env-option-none"
          >
            <span class="flex w-full items-center justify-between gap-3"
              >{{ t("serviceVersions.env.noEnv")
              }}<span v-if="noEnvCount" class="text-text-secondary tabular-nums">{{
                noEnvCount
              }}</span></span
            >
          </OSelectItem>
        </template>
      </OSelect>
    </div>
    <div class="w-52 min-w-38 shrink" data-test="svcver-verdict-filter-slot">
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
                filterDisabled
                  ? t("serviceVersions.catalog.disabled")
                  : verdict
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
      <OTooltip v-if="filterDisabled" :content="t('serviceVersions.catalog.unavailable')" />
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
import { NO_ENV, scopesInEnv } from "@/services/service_versions.envs";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ServiceEnvChip from "@/components/shared/ServiceEnvChip.vue";
import {
  catalogExtraVerdictOptions,
  catalogSummary,
  catalogVerdictOptions,
  type CatalogVerdictFilter,
} from "@/plugins/traces/servicesCatalogVersions";
const props = defineProps<{
  data?: ServicesResponse;
  scopes?: Scope[];
  state: "loading" | "locked" | "error" | "ready";
  env: string;
  verdict: string;
}>();
defineEmits<{ env: [string]; verdict: [string] }>();
const { t } = useI18nTyped();
const store = useStore();
const org = computed(() => String(store?.state?.selectedOrganization?.identifier || ""));
// The env read counts services per env and says which envs were only ever inferred; the menu works without it.
const envsRead = useQuery(
  computed(() => ({
    ...identityQuery(org.value, String(store?.state?.userInfo?.email || ""), "identityEnvs"),
    enabled: props.state === "ready" && Boolean(org.value),
  })),
);
const envCounts = computed(
  () =>
    new Map(
      (envsRead.isError.value ? [] : envsRead.data.value?.envs || [])
        .filter((item) => !item.no_env)
        .map((item) => [item.env, item]),
    ),
);
const realEnvs = computed(() => (props.data?.envs || []).filter((item) => !item.no_env));
const noEnvCount = computed(() =>
  envsRead.isError.value
    ? 0
    : (envsRead.data.value?.envs.find((item) => item.no_env)?.services ?? 0),
);
// The catalog's own no-env group keeps the option when the counts read fails.
const noEnvShown = computed(
  () => noEnvCount.value > 0 || Boolean(props.data?.envs.some((item) => item.no_env)),
);
const serviceTotal = computed(
  () => new Set((props.data?.services || []).map((scope) => scope.service)).size,
);
const summary = computed(() => catalogSummary(props.data, props.env, props.scopes));
const filterDisabled = computed(
  () => props.state !== "ready" || props.data?.verdict_status === "unavailable",
);
// Rare states stay out of the menu until a scope actually has them, so the default list matches the design.
const options = computed<CatalogVerdictFilter[]>(() => [
  ...catalogVerdictOptions,
  ...catalogExtraVerdictOptions.filter(
    (value) => summary.value.counts[value] || props.verdict === value,
  ),
]);
// The trigger names the selected env, which may be a scope's other env rather than its pinned one.
const envIdentity = computed(() => {
  const scope = props.env ? scopesInEnv(props.data?.services || [], props.env)[0] : undefined;
  if (!scope) return undefined;
  return props.env === NO_ENV
    ? { ...scope, envs: undefined }
    : { ...scope, env: props.env, envs: undefined, no_env: false };
});
function label(value: string) {
  if (value === "no_version") return t("serviceVersions.catalog.noVersion");
  if (value === "not_serving") return t("serviceVersions.verdict.notServing");
  if (value === "first_version") return t("serviceVersions.verdict.firstVersion");
  if (value === "pre_existing") return t("serviceVersions.verdict.preExisting");
  return t(`serviceVersions.verdict.${value}`);
}
</script>
