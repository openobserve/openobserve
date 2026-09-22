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
    data-test="settings-domain-org-mapping-dialog"
    v-model:open="dialogOpen"
    persistent
    size="md"
    :form-id="FORM_ID"
    :title="
      isEditing
        ? t('settings.domainOrgMappings.editMapping')
        : t('settings.domainOrgMappings.addMapping')
    "
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="isEditing ? t('common.save') : t('common.add')"
    @click:secondary="onCancel"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormInput
        data-test="settings-domain-org-mapping-domain-input"
        name="domain"
        :label="t('settings.domainOrgMappings.domain')"
        required
        :placeholder="t('settings.domainPlaceholder', { example: raw('example.com') })"
        :help-text="t('settings.domainOrgMappings.domainHelp', { at_sign: '@' })"
      />

      <OFormInput
        data-test="settings-domain-org-mapping-org-input"
        name="org_id"
        :label="t('settings.domainOrgMappings.organization')"
        required
        :placeholder="t('settings.domainOrgMappings.organizationPlaceholder')"
        :help-text="t('settings.domainOrgMappings.organizationHelp')"
      />

      <OFormSelect
        data-test="settings-domain-org-mapping-role-select"
        name="base_role"
        :label="t('settings.domainOrgMappings.baseRole')"
        :options="roleOptions"
        :searchable="false"
        required
        :help-text="t('settings.domainOrgMappings.baseRoleHelp')"
      />

      <OFormInput
        data-test="settings-domain-org-mapping-group-input"
        name="user_group"
        :label="t('settings.domainOrgMappings.userGroup')"
        :placeholder="t('settings.domainOrgMappings.userGroupPlaceholder')"
        :help-text="t('settings.domainOrgMappings.userGroupHelp')"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  DOMAIN_ORG_BASE_ROLES,
  domainOrgMappingDefaults,
  makeDomainOrgMappingSchema,
  type DomainOrgMapping,
  type DomainOrgMappingForm,
} from "./DomainOrgMappings.schema";

const FORM_ID = "domain-org-mapping-form";

const props = withDefaults(
  defineProps<{
    open: boolean;
    mapping?: DomainOrgMapping | null;
    /** Domains already mapped, excluding the one being edited — blocks duplicates. */
    takenDomains?: string[];
  }>(),
  { mapping: null, takenDomains: () => [] },
);

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
  (_e: "save", _value: DomainOrgMapping): void;
}>();

const { t } = useI18nTyped();

// A dynamic `t()` key is untypable, so the role→label mapping is a literal map.
// `allowed_user` is the OpenFGA relation for the User role, so it reuses that label.
const ROLE_LABEL_KEYS = {
  admin: "components.badge.userRole.admin",
  editor: "components.badge.userRole.editor",
  viewer: "components.badge.userRole.viewer",
  allowed_user: "components.badge.userRole.user",
} as const;

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const isEditing = computed(() => !!props.mapping?.domain);

const roleOptions = computed(() =>
  DOMAIN_ORG_BASE_ROLES.map((role) => ({
    label: t(ROLE_LABEL_KEYS[role]),
    value: role,
  })),
);

// Edit-prefill defaults → a typed computed, re-applied via form.reset on open.
const mappingDefaults = computed((): DomainOrgMappingForm => {
  const base = domainOrgMappingDefaults();
  if (!props.mapping) return base;
  return {
    domain: props.mapping.domain ?? "",
    org_id: props.mapping.org_id ?? "",
    base_role: props.mapping.base_role ?? base.base_role,
    user_group: props.mapping.user_group ?? "",
  };
});

const form = useOForm<DomainOrgMappingForm>({
  defaultValues: mappingDefaults.value,
  schema: makeDomainOrgMappingSchema(t),
  onSubmit,
});

// The form is created here so it survives the dialog body's unmount, so it is
// re-seeded from the current mapping on every open.
watch(
  () => props.open,
  (visible) => {
    if (visible) form.reset(mappingDefaults.value);
  },
);

function onSubmit(value: DomainOrgMappingForm) {
  const domain = value.domain.trim().toLowerCase();
  if (props.takenDomains.includes(domain)) {
    toast({ variant: "error", message: t("settings.domainOrgMappings.duplicateDomain") });
    return;
  }

  emit("save", {
    domain,
    org_id: value.org_id.trim(),
    base_role: value.base_role,
    // Omitted rather than "" so the payload matches the optional backend field.
    user_group: value.user_group?.trim() || undefined,
  });
  emit("update:open", false);
}

function onCancel() {
  emit("update:open", false);
}
</script>
