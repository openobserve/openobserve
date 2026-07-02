<template>
  <aside class="tw:min-w-0 tw:overflow-auto tw:p-4.5 tw:bg-(--o2-card-bg) tw:rounded-md tw:shadow-[0_0_0.313rem_0.063rem_var(--o2-hover-shadow)]">
    <section class="tw:py-[14px] tw:px-4 tw:mb-3 tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md">
      <header class="tw:flex tw:items-center tw:gap-[6px] tw:mb-[6px] tw:text-(--color-text-secondary,var(--o2-text-secondary))">
        <OIcon name="visibility" size="xs" />
        <span class="tw:m-0 tw:text-[0.8125rem] tw:font-semibold tw:text-(--color-text-primary,currentColor)">{{ t("onlineEvals.job.preview.title") }}</span>
      </header>
      <div v-if="!stream" class="tw:m-0 tw:text-text-secondary tw:text-xs tw:leading-normal">
        {{ t("onlineEvals.job.preview.hint") }}
      </div>
      <div v-else-if="!filterReady" class="tw:m-0 tw:text-text-secondary tw:text-xs tw:leading-normal">
        {{ t("onlineEvals.job.preview.matchedIncomplete") }}
      </div>
      <div v-else-if="matchedLoading" class="tw:m-0 tw:text-text-secondary tw:text-xs tw:leading-normal">
        {{ t("onlineEvals.job.preview.matchedLoading") }}
      </div>
      <div v-else-if="matchedError" class="tw:m-0 tw:text-xs tw:text-(--o2-status-error-text,#c62828)">
        {{ t("onlineEvals.job.preview.matchedError") }}
      </div>
      <div v-else class="tw:flex tw:items-baseline tw:gap-1.5">
        <span class="tw:text-2xl tw:font-bold tw:text-(--color-text-primary,currentColor) tw:[font-variant-numeric:tabular-nums]">{{ formattedCount }}</span>
        <span class="tw:text-xs tw:text-(--color-text-secondary,var(--o2-text-secondary))">
          {{ t("onlineEvals.job.preview.matchedSuffix") }}
        </span>
      </div>
    </section>

    <section class="tw:py-[14px] tw:px-4 tw:mb-0 tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md">
      <header class="tw:flex tw:items-center tw:gap-[6px] tw:mb-[6px] tw:text-(--color-text-secondary,var(--o2-text-secondary))">
        <OIcon name="info" size="xs" />
        <span class="tw:m-0 tw:text-[0.8125rem] tw:font-semibold tw:text-(--color-text-primary,currentColor)">{{ t("onlineEvals.job.preview.summaryTitle") }}</span>
      </header>
      <dl class="tw:grid tw:grid-cols-[96px_1fr] tw:gap-x-3 tw:gap-y-2 tw:m-0 tw:text-xs [&_dt]:tw:text-text-secondary [&_dd]:tw:m-0 [&_dd]:tw:text-text-primary">
        <dt>{{ t("onlineEvals.job.preview.summaryName") }}</dt>
        <dd>{{ name || t("onlineEvals.job.preview.emptyValue") }}</dd>
        <dt>{{ t("onlineEvals.job.preview.summaryType") }}</dt>
        <dd class="sc-mono-cell">{{ streamType }}</dd>
        <dt>{{ t("onlineEvals.job.preview.summaryStatus") }}</dt>
        <dd>
          <OTag
            type="jobPreviewState"
            :value="mode === 'edit' ? 'editing' : 'draft'"
          />
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
import { useJobMatchedSpans } from "../../composables/useJobMatchedSpans";

const props = defineProps<{
  name: string;
  streamType: string;
  mode: "create" | "edit";
  /** Selected input stream — when empty the Matched Spans card shows the hint. */
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
} = useJobMatchedSpans(
  toRef(props, "stream"),
  toRef(props, "filterWhere"),
  toRef(props, "filterReady"),
);

const formattedCount = computed(() =>
  matchedCount.value == null ? "—" : matchedCount.value.toLocaleString(),
);
</script>
