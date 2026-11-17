<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Exceptions drop matching rows before a detection fires; the rule and its SQL stay untouched. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { securityTime } from "@/utils/security/time";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { isForbiddenError } from "@/composables/security/useSecurityAccess";
import { streamSchemaQuery } from "@/services/stream.queries";
import {
  addDetectionExceptionMutation,
  allowlistsQuery,
  deleteDetectionExceptionMutation,
  detectionExceptionsQuery,
} from "@/services/securitySigma.queries";
import type { DetectionException } from "@/services/securitySigma";
import { detectionSaveFailure } from "@/utils/security/detectionFolder";
import {
  EXCEPTION_EXPIRY_DAYS,
  EXCEPTION_OPERATORS,
  exceptionDefaults,
  exceptionPayload,
  makeExceptionSchema,
  type ExceptionFormValues,
} from "./SecurityDetectionExceptions.schema";

const props = defineProps<{
  orgId: string;
  alertId: string;
  stream: string;
  canAuthor: boolean;
  canAdmin: boolean;
}>();

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();
const FORM_ID = "security-detection-exceptions-form";
const schema = makeExceptionSchema(t);

const list = useQuery(() => detectionExceptionsQuery(props.orgId, props.alertId));
const exceptions = computed<DetectionException[]>(() => list.data.value ?? []);
const schemaQuery = useQuery(() => ({
  ...streamSchemaQuery(props.orgId, props.stream, "logs"),
  enabled: !!props.stream && props.canAuthor,
}));
const fieldOptions = computed(() =>
  ((schemaQuery.data.value as { schema?: { name: string }[] } | undefined)?.schema ?? [])
    .map((f) => String(f.name))
    .filter((name) => !name.startsWith("_"))
    .sort()
    .map((name) => ({ label: raw(name), value: name })),
);
const operatorOptions = computed(() =>
  EXCEPTION_OPERATORS.map((op) => ({ label: t(`siem.detections.exceptions.op.${op}`), value: op })),
);
const expiryOptions = computed(() =>
  EXCEPTION_EXPIRY_DAYS.map((days) => ({
    label: days
      ? t("siem.detections.exceptions.expiresIn", { n: days }, days)
      : t("siem.detections.exceptions.never"),
    value: days,
  })),
);

const adding = ref(false);
const form = useOForm<ExceptionFormValues>({
  defaultValues: exceptionDefaults(),
  schema,
  onSubmit,
});
const operator = form.useStore((s: { values: ExceptionFormValues }) => s.values.operator);

const allowlists = useQuery(() => ({
  ...allowlistsQuery(props.orgId),
  enabled: !!props.orgId,
}));
const listNames = computed(
  () => new Map((allowlists.data.value ?? []).map((l) => [l.id, l.name] as const)),
);
const listOptions = computed(() =>
  (allowlists.data.value ?? []).map((l) => ({
    label: raw(l.name),
    value: l.id,
    suffix: t(`siem.tuning.allowlists.purpose.${l.purpose}`),
  })),
);
/** An `in_list` exception stores list ids; show each list's name where it is known. */
const valueLabel = (ex: DetectionException, v: string) =>
  ex.operator === "in_list" ? (listNames.value.get(v) ?? v) : v;

/** Which detections only filter the exception's rows, so an author can see where it is weak. */
const notEnforcedDetail = (ex: DetectionException) =>
  t("siem.detections.exceptions.notEnforcedDetail", {
    names: raw((ex.not_enforced ?? []).map((d) => d.name).join(", ")),
  });

function startAdding() {
  form.reset();
  adding.value = true;
}
const add = useMutation(computed(() => addDetectionExceptionMutation(props.orgId, props.alertId)));
const remove = useMutation(
  computed(() => deleteDetectionExceptionMutation(props.orgId, props.alertId)),
);

function failure(e: unknown) {
  const { reason, forbidden } = detectionSaveFailure(e);
  if (reason) return raw(reason);
  return forbidden
    ? t("siem.detections.exceptions.forbidden")
    : t("siem.detections.exceptions.saveFailed");
}

async function onSubmit(value: ExceptionFormValues) {
  try {
    await add.mutateAsync(exceptionPayload(value));
    toast({ variant: "success", message: t("siem.detections.exceptions.added") });
    adding.value = false;
  } catch (e) {
    toast({ variant: "error", message: failure(e) });
  }
}

async function onDelete(ex: DetectionException) {
  const ok = await confirm({
    title: t("siem.detections.exceptions.deleteTitle"),
    message: t("siem.detections.exceptions.deleteMessage", { field: ex.field }),
    confirmLabel: t("siem.detections.exceptions.delete"),
  });
  if (!ok) return;
  try {
    await remove.mutateAsync(ex.id);
    toast({ variant: "success", message: t("siem.detections.exceptions.deleted") });
  } catch (e) {
    toast({ variant: "error", message: failure(e) });
  }
}

const opLabel = (op: string) =>
  (EXCEPTION_OPERATORS as readonly string[]).includes(op)
    ? t(`siem.detections.exceptions.op.${op as (typeof EXCEPTION_OPERATORS)[number]}`)
    : raw(op);
</script>

