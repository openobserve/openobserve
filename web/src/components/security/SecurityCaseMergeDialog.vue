<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { securityTime } from "@/utils/security/time";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { makeCaseMergeSchema, type CaseMergeValues } from "./SecurityCaseMergeDialog.schema";

export interface MergeCandidate {
  id: string;
  title?: string;
  /** Shown beside the title, so cases with the same title can be told apart. */
  entity?: string;
  priority?: string;
  /** Microseconds. */
  createdAt?: number;
  alertCount?: number;
}

const props = defineProps<{
  open: boolean;
  /** The selected cases; one is kept and the rest fold into it. */
  cases: MergeCandidate[];
  /** Resolves true once the server merged the cases. */
  merge: (targetId: string, sourceIds: string[], reason: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const FORM_ID = "security-case-merge-form";
const schema = makeCaseMergeSchema(t);
const defaults = computed<CaseMergeValues>(() => ({
  target: props.cases[0]?.id ?? "",
  reason: "",
}));
const targetOptions = computed(() =>
  props.cases.map((c) => ({
    // The id is in the label itself, so two cases with one title stay apart once picked.
    label: raw([c.priority, c.entity, c.title, c.id].filter(Boolean).join(" · ")),
    subLabel: t(
      "siem.cases.merge.candidateDetail",
      {
        id: raw(c.id),
        created: c.createdAt ? securityTime(c.createdAt / 1000) : "—",
        n: c.alertCount ?? 0,
      },
      c.alertCount ?? 0,
    ),
    value: c.id,
    searchText: `${c.title ?? ""} ${c.entity ?? ""} ${c.id}`,
  })),
);

async function onSubmit(value: CaseMergeValues) {
  const { target, reason } = schema.parse(value);
  const sources = props.cases.map((c) => c.id).filter((id) => id !== target);
  if (await props.merge(target, sources, reason)) emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('siem.cases.merge.title', { n: cases.length }, cases.length)"
    :form-id="FORM_ID"
    :primary-button-label="t('siem.cases.merge.submit')"
    :secondary-button-label="t('siem.cases.merge.cancel')"
    data-test="security-case-merge-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      v-if="open"
      :id="FORM_ID"
      :schema="schema"
      :default-values="defaults"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <OFormSelect
        name="target"
        :label="t('siem.cases.merge.target')"
        :help-text="t('siem.cases.merge.targetHint')"
        :options="targetOptions"
        searchable
        required
        data-test="security-case-merge-target"
      />
      <OFormTextarea
        name="reason"
        :label="t('siem.cases.merge.reason')"
        :placeholder="t('siem.cases.merge.reasonPlaceholder')"
        :rows="3"
        data-test="security-case-merge-reason"
      />
    </OForm>
  </ODialog>
</template>
