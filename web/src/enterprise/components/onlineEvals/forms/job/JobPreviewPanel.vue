<template>
  <aside
    class="border-border-default max-[68.75rem]:border-border-default min-w-0 flex-[3.5] overflow-auto border-l p-3 max-[68.75rem]:border-t max-[68.75rem]:border-l-0"
  >
    <section
      class="border-dialog-header-border rounded-default mb-3 border px-4 py-3.5"
      data-test="job-preview-matched-targets"
    >
      <header class="text-text-secondary mb-1.5 flex items-center gap-1.5">
        <OIcon name="visibility" size="xs" />
        <span class="text-compact text-text-heading m-0 font-semibold">{{
          t(`onlineEvals.job.preview.scopes.${targetScope}.title`)
        }}</span>
      </header>
      <div v-if="!stream" class="text-text-secondary m-0 text-xs leading-normal">
        {{ t(`onlineEvals.job.preview.scopes.${targetScope}.hint`) }}
      </div>
      <div v-else-if="!filterReady" class="text-text-secondary m-0 text-xs leading-normal">
        {{ t("onlineEvals.job.preview.matchedIncomplete") }}
      </div>
      <div v-else-if="matchedLoading" class="text-text-secondary m-0 text-xs leading-normal">
        {{ t(`onlineEvals.job.preview.scopes.${targetScope}.matchedLoading`) }}
      </div>
      <div v-else-if="matchedError" class="text-status-error-text m-0 text-xs">
        {{ t("onlineEvals.job.preview.matchedError") }}
      </div>
      <div v-else class="flex items-baseline gap-1.5">
        <span class="text-text-heading text-2xl font-bold tabular-nums">{{ formattedCount }}</span>
        <span class="text-text-secondary text-xs">
          {{ t(`onlineEvals.job.preview.scopes.${targetScope}.matchedSuffix`) }}
        </span>
      </div>
    </section>

    <section class="border-dialog-header-border rounded-default mb-0 border px-4 py-3.5">
      <header class="text-text-secondary mb-1.5 flex items-center gap-1.5">
        <OIcon name="info" size="xs" />
        <span class="text-compact text-text-heading m-0 font-semibold">{{
          t("onlineEvals.job.preview.summaryTitle")
        }}</span>
      </header>
      <dl
        class="[&_dt]:text-text-secondary [&_dd]:text-text-body m-0 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-xs [&_dd]:m-0"
      >
        <dt>{{ t("onlineEvals.job.preview.summaryName") }}</dt>
        <dd>{{ name || t("onlineEvals.job.preview.emptyValue") }}</dd>
        <dt>{{ t("onlineEvals.job.preview.summaryType") }}</dt>
        <dd class="sc-mono-cell">{{ streamType }}</dd>
        <dt>{{ t("onlineEvals.job.preview.summaryStatus") }}</dt>
        <dd>
          <OTag type="jobPreviewState" :value="mode === 'edit' ? 'editing' : 'draft'" />
        </dd>
      </dl>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, toRef } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { EvalTargetScope } from "@/services/online-evals.service";
import { useJobMatchedTargets } from "../../composables/useJobMatchedTargets";

const props = defineProps<{
  name: string;
  streamType: string;
  targetScope: EvalTargetScope;
  mode: "create" | "edit";
  /** Selected input stream — when empty the matched-target card shows a hint. */
  stream: string;
  /** SQL WHERE body from the filter builder ("" for no filter). */
  filterWhere: string;
  /** False while a filter condition is half-filled — pauses the count query. */
  filterReady: boolean;
}>();

const { t } = useI18n();

const {
  count: matchedCount,
  isLoading: matchedLoading,
  error: matchedError,
} = useJobMatchedTargets(
  toRef(props, "stream"),
  toRef(props, "filterWhere"),
  toRef(props, "filterReady"),
  toRef(props, "targetScope"),
);

const formattedCount = computed(() =>
  matchedCount.value == null ? "—" : matchedCount.value.toLocaleString(),
);
</script>