<template>
  <div class="flex flex-col gap-3" data-test="security-detection-exceptions">
    <div class="flex items-center gap-2">
      <span class="text-text-secondary min-w-0 flex-1 text-xs">{{
        t("siem.detections.exceptions.about")
      }}</span>
      <OButton
        v-if="canAuthor && !adding"
        variant="outline"
        size="sm"
        icon-left="add"
        data-test="security-detection-exceptions-add"
        @click="startAdding"
        >{{ t("siem.detections.exceptions.add") }}</OButton
      >
    </div>

    <div
      v-if="adding"
      class="border-border-default rounded-surface flex flex-col gap-3 border p-3"
      data-test="security-detection-exceptions-form"
    >
      <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <OFormSelect
            v-if="fieldOptions.length"
            name="field"
            :label="t('siem.detections.exceptions.field')"
            :options="fieldOptions"
            searchable
            required
            data-test="security-detection-exceptions-field"
          />
          <OFormInput
            v-else
            name="field"
            :label="t('siem.detections.exceptions.field')"
            required
            data-test="security-detection-exceptions-field"
          />
          <OFormSelect
            name="operator"
            :label="t('siem.detections.exceptions.operator')"
            :options="operatorOptions"
            data-test="security-detection-exceptions-operator"
          />
        </div>
        <OFormSelect
          v-if="operator === 'in_list'"
          name="lists"
          multiple
          searchable
          :label="t('siem.detections.exceptions.lists')"
          :placeholder="t('siem.detections.exceptions.listsPlaceholder')"
          :help-text="listOptions.length ? undefined : t('siem.detections.exceptions.noLists')"
          :options="listOptions"
          :loading="allowlists.isLoading.value"
          required
          data-test="security-detection-exceptions-lists"
        />
        <OFormTextarea
          v-else
          name="values"
          :label="t('siem.detections.exceptions.values')"
          :placeholder="t('siem.detections.exceptions.valuesPlaceholder')"
          :rows="3"
          required
          data-test="security-detection-exceptions-values"
        />
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <OFormInput
            name="comment"
            :label="t('siem.detections.exceptions.comment')"
            class="md:col-span-2"
            required
            data-test="security-detection-exceptions-comment"
          />
          <OFormSelect
            name="expiryDays"
            :label="t('siem.detections.exceptions.expires')"
            :options="expiryOptions"
            data-test="security-detection-exceptions-expiry"
          />
        </div>
        <div class="flex justify-end gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="security-detection-exceptions-cancel"
            @click="adding = false"
            >{{ t("siem.detections.cancel") }}</OButton
          >
          <OButton
            variant="primary"
            size="sm-action"
            type="submit"
            data-test="security-detection-exceptions-save"
            >{{ t("siem.detections.exceptions.save") }}</OButton
          >
        </div>
      </OForm>
    </div>

    <div v-if="list.isLoading.value" class="flex items-center justify-center py-6">
      <OSpinner size="sm" />
    </div>
    <OBanner
      v-else-if="list.isError.value && !isForbiddenError(list.error.value)"
      variant="error-soft"
      icon="error-outline"
      dense
      data-test="security-detection-exceptions-error"
      >{{ t("siem.detections.exceptions.loadError") }}</OBanner
    >
    <OEmptyState
      v-else-if="!exceptions.length && !adding"
      size="inline"
      icon="rule"
      :title="t('siem.detections.exceptions.empty')"
      :description="t('siem.detections.exceptions.emptyHint')"
      data-test="security-detection-exceptions-empty"
    />
    <ul
      v-else-if="exceptions.length"
      class="border-border-default rounded-surface overflow-hidden border"
      data-test="security-detection-exceptions-list"
    >
      <li
        v-for="ex in exceptions"
        :key="ex.id"
        class="border-border-subtle flex items-start gap-3 border-b px-3 py-2 last:border-b-0"
        :data-test="`security-detection-exception-${ex.id}`"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-text-heading font-mono">{{ ex.field }}</span>
            <span class="text-text-secondary">{{ opLabel(ex.operator) }}</span>
            <OTag
              v-for="v in ex.values.slice(0, 6)"
              :key="v"
              variant="default-soft"
              size="xs"
              class="font-mono"
              >{{ valueLabel(ex, v) }}</OTag
            >
            <span v-if="ex.values.length > 6" class="text-text-secondary">{{
              t("siem.detections.exceptions.moreValues", { n: ex.values.length - 6 })
            }}</span>
            <OTag v-if="ex.expired" variant="warning-soft" size="xs">{{
              t("siem.detections.exceptions.expired")
            }}</OTag>
            <span
              v-if="ex.not_enforced?.length"
              :data-test="`security-detection-exception-not-enforced-${ex.id}`"
            >
              <OTag variant="warning-soft" size="xs">{{
                t(
                  "siem.detections.exceptions.notEnforced",
                  { n: ex.not_enforced.length },
                  ex.not_enforced.length,
                )
              }}</OTag>
              <OTooltip :content="notEnforcedDetail(ex)" />
            </span>
          </div>
          <span class="text-text-body text-xs">{{ ex.comment }}</span>
          <span class="text-text-secondary text-2xs flex items-center gap-1">
            {{ ex.created_by }} ·
            <OTimeCell :value="ex.created_at" unit="us" class="text-2xs" />
            <template v-if="ex.expires_at">
              · {{ t("siem.detections.exceptions.until") }}
              <span data-test="security-detection-exceptions-until">{{
                securityTime(ex.expires_at / 1000)
              }}</span>
            </template>
          </span>
        </div>
        <OButton
          v-if="canAdmin"
          variant="ghost-destructive"
          size="icon-sm"
          icon-left="delete"
          :aria-label="t('siem.detections.exceptions.delete')"
          :data-test="`security-detection-exception-delete-${ex.id}`"
          @click="onDelete(ex)"
        >
          <OTooltip :content="t('siem.detections.exceptions.delete')" />
        </OButton>
      </li>
    </ul>
  </div>
</template>
