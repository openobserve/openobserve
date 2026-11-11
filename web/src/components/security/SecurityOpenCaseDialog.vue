<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Opening a case from an event confirms what the event already says: its title, priority and entities. -->
<script setup lang="ts">
import { computed, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormCheckboxGroup from "@/lib/forms/Checkbox/OFormCheckboxGroup.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CaseRow, PromoteEventOptions } from "@/services/securityCases";
import { caseEntities } from "@/utils/security/cases";
import {
  CASE_PRIORITIES,
  NEW_CASE,
  entityKey,
  makeOpenCaseSchema,
  parseEntityKey,
  type CaseEntityOption,
  type CasePriority,
  type OpenCaseValues,
} from "./SecurityOpenCaseDialog.schema";

const props = defineProps<{
  open: boolean;
  defaultTitle: string;
  defaultPriority: CasePriority;
  entities: CaseEntityOption[];
  /** Open cases already on one of the event's entities; the event can join one instead. */
  existing?: CaseRow[];
  /** Resolves true once the server opened the case. */
  submit: (options: PromoteEventOptions) => Promise<boolean>;
}>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const FORM_ID = "security-open-case-form";
const schema = makeOpenCaseSchema(t);
const existing = computed(() => props.existing ?? []);
// The newest case on the entity is the likely home, so it is picked; opening a new one stays a click away.
const defaults = computed<OpenCaseValues>(() => ({
  target: existing.value[0]?.id ?? NEW_CASE,
  title: props.defaultTitle,
  priority: props.defaultPriority,
  entities: props.entities.map(entityKey),
  note: "",
}));
const priorityOptions = computed(() =>
  CASE_PRIORITIES.map((p) => ({ label: t(`siem.drawer.openCaseDialog.priority${p}`), value: p })),
);
const kindLabel = (e: CaseEntityOption) => t(`siem.drawer.openCaseDialog.kind.${e.kind}`);

const form = useOForm<OpenCaseValues>({
  defaultValues: defaults.value,
  schema,
  onSubmit: async (value) => onSubmit(value),
});
watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) form.reset(defaults.value);
  },
);
// Cases on the entity load after the dialog opens; the newest one becomes the pick once known.
watch(
  () => existing.value.map((c) => c.id).join(","),
  () => {
    if (props.open) form.setFieldValue("target", defaults.value.target);
  },
);
const target = form.useStore((s: any) => String(s.values.target ?? NEW_CASE));
const joining = computed(() => target.value !== NEW_CASE);
const entityText = (c: CaseRow) =>
  caseEntities(c)
    .map((e) => e.value)
    .join(", ");

async function onSubmit(value: OpenCaseValues) {
  const parsed = schema.parse(value);
  if (parsed.target !== NEW_CASE) {
    const added = await props.submit({ caseId: parsed.target, note: parsed.note });
    if (added) emit("update:open", false);
    return;
  }
  const ok = await props.submit({
    title: parsed.title,
    priority: parsed.priority,
    entities: parsed.entities.map(parseEntityKey).filter((e): e is CaseEntityOption => !!e),
    note: parsed.note,
  });
  if (ok) emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('siem.drawer.openCaseDialog.title')"
    :form-id="FORM_ID"
    :primary-button-label="
      joining ? t('siem.drawer.openCaseDialog.addToExisting') : t('siem.drawer.openCase')
    "
    :secondary-button-label="t('siem.detections.cancel')"
    data-test="security-open-case-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm v-if="open" :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormRadioGroup
        v-if="existing.length"
        name="target"
        :label="t('siem.drawer.openCaseDialog.existingLabel')"
        orientation="vertical"
        class="flex flex-col gap-2"
        data-test="security-open-case-target"
      >
        <span class="text-text-secondary text-xs">{{
          t("siem.drawer.openCaseDialog.existingHint", { n: existing.length }, existing.length)
        }}</span>
        <ORadio
          v-for="c in existing"
          :key="c.id"
          :value="c.id"
          variant="card"
          :data-test="`security-open-case-target-${c.id}`"
        >
          <template #label>
            <span class="flex min-w-0 flex-col gap-1">
              <span class="flex min-w-0 items-center gap-2">
                <OTag type="severity" :value="c.severity.toLowerCase()" size="xs" />
                <span class="text-text-heading min-w-0 font-medium break-words">{{
                  t("siem.drawer.openCaseDialog.addTo", {
                    title: raw(c.title || t("siem.overview.untitledCase")),
                    id: raw(c.id),
                  })
                }}</span>
              </span>
              <span class="text-text-secondary font-mono text-xs font-normal break-all">{{
                entityText(c)
              }}</span>
            </span>
          </template>
        </ORadio>
        <ORadio :value="NEW_CASE" variant="card" data-test="security-open-case-target-new">
          <template #label>
            <span>{{ t("siem.drawer.openCaseDialog.openNew") }}</span>
          </template>
        </ORadio>
      </OFormRadioGroup>
      <template v-if="!joining">
        <OFormInput
          name="title"
          :label="t('siem.drawer.openCaseDialog.caseTitle')"
          required
          data-test="security-open-case-title"
        />
        <OFormSelect
          name="priority"
          :label="t('siem.drawer.openCaseDialog.priority')"
          :options="priorityOptions"
          data-test="security-open-case-priority"
        />
        <div class="flex flex-col gap-2">
          <span class="text-text-label text-sm font-medium">{{
            t("siem.drawer.openCaseDialog.entities")
          }}</span>
          <OFormCheckboxGroup
            v-if="entities.length"
            name="entities"
            :aria-label="t('siem.drawer.openCaseDialog.entities')"
            data-test="security-open-case-entities"
          >
            <div class="flex flex-col gap-1.5">
              <OCheckbox
                v-for="e in entities"
                :key="entityKey(e)"
                :value="entityKey(e)"
                :label="
                  t('siem.drawer.openCaseDialog.entityLabel', {
                    kind: kindLabel(e),
                    value: e.value,
                  })
                "
                :data-test="`security-open-case-entity-${e.kind}`"
              />
            </div>
          </OFormCheckboxGroup>
          <span v-else class="text-text-secondary text-xs">{{
            t("siem.drawer.openCaseDialog.noEntities")
          }}</span>
        </div>
      </template>
      <OFormTextarea
        name="note"
        :label="t('siem.drawer.openCaseDialog.note')"
        :placeholder="t('siem.drawer.openCaseDialog.notePlaceholder')"
        :rows="3"
        data-test="security-open-case-note"
      />
    </OForm>
  </ODialog>
</template>
