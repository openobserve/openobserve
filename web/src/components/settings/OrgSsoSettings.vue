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
  <div data-test="settings-org-sso-settings">
    <div class="mb-3">
      <div class="text-xl font-semibold">{{ t("settings.orgDomainMapping.ssoTitle") }}</div>
      <div class="text-text-secondary text-sm">
        {{ t("settings.orgDomainMapping.ssoSubtitle") }}
      </div>
    </div>
    <OForm :form="form" class="flex flex-col gap-5" v-slot="{ isSubmitting }">
      <div class="w-100 max-md:w-full">
        <OFormSelect
          data-test="settings-org-sso-claim-parser-select"
          name="claimParserFunction"
          :label="t('settings.claimParserFunctionLabel')"
          :options="functionOptions"
          :loading="functions.isFetching.value"
          clearable
          :help-text="t('settings.orgDomainMapping.claimParserHelp')"
        >
          <template #empty>
            <span>{{ t("settings.noVrlFunctionsFound") }}</span>
          </template>
        </OFormSelect>
      </div>
      <div class="w-100 max-md:w-full">
        <OFormInput
          data-test="settings-org-sso-role-claim-input"
          name="roleNameClaim"
          :label="t('settings.orgDomainMapping.roleNameClaim')"
          :placeholder="t('settings.orgDomainMapping.roleNameClaimPlaceholder')"
          :help-text="t('settings.orgDomainMapping.roleNameClaimHelp')"
        />
      </div>
      <OFormSwitch
        data-test="settings-org-sso-create-missing-role-switch"
        name="createMissingRole"
        :label="t('settings.orgDomainMapping.createMissingRole')"
      />
      <div>
        <OButton
          data-test="settings-org-sso-save-btn"
          variant="primary"
          size="sm-action"
          type="submit"
          :loading="isSubmitting"
          >{{ t("common.save") }}</OButton
        >
      </div>
    </OForm>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { functionsQuery } from "@/services/jstransform.queries";
import { updateOrgSettingsMutation } from "@/services/organizations.queries";
import { makeOrgSsoSettingsSchema, type OrgSsoSettingsForm } from "./OrgDomainMapping.schema";

const props = defineProps<{ orgId: string; settings: Record<string, any> }>();

const { t } = useI18nTyped();
const store = useStore();

const functions = useQuery(() => functionsQuery(props.orgId));
const updateSettings = useMutation(() => updateOrgSettingsMutation(props.orgId));

const functionOptions = computed<SelectOption[]>(() =>
  (functions.data.value ?? []).map((fn: any) => ({ label: raw(fn.name), value: fn.name })),
);

const form = useOForm<OrgSsoSettingsForm>({
  defaultValues: {
    claimParserFunction: props.settings.claim_parser_function ?? "",
    roleNameClaim: props.settings.role_name_claim ?? "",
    createMissingRole: props.settings.create_missing_role ?? false,
  },
  schema: makeOrgSsoSettingsSchema(),
  onSubmit,
});

async function onSubmit(value: OrgSsoSettingsForm) {
  const claimParserFunction = value.claimParserFunction ?? "";
  try {
    await updateSettings.mutateAsync({
      claim_parser_function: claimParserFunction,
      role_name_claim: value.roleNameClaim.trim(),
      create_missing_role: value.createMissingRole,
    });
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        raw(err?.response?.data?.message || err?.message) ||
        t("settings.orgDomainMapping.saveFailed"),
    });
    return;
  }
  store.dispatch("setOrganizationSettings", {
    ...store.state.organizationData?.organizationSettings,
    claim_parser_function: claimParserFunction,
  });
  toast({ variant: "success", message: t("settings.orgDomainMapping.ssoSaved") });
}
</script>
