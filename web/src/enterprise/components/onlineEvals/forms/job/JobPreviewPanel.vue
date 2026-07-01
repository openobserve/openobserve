<template>
  <aside class="job-preview">
    <section class="job-preview__card">
      <header class="job-preview__card-head">
        <OIcon name="visibility" size="xs" />
        <h3 class="job-preview__card-title">{{ t("onlineEvals.job.preview.title") }}</h3>
      </header>
      <p v-if="!stream" class="job-preview__card-hint">
        {{ t("onlineEvals.job.preview.hint") }}
      </p>
      <p v-else-if="!filterReady" class="job-preview__card-hint">
        {{ t("onlineEvals.job.preview.matchedIncomplete") }}
      </p>
      <p v-else-if="matchedLoading" class="job-preview__card-hint">
        {{ t("onlineEvals.job.preview.matchedLoading") }}
      </p>
      <p v-else-if="matchedError" class="job-preview__match-error">
        {{ t("onlineEvals.job.preview.matchedError") }}
      </p>
      <div v-else class="job-preview__match">
        <span class="job-preview__match-count">{{ formattedCount }}</span>
        <span class="job-preview__match-suffix">
          {{ t("onlineEvals.job.preview.matchedSuffix") }}
        </span>
      </div>
    </section>

    <section class="job-preview__card">
      <header class="job-preview__card-head">
        <OIcon name="info" size="xs" />
        <h3 class="job-preview__card-title">{{ t("onlineEvals.job.preview.summaryTitle") }}</h3>
      </header>
      <dl class="job-preview__dl">
        <dt>{{ t("onlineEvals.job.preview.summaryName") }}</dt>
        <dd>{{ name || t("onlineEvals.job.preview.emptyValue") }}</dd>
        <dt>{{ t("onlineEvals.job.preview.summaryType") }}</dt>
        <dd class="sc-mono-cell">{{ streamType }}</dd>
        <dt>{{ t("onlineEvals.job.preview.summaryStatus") }}</dt>
        <dd>
          <span
            class="job-preview__status"
            :class="mode === 'edit' ? 'job-preview__status--editing' : 'job-preview__status--draft'"
          >
            {{
              mode === "edit"
                ? t("onlineEvals.job.preview.statusEditing")
                : t("onlineEvals.job.preview.statusDraft")
            }}
          </span>
        </dd>
      </dl>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, toRef } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
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

<style lang="scss" scoped>
// Right rail (AddAlert pattern): a left-border divider separates it from the
// form column; cards stack with a gap. No floating-card bg/shadow.
.job-preview {
  flex: 3.5;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-left: 1px solid var(--color-border-default, var(--o2-border));
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.job-preview__card {
  padding: 14px 16px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
  background: var(--color-card-bg);
}

.job-preview__card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-preview__card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.job-preview__card-hint {
  margin: 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
  line-height: 1.5;
}

.job-preview__match {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.job-preview__match-count {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text-primary, currentColor);
  font-variant-numeric: tabular-nums;
}

.job-preview__match-suffix {
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-preview__match-error {
  margin: 0;
  font-size: 12px;
  color: var(--o2-status-error-text, #c62828);
}

.job-preview__dl {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px 12px;
  margin: 0;
  font-size: 12px;
}

.job-preview__dl dt {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-preview__dl dd {
  margin: 0;
  color: var(--color-text-primary, currentColor);
}

.job-preview__status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font: 600 11px inherit;
}

.job-preview__status--draft {
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-preview__status--editing {
  background: color-mix(in srgb, var(--o2-status-info-text) 14%, transparent);
  color: var(--o2-status-info-text);
}
</style>
