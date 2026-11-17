<template>
  <div class="contents" data-test="svcver-catalog-counts-slot">
    <div v-if="chips.length" class="contents" data-test="svcver-catalog-counts">
      <span
        v-for="{ value, count } in chips"
        :key="value"
        :class="[
          'inline-flex shrink-0 whitespace-nowrap',
          count ? '' : 'invisible',
          folded?.includes(`verdict-${value}`) ? 'invisible absolute end-0' : '',
        ]"
        :data-fold-key="`verdict-${value}`"
        :data-test="`svcver-count-slot-${value}`"
        ><OTag
          clickable
          :data-test="`svcver-count-${value}`"
          @click="$emit('verdict', value)"
          type="versionVerdict"
          :value="value"
          :dot="false"
          :label="verdictCountLabel(value, count, t)"
      /></span>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { Scope, ServicesResponse } from "@/services/service_versions";
import OTag from "@/lib/core/Badge/OTag.vue";
import {
  catalogCountChips,
  catalogSummary,
  verdictCountLabel,
} from "@/plugins/traces/servicesCatalogVersions";
const props = defineProps<{
  data?: ServicesResponse;
  scopes?: Scope[];
  reserve?: Partial<Record<string, number>>;
  state: "loading" | "locked" | "error" | "ready";
  env: string;
  folded?: readonly string[];
}>();
defineEmits<{ verdict: [string] }>();
const { t } = useI18nTyped();
const summary = computed(() => catalogSummary(props.data, props.env, props.scopes));
const chips = computed(() =>
  catalogCountChips(
    summary.value,
    props.reserve,
    props.state === "ready" && props.data?.verdict_status !== "unavailable",
  ),
);
</script>
