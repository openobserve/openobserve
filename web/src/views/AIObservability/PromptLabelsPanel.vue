<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <div class="flex flex-col" data-test="prompt-labels-panel">
    <OTable
      :data="labels"
      :columns="columns"
      row-key="name"
      pagination="none"
      :fill-height="false"
      :default-columns="false"
      :show-global-filter="false"
      :show-footer="false"
      :frame="false"
      data-test="prompt-label-table"
    >
      <template #toolbar>
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <OBanner
            variant="info"
            icon="info-outline"
            dense
            class="min-w-0 flex-1"
            :content="t('aiObservability.promptManagement.labelsHelp')"
            data-test="prompt-labels-help"
          />
          <OButton
            v-if="!editing && !readOnly"
            variant="outline"
            size="sm"
            icon-left="add"
            class="shrink-0"
            data-test="prompt-label-add"
            @click="openForm(null)"
          >
            {{ t("aiObservability.promptManagement.addLabel") }}
          </OButton>
        </div>
      </template>
      <template v-if="editing" #subheader>
        <OContent y>
          <OForm
            :key="formKey"
            v-slot="{ isSubmitting }"
            :schema="schema"
            :default-values="defaults"
            class="rounded-default border-border-default flex flex-col gap-3 border p-3"
            data-test="prompt-label-form"
            @submit="submit"
          >
            <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
              <OFormInput
                name="name"
                :label="t('aiObservability.promptManagement.labelName')"
                :placeholder="t('aiObservability.promptManagement.labelPlaceholder')"
                :disabled="Boolean(editingLabel)"
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
                data-test="prompt-label-cancel"
                @click="closeForm"
                >{{ t("aiObservability.promptManagement.cancel") }}</OButton
              >
              <OButton
                type="submit"
                variant="primary"
                size="sm-action"
                :loading="isSubmitting"
                data-test="prompt-label-create"
                >{{
                  editingLabel
                    ? t("aiObservability.promptManagement.move")
                    : t("aiObservability.promptManagement.addLabel")
                }}</OButton
              >
            </div>
          </OForm>
        </OContent>
      </template>
      <template #cell-name="{ row }">
        <div class="flex items-center gap-1.5">
          <OTag
            :variant="protectedLabels.includes(row.name) ? 'amber-soft' : 'default-soft'"
            shape="rounded"
          >
            <OIcon v-if="protectedLabels.includes(row.name)" name="lock" size="xs" />
            {{ row.name }}
          </OTag>
          <span
            v-if="row.name === 'latest'"
            class="text-text-secondary inline-flex items-center gap-1 text-xs"
          >
            {{ t("aiObservability.promptManagement.automatic") }}
            <OIcon name="info-outline" size="xs" class="cursor-help">
              <OTooltip :content="t('aiObservability.promptManagement.latestLabelHelp')" />
            </OIcon>
          </span>
        </div>
      </template>
      <template #cell-version="{ row }">
        <span class="tabular-nums">{{
          t("aiObservability.promptManagement.versionNumber", { version: row.version })
        }}</span>
      </template>
      <template #cell-updatedAt="{ row }">
        <OTimeCell :value="row.updatedAt" unit="ms" mode="relative" :empty-label="raw('—')" />
      </template>
      <template #cell-updatedBy="{ row }">
        <span class="text-text-secondary truncate">{{ row.updatedBy || raw("—") }}</span>
      </template>
      <template #cell-actions="{ row }">
        <div v-if="row.name !== 'latest' && !readOnly" class="flex items-center">
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="swap-horiz"
            :disabled="busy"
            :data-test="`prompt-label-move-${row.name}`"
            @click="openForm(row)"
          >
            <OTooltip :content="t('aiObservability.promptManagement.moveToVersion')" />
          </OButton>
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="delete"
            :disabled="busy"
            :data-test="`prompt-label-remove-${row.name}`"
            @click="emit('remove', row)"
          >
            <OTooltip
              :content="t('aiObservability.promptManagement.removeLabelNamed', { name: row.name })"
            />
          </OButton>
        </div>
      </template>
    </OTable>
    <OContent v-if="readOnly" y>
      <p class="text-text-secondary m-0 text-xs">
        {{ t("aiObservability.promptManagement.archivedReadOnly") }}
      </p>
    </OContent>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
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
const emit = defineEmits<{ remove: [label: PromptLabel] }>();
const { t } = useI18nTyped();
const editing = ref(false);
const editingLabel = ref<PromptLabel | null>(null);
const formKey = ref(0);
// Editing an existing label must not trip the duplicate-name rule on its own name.
const schema = computed(() =>
  makePromptLabelSchema(
    t,
    props.labels.map((label) => label.name).filter((name) => name !== editingLabel.value?.name),
  ),
);
const defaults = computed(() =>
  editingLabel.value
    ? {
        name: editingLabel.value.name,
        version: editingLabel.value.version ?? props.selectedVersion,
      }
    : promptLabelDefaults(props.selectedVersion),
);
const versionOptions = computed(() =>
  props.versions.map((version) => ({ label: raw(`v${version.version}`), value: version.version })),
);
const columns: OTableColumnDef<PromptLabel>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: t("aiObservability.promptManagement.label"),
    size: 180,
  },
  {
    id: "version",
    accessorKey: "version",
    header: t("aiObservability.promptManagement.version"),
    size: 140,
  },
  {
    id: "updatedAt",
    accessorKey: "updatedAt",
    header: t("aiObservability.promptManagement.updated"),
    size: 140,
  },
  {
    id: "updatedBy",
    accessorKey: "updatedBy",
    header: t("aiObservability.promptManagement.updatedBy"),
    size: 200,
    meta: { flex: true },
  },
  { id: "actions", isAction: true, header: raw(""), accessorKey: "name", size: 88 },
];
function openForm(label: PromptLabel | null) {
  editingLabel.value = label;
  editing.value = true;
  formKey.value++;
}
function closeForm() {
  editing.value = false;
  editingLabel.value = null;
}
async function submit(value: PromptLabelForm) {
  if (editingLabel.value?.version === value.version) return closeForm();
  if (await props.saveLabel(value.name.trim(), value.version)) closeForm();
}
</script>
