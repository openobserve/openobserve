<template>
  <aside class="eval-form-page__side">
    <section class="eval-preview-card">
      <h3>{{ t("onlineEvals.job.preview.title") }}</h3>
      <p>{{ t("onlineEvals.job.preview.hint") }}</p>
      <textarea
        rows="4"
        readonly
        value="6,854 matched spans
Match rate: 4.5%"
      />
    </section>
    <section class="eval-preview-card">
      <h3>{{ t("onlineEvals.job.preview.summaryTitle") }}</h3>
      <dl>
        <dt>{{ t("onlineEvals.job.preview.summaryName") }}</dt>
        <dd>{{ name || t("onlineEvals.job.preview.emptyValue") }}</dd>
        <dt>{{ t("onlineEvals.job.preview.summaryType") }}</dt>
        <dd>{{ streamType }}</dd>
        <dt>{{ t("onlineEvals.job.preview.summaryStatus") }}</dt>
        <dd>{{ mode === "edit" ? t("onlineEvals.job.preview.statusEditing") : t("onlineEvals.job.preview.statusDraft") }}</dd>
      </dl>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  name: string;
  streamType: string;
  mode: "create" | "edit";
}>();

const { t } = useI18n();
</script>
