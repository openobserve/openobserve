<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <OCollapsible
    v-model="open"
    variant="sidebar"
    :label="t('workflow.http.advanced')"
    :caption="summary"
    data-test="workflow-http-advanced"
  >
    <div ref="body" class="flex flex-col gap-4 px-3 pt-2 pb-1">
      <OForm
        :key="formKey"
        :schema="schema"
        :default-values="defaults"
        class="flex flex-col gap-5"
        @submit="onSave"
      >
        <OFormInput
          name="maxBodyKib"
          type="number"
          :label="t('workflow.http.maxBody')"
          :help-text="t('workflow.http.maxBodyHint')"
          width="md"
          data-test="workflow-http-max-body"
        />
        <OFormInput
          name="rateLimit"
          type="number"
          :label="t('workflow.http.rateLimit')"
          :help-text="t('workflow.http.rateLimitHint', { org: orgBudget })"
          width="md"
          data-test="workflow-http-rate-limit"
        />
        <OBanner
          v-if="saveError"
          variant="error-soft"
          dense
          data-test="workflow-http-limits-error"
          :content="saveError"
        />
        <div>
          <OButton
            type="submit"
            variant="primary"
            size="sm-action"
            data-test="workflow-http-limits-save"
          >
            {{ t("common.save") }}
          </OButton>
        </div>
      </OForm>

      <div class="border-border-default flex flex-wrap items-center gap-3 border-t pt-3">
        <OText variant="meta" class="min-w-0 flex-1">{{ t("workflow.http.deleteMeta") }}</OText>
        <OPopover
          v-model:open="deleteOpen"
          side="bottom"
          align="end"
          :aria-label="t('workflow.http.deleteTitle')"
        >
          <template #trigger>
            <OButton variant="outline-destructive" size="xs" data-test="workflow-http-delete">
              {{ t("workflow.http.deleteButton") }}
            </OButton>
          </template>
          <div
            data-test="workflow-http-delete-popover"
            class="flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2 p-3"
          >
            <OText variant="body-strong">{{ t("workflow.http.deleteTitle") }}</OText>
            <OText variant="meta" as="p">{{ t("workflow.http.deleteBody") }}</OText>
            <OBanner
              v-if="deleteError"
              variant="error-soft"
              dense
              data-test="workflow-http-delete-error"
              :content="deleteError"
            />
            <div class="flex justify-end gap-2">
              <OButton
                variant="outline"
                size="sm-action"
                data-test="workflow-http-delete-cancel"
                @click="deleteOpen = false"
              >
                {{ t("common.cancel") }}
              </OButton>
              <OButton
                variant="destructive"
                size="sm-action"
                :loading="deleting"
                data-test="workflow-http-delete-confirm"
                @click="onDelete"
              >
                {{ t("common.delete") }}
              </OButton>
            </div>
          </div>
        </OPopover>
      </div>
    </div>
  </OCollapsible>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { formatBodySize, httpErrorText, useHttpEndpoint } from "@/plugins/workflows/httpEndpointUi";
import {
  MAX_BODY_KIB,
  httpLimitsDefaults,
  makeHttpLimitsSchema,
  type HttpLimitsForm,
} from "./WorkflowHttpAdvanced.schema";

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();
const { config, deleting, saveLimits, deleteEndpoint } = useHttpEndpoint();

const body = ref<HTMLElement | null>(null);
const deleteOpen = ref(false);
const saveError = ref<I18nText | null>(null);
const deleteError = ref<I18nText | null>(null);

const maxBodyBytes = computed(() => config.value?.max_body_bytes ?? MAX_BODY_KIB * 1024);
const rateLimit = computed(() => config.value?.rate_limit_per_minute ?? 0);
const orgBudget = computed(() => config.value?.org_rate_limit_per_minute ?? 0);
const schema = computed(() => makeHttpLimitsSchema(t, orgBudget.value));
const defaults = computed(() => httpLimitsDefaults(maxBodyBytes.value, rateLimit.value));
// The form remounts with the stored limits after each save, so it never shows stale values.
const formKey = computed(() => `${maxBodyBytes.value}-${rateLimit.value}-${orgBudget.value}`);
const summary = computed(() =>
  t(
    "workflow.http.advancedSummary",
    { size: formatBodySize(maxBodyBytes.value, t), count: rateLimit.value },
    rateLimit.value,
  ),
);

const onSave = async (value: HttpLimitsForm) => {
  saveError.value = null;
  try {
    await saveLimits({
      max_body_bytes: Number(value.maxBodyKib) * 1024,
      rate_limit_per_minute: Number(value.rateLimit),
    });
  } catch (err) {
    saveError.value = t("workflow.http.saveLimitsFailed", { reason: httpErrorText(err, t) });
  }
};

const onDelete = async () => {
  deleteError.value = null;
  try {
    await deleteEndpoint();
    deleteOpen.value = false;
  } catch (err) {
    deleteError.value = t("workflow.http.deleteFailed", { reason: httpErrorText(err, t) });
  }
};

/** Opens the section and puts the cursor in the rate field ("Raise limit"). */
const focusRateLimit = async () => {
  open.value = true;
  await nextTick();
  body.value
    ?.querySelector<HTMLInputElement>('[data-test="workflow-http-rate-limit-field"]')
    ?.focus();
};

watch(deleteOpen, (isOpen) => {
  if (isOpen) deleteError.value = null;
});

defineExpose({ focusRateLimit });
</script>
