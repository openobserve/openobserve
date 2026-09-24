<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <div class="flex flex-col gap-5" data-test="prompt-labels-panel">
    <div class="flex items-start justify-between gap-3 max-md:flex-col">
      <div>
        <h3 class="text-text-heading text-base font-semibold">
          {{ t("aiObservability.promptManagement.labels") }}
        </h3>
        <p class="text-text-secondary mt-1 text-sm">
          {{ t("aiObservability.promptManagement.labelsHelp") }}
        </p>
      </div>
      <OButton
        v-if="!adding && !readOnly"
        variant="outline"
        size="sm"
        data-test="prompt-label-add"
        @click="adding = true"
      >
        {{ t("aiObservability.promptManagement.addLabel") }}
      </OButton>
    </div>
    <OForm
      v-if="adding"
      :key="formKey"
      v-slot="{ isSubmitting }"
      :schema="schema"
      :default-values="defaults"
      class="rounded-default border-border-default flex flex-col gap-3 border p-3"
      @submit="addLabel"
    >
      <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <OFormInput
          name="name"
          :label="t('aiObservability.promptManagement.labelName')"
          :placeholder="t('aiObservability.promptManagement.labelPlaceholder')"
          :help-text="t('aiObservability.promptManagement.newLabelHelp')"
          required
          autofocus
          data-test="prompt-label-name"
        />
        <OFormSelect
          name="version"
          :label="t('aiObservability.promptManagement.targetVersion')"
          :options="versionOptions"
          searchable
          required
          data-test="prompt-label-create-version"
        />
      </div>
      <div class="flex justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="isSubmitting"
          @click="adding = false"
          >{{ t("aiObservability.promptManagement.cancel") }}</OButton
        >
        <OButton
          type="submit"
          variant="primary"
          size="sm-action"
          :loading="isSubmitting"
          data-test="prompt-label-create"
          >{{ t("aiObservability.promptManagement.addLabel") }}</OButton
        >
      </div>
    </OForm>
    <div v-if="!isDesktop" class="flex flex-col gap-3" data-test="prompt-label-cards">
      <OCard v-for="label in labels" :key="label.name" variant="outlined" class="gap-3 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <OTag :variant="protectedLabels.includes(label.name) ? 'amber-soft' : 'default-soft'">{{
            label.name
          }}</OTag>
          <span v-if="label.name === 'latest'" class="text-text-secondary text-xs">{{
            t("aiObservability.promptManagement.automatic")
          }}</span>
          <span
            v-else-if="protectedLabels.includes(label.name)"
            class="text-text-secondary text-xs"
            >{{ t("aiObservability.promptManagement.protected") }}</span
          >
        </div>
        <p v-if="label.name === 'latest'" class="text-text-secondary text-xs">
          {{ t("aiObservability.promptManagement.latestLabelHelp") }}
        </p>
        <div class="flex items-center justify-between gap-2">
          <span class="text-text-secondary text-xs">{{
            t("aiObservability.promptManagement.currentVersion")
          }}</span>
          <OButton
            variant="ghost"
            size="xs"
            :title="t('aiObservability.promptManagement.viewVersion')"
            @click="label.version !== null && emit('view-version', label.version)"
            >{{
              t("aiObservability.promptManagement.versionNumber", { version: label.version })
            }}</OButton
          >
        </div>
        <template v-if="label.name !== 'latest' && !readOnly">
          <OSelect
            v-model="targets[label.name]"
            :label="t('aiObservability.promptManagement.moveToVersion')"
            :options="versionOptions"
            :disabled="busy"
            :data-test="`prompt-label-target-${label.name}`"
          />
          <div class="flex justify-end gap-2">
            <OButton
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="delete"
              :disabled="busy"
              :title="t('aiObservability.promptManagement.removeLabelNamed', { name: label.name })"
              :data-test="`prompt-label-remove-${label.name}`"
              @click="emit('remove', label)"
            />
            <OButton
              variant="outline"
              size="sm"
              :disabled="busy || !targets[label.name] || targets[label.name] === label.version"
              :data-test="`prompt-label-move-${label.name}`"
              @click="move(label)"
              >{{ t("aiObservability.promptManagement.move") }}</OButton
            >
          </div>
        </template>
      </OCard>
    </div>
    <OTable
      v-else
      :data="labels"
      :columns="columns"
      row-key="name"
      pagination="none"
      :fill-height="false"
      :default-columns="false"
      :show-global-filter="false"
      data-test="prompt-label-table"
    >
      <template #cell-name="{ row }">
        <div class="flex flex-wrap items-center gap-2">
          <OTag :variant="protectedLabels.includes(row.name) ? 'amber-soft' : 'default-soft'">{{
            row.name
          }}</OTag>
          <span v-if="row.name === 'latest'" class="text-text-secondary text-xs">{{
            t("aiObservability.promptManagement.automatic")
          }}</span>
          <span
            v-else-if="protectedLabels.includes(row.name)"
            class="text-text-secondary text-xs"
            >{{ t("aiObservability.promptManagement.protected") }}</span
          >
        </div>
        <p v-if="row.name === 'latest'" class="text-text-secondary mt-1 text-xs whitespace-normal">
          {{ t("aiObservability.promptManagement.latestLabelHelp") }}
        </p>
      </template>
      <template #cell-version="{ row }">
        <OButton
          variant="ghost"
          size="xs"
          :title="t('aiObservability.promptManagement.viewVersion')"
          @click="row.version !== null && emit('view-version', row.version)"
          >{{
            t("aiObservability.promptManagement.versionNumber", { version: row.version })
          }}</OButton
        >
      </template>
      <template #cell-target="{ row }">
        <div v-if="row.name !== 'latest' && !readOnly" class="flex items-center gap-2">
          <OSelect
            v-model="targets[row.name]"
            :options="versionOptions"
            width="xs"
            size="sm"
            :aria-label="t('aiObservability.promptManagement.moveLabelNamed', { name: row.name })"
            :disabled="busy"
            :data-test="`prompt-label-target-${row.name}`"
          />
          <OButton
            variant="outline"
            size="sm"
            :disabled="busy || !targets[row.name] || targets[row.name] === row.version"
            :data-test="`prompt-label-move-${row.name}`"
            @click="move(row)"
            >{{ t("aiObservability.promptManagement.move") }}</OButton
          >
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="delete"
            :disabled="busy"
            :title="t('aiObservability.promptManagement.removeLabelNamed', { name: row.name })"
            :data-test="`prompt-label-remove-${row.name}`"
            @click="emit('remove', row)"
          />
        </div>
      </template>
    </OTable>
    <p v-if="readOnly" class="text-text-secondary text-sm">
      {{ t("aiObservability.promptManagement.archivedReadOnly") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import useBreakpoint from "@/composables/useBreakpoint";
import OCard from "@/lib/core/Card/OCard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import type { PromptLabel, PromptVersion } from "@/services/llm-prompts.service";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  makePromptLabelSchema,
  promptLabelDefaults,
  type PromptLabelForm,
} from "./PromptLabel.schema";

const props = defineProps<{
  labels: PromptLabel[];
  versions: PromptVersion[];
  selectedVersion: number;
  protectedLabels: string[];
  busy: boolean;
  readOnly: boolean;
  saveLabel: (name: string, version: number) => Promise<boolean>;
}>();
const emit = defineEmits<{ remove: [label: PromptLabel]; "view-version": [version: number] }>();
const { t } = useI18nTyped();
const { isDesktop } = useBreakpoint();
const adding = ref(false);
const formKey = ref(0);
const targets = ref<Record<string, number>>({});
const schema = computed(() =>
  makePromptLabelSchema(
    t,
    props.labels.map((label) => label.name),
  ),
);
const defaults = computed(() => promptLabelDefaults(props.selectedVersion));
const versionOptions = computed(() =>
  props.versions.map((version) => ({ label: raw(`v${version.version}`), value: version.version })),
);
const columns: OTableColumnDef<PromptLabel>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: t("aiObservability.promptManagement.labelName"),
    size: 260,
  },
  {
    id: "version",
    accessorKey: "version",
    header: t("aiObservability.promptManagement.currentVersion"),
    size: 120,
  },
  { id: "target", header: t("aiObservability.promptManagement.moveToVersion"), size: 280 },
];
async function addLabel(value: PromptLabelForm) {
  if (await props.saveLabel(value.name.trim(), value.version)) {
    adding.value = false;
    formKey.value++;
  }
}
async function move(label: PromptLabel) {
  const version = targets.value[label.name];
  if (version && version !== label.version) await props.saveLabel(label.name, version);
}
watch(
  () => props.labels,
  (labels) => {
    targets.value = Object.fromEntries(
      labels.filter((label) => label.version !== null).map((label) => [label.name, label.version!]),
    );
  },
  { immediate: true },
);
</script>
