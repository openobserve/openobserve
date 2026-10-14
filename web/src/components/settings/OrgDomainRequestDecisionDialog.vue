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
  <ODialog
    data-test="settings-org-domain-request-decision-dialog"
    v-model:open="dialogOpen"
    persistent
    size="sm"
    :form-id="FORM_ID"
    :title="
      approve
        ? t('settings.orgDomainMapping.approveTitle')
        : t('settings.orgDomainMapping.rejectTitle')
    "
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="
      approve ? t('settings.orgDomainMapping.approve') : t('settings.orgDomainMapping.reject')
    "
    @click:secondary="dialogOpen = false"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <p v-if="request" class="text-text-body text-sm">
        {{
          approve
            ? t("settings.orgDomainMapping.approveBody", {
                domain: request.domain,
                org: request.org_id,
              })
            : t("settings.orgDomainMapping.rejectBody", {
                domain: request.domain,
                org: request.org_id,
              })
        }}
      </p>
      <OFormTextarea
        data-test="settings-org-domain-request-decision-reason"
        name="reason"
        :label="t('settings.orgDomainMapping.reason')"
        :required="!approve"
        :help-text="t('settings.orgDomainMapping.reasonHelp')"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import type { OrgDomainRequest } from "@/services/organizations";
import { makeRequestDecisionSchema, type RequestDecisionForm } from "./OrgDomainMapping.schema";

const FORM_ID = "org-domain-request-decision-form";

const props = defineProps<{
  open: boolean;
  request: OrgDomainRequest | null;
  approve: boolean;
  /** Resolves true once the decision is saved; the dialog stays open on false. */
  submit: (_reason: string) => Promise<boolean>;
}>();

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
}>();

const { t } = useI18nTyped();

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const form = useOForm<RequestDecisionForm>({
  defaultValues: { reason: "" },
  schema: makeRequestDecisionSchema(t, () => !props.approve),
  onSubmit,
});

// The form outlives the dialog body, so it is re-seeded on every open.
watch(
  () => props.open,
  (visible) => {
    if (visible) form.reset({ reason: "" });
  },
);

async function onSubmit(value: RequestDecisionForm) {
  const saved = await props.submit(value.reason.trim());
  if (saved) emit("update:open", false);
}
</script>
