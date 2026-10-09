<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import {
  fieldSearchDefaults,
  fieldSearchPredicate,
  makeNoFtsFieldSchema,
  searchableFields,
  scalarFieldKind,
  type NoFtsRecoveryStream,
  type NoFtsFieldSubmission,
  type NoFtsFieldValues,
} from "./LogsNoFtsFieldSearch.schema";

const props = defineProps<{
  streams: NoFtsRecoveryStream[];
  selectedStreams: string[];
  term: string;
}>();
const emit = defineEmits<{ submit: [values: NoFtsFieldSubmission]; cancel: [] }>();
const { t } = useI18nTyped();
const container = ref<HTMLElement | null>(null);
const form = useOForm({
  defaultValues: fieldSearchDefaults(props.streams, props.term),
  schema: makeNoFtsFieldSchema(t, () => props.streams),
  onSubmit: (values: NoFtsFieldValues) => {
    const predicate = fieldSearchPredicate(values, props.streams);
    if (predicate) emit("submit", { ...values, predicate });
  },
});
const values = form.useStore((state) => state.values);
const target = computed(() => props.streams.find((stream) => stream.name === values.value.stream));
const fields = computed(() => searchableFields(target.value));
const field = computed(() =>
  fields.value.find((candidate) => candidate.name === values.value.field),
);
const streamOptions = computed(() =>
  props.streams.map((stream) => ({ label: raw(stream.name), value: stream.name })),
);
const fieldOptions = computed(() =>
  fields.value.map((field) => ({ label: raw(field.name), value: field.name })),
);
const matchOptions = computed(() => [
  ...(field.value && scalarFieldKind(field.value) === "string"
    ? [{ label: t("search.noFtsRecovery.contains"), value: "contains" }]
    : []),
  { label: t("search.noFtsRecovery.equals"), value: "equals" },
]);
const preview = computed(() => fieldSearchPredicate(values.value, props.streams));
const otherStreams = computed(() =>
  props.selectedStreams.filter((name) => name !== values.value.stream),
);
const scope = computed(() =>
  otherStreams.value.length
    ? t("search.noFtsRecovery.singleStreamScope", {
        stream: values.value.stream,
        otherStreams: otherStreams.value.join(", "),
      })
    : t("search.noFtsRecovery.scope", { stream: values.value.stream }),
);
watch(
  () => values.value.stream,
  () => {
    const defaults = fieldSearchDefaults(
      [target.value ?? { name: values.value.stream, schema: [] }],
      values.value.value,
    );
    form.setFieldValue("field", defaults.field);
    form.setFieldValue("match", defaults.match);
  },
);
watch(
  () => values.value.field,
  () => {
    if (field.value && scalarFieldKind(field.value) !== "string")
      form.setFieldValue("match", "equals");
  },
);
onMounted(async () => {
  await nextTick();
  container.value
    ?.querySelector<HTMLElement>(
      props.streams.length > 1
        ? '[data-test="logs-no-fts-stream"] button'
        : '[data-test="logs-no-fts-field"] button',
    )
    ?.focus();
});
</script>

<template>
  <div
    ref="container"
    class="border-border-default rounded-surface bg-surface-base mx-auto w-full max-w-168 border p-6 max-md:p-3"
    @keydown.esc.stop.prevent="emit('cancel')"
  >
    <div class="flex items-center justify-between gap-2">
      <OText variant="panel-title">{{ t("search.noFtsRecovery.searchField") }}</OText>
      <OButton
        variant="ghost"
        size="sm"
        icon-left="close"
        :aria-label="t('search.noFtsRecovery.close')"
        @click="emit('cancel')"
      />
    </div>
    <OText variant="meta" class="mt-2 block leading-snug!">{{ scope }}</OText>
    <OForm :form="form" data-test="logs-no-fts-field-form" class="mt-5 flex flex-col gap-5">
      <OFormSelect
        v-if="streams.length > 1"
        name="stream"
        :label="t('search.noFtsRecovery.stream')"
        :options="streamOptions"
        required
        data-test="logs-no-fts-stream"
      />
      <OText v-if="!fields.length" variant="meta" role="status">{{
        t("search.noFtsRecovery.noFields")
      }}</OText>
      <div class="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <OFormSelect
          name="field"
          :label="t('search.noFtsRecovery.field')"
          :options="fieldOptions"
          required
          data-test="logs-no-fts-field"
        />
        <OFormSelect
          name="match"
          :label="t('search.noFtsRecovery.match')"
          :options="matchOptions"
          :searchable="false"
          required
          data-test="logs-no-fts-match"
        />
        <OFormInput
          name="value"
          :label="t('search.noFtsRecovery.value')"
          :required="!!term"
          data-test="logs-no-fts-value"
        />
      </div>
      <div
        class="border-border-default bg-section-header-bg rounded-default flex flex-col gap-2 border p-3"
        aria-live="polite"
        aria-atomic="true"
      >
        <OText variant="meta">{{ t("search.noFtsRecovery.preview") }}</OText>
        <code class="font-mono text-xs wrap-break-word" data-test="logs-no-fts-preview">{{
          preview
        }}</code>
      </div>
      <OText variant="meta" class="leading-snug!">{{
        t("search.noFtsRecovery.replacement", { term })
      }}</OText>
      <div class="flex flex-wrap justify-end gap-2">
        <OButton variant="outline" size="sm-action" @click="emit('cancel')">{{
          t("search.noFtsRecovery.cancel")
        }}</OButton>
        <OButton
          type="submit"
          variant="primary"
          size="sm-action"
          :disabled="!fields.length"
          :tooltip="!fields.length ? t('search.noFtsRecovery.noFields') : undefined"
          data-test="logs-no-fts-run-field-btn"
          >{{ t("search.noFtsRecovery.run") }}</OButton
        >
      </div>
    </OForm>
  </div>
</template>
