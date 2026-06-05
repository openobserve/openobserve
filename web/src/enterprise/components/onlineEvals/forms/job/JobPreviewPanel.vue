<template>
  <aside class="job-preview">
    <section class="job-preview__card">
      <header class="job-preview__card-head">
        <OIcon name="visibility" size="xs" />
        <h3 class="job-preview__card-title">{{ t("onlineEvals.job.preview.title") }}</h3>
      </header>
      <p class="job-preview__card-hint">{{ t("onlineEvals.job.preview.hint") }}</p>
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
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineProps<{
  name: string;
  streamType: string;
  mode: "create" | "edit";
}>();

const { t } = useI18n();
</script>

<style lang="scss" scoped>
.job-preview {
  min-width: 0;
  overflow: auto;
  padding: 18px;
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 0.313rem 0.063rem var(--o2-hover-shadow);
}

.job-preview__card {
  padding: 14px 16px;
  margin-bottom: 12px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
}

.job-preview__card:last-child {
  margin-bottom: 0;
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
