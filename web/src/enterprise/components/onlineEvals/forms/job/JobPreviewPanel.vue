<template>
  <aside class="tw:min-w-0 tw:overflow-auto tw:p-4.5 tw:bg-(--o2-card-bg) tw:rounded-md tw:shadow-[0_0_0.313rem_0.063rem_var(--o2-hover-shadow)]">
    <section class="tw:py-[14px] tw:px-4 tw:mb-3 tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-md">
      <header class="tw:flex tw:items-center tw:gap-[6px] tw:mb-[6px] tw:text-(--color-text-secondary,var(--o2-text-secondary))">
        <OIcon name="visibility" size="xs" />
        <span class="tw:m-0 tw:text-[0.8125rem] tw:font-semibold tw:text-(--color-text-primary,currentColor)">{{ t("onlineEvals.job.preview.title") }}</span>
      </header>
      <div class="tw:m-0 tw:text-text-secondary tw:text-xs tw:leading-normal">{{ t("onlineEvals.job.preview.hint") }}</div>
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
          <span
            class="tw:inline-flex tw:items-center tw:gap-[5px] tw:py-0.5 tw:px-2 tw:rounded-full tw:text-[11px] tw:font-semibold"
            :class="
              mode === 'edit'
                ? 'tw:bg-[color-mix(in_srgb,var(--o2-status-info-text)_14%,transparent)] tw:text-(--o2-status-info-text)'
                : 'tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_14%,transparent)] tw:text-(--color-text-secondary,var(--o2-text-secondary))'
            "
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
