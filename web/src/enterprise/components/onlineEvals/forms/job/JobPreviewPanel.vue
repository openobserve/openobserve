<template>
  <aside
    class="flex-[3.5] min-w-0 overflow-auto p-2 bg-surface-base rounded-default shadow-[0_0_0.313rem_0.063rem_var(--color-hover-shadow)]"
  >
    <section
      class="py-3.5 px-4 mb-3 border border-(--color-dialog-header-border,var(--color-border-default)) rounded-default"
    >
      <header
        class="flex items-center gap-1.5 mb-1.5 text-(--color-text-secondary,var(--color-text-secondary))"
      >
        <OIcon name="visibility" size="xs" />
        <span class="m-0 text-compact font-semibold text-(--color-text-heading,currentColor)">{{
          t("onlineEvals.job.preview.title")
        }}</span>
      </header>
      <div v-if="!stream" class="m-0 text-text-secondary text-xs leading-normal">
        {{ t("onlineEvals.job.preview.hint") }}
      </div>
      <div v-else-if="!filterReady" class="m-0 text-text-secondary text-xs leading-normal">
        {{ t("onlineEvals.job.preview.matchedIncomplete") }}
      </div>
      <div v-else-if="matchedLoading" class="m-0 text-text-secondary text-xs leading-normal">
        {{ t("onlineEvals.job.preview.matchedLoading") }}
      </div>
      <div v-else-if="matchedError" class="m-0 text-xs text-status-error-text">
        {{ t("onlineEvals.job.preview.matchedError") }}
      </div>
      <div v-else class="flex items-baseline gap-1.5">
        <span class="text-2xl font-bold text-text-secondary [font-variant-numeric:tabular-nums]">{{
          formattedCount
        }}</span>
        <span class="text-xs text-(--color-text-secondary,var(--color-text-secondary))">
          {{ t("onlineEvals.job.preview.matchedSuffix") }}
        </span>
      </div>
    </section>

    <section
      class="py-3.5 px-4 mb-0 border border-(--color-dialog-header-border,var(--color-border-default)) rounded-default"
    >
      <header
        class="flex items-center gap-1.5 mb-1.5 text-(--color-text-secondary,var(--color-text-secondary))"
      >
        <OIcon name="info" size="xs" />
        <span class="m-0 text-compact font-semibold text-(--color-text-heading,currentColor)">{{
          t("onlineEvals.job.preview.summaryTitle")
        }}</span>
      </header>
      <dl
        class="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 m-0 text-xs [&_dt]:text-text-secondary [&_dd]:m-0 [&_dd]:text-text-body"
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
