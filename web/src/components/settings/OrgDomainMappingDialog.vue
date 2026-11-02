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
    data-test="settings-org-domain-mapping-dialog"
    v-model:open="dialogOpen"
    persistent
    size="md"
    :form-id="FORM_ID"
    :title="
      isEditing
        ? t('settings.orgDomainMapping.editMapping')
        : t('settings.orgDomainMapping.addMapping')
    "
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="isEditing ? t('common.save') : t('common.add')"
    @click:secondary="dialogOpen = false"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormSelect
        data-test="settings-org-domain-mapping-domain-select"
        name="domain"
        :label="t('settings.orgDomainMapping.domain')"
        :options="domainOptions"
        required
        :help-text="t('settings.orgDomainMapping.mappingDomainHelp')"
      />

      <OFormSelect
        data-test="settings-org-domain-mapping-org-select"
        name="org_id"
        :label="t('settings.orgDomainMapping.organization')"
        :options="orgOptions"
        required
        :help-text="t('settings.orgDomainMapping.organizationHelp')"
      />

      <OFormSelect
        data-test="settings-org-domain-mapping-role-select"
        name="base_role"
        :label="t('settings.orgDomainMapping.baseRole')"
        :options="roleOptions"
        required
        :help-text="t('settings.orgDomainMapping.baseRoleHelp')"
      />

      <OFormInput
        data-test="settings-org-domain-mapping-claim-input"
        name="role_claim_name"
        :label="t('settings.orgDomainMapping.roleClaimName')"
        :placeholder="t('settings.orgDomainMapping.roleClaimNamePlaceholder')"
        :help-text="t('settings.orgDomainMapping.roleClaimNameHelp')"
      />

      <OFormSwitch
        data-test="settings-org-domain-mapping-create-roles-switch"
        name="create_missing_roles"
        :label="t('settings.orgDomainMapping.createMissingRoles')"
        :disabled="!hasClaim"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { OrgDomainMapping } from "@/services/organizations";
import {
  BASE_ROLES,
  makeOrgDomainMappingSchema,
  orgDomainMappingDefaults,
  type BaseRole,
  type OrgDomainMappingForm,
} from "./OrgDomainMapping.schema";

const FORM_ID = "org-domain-mapping-form";

const props = withDefaults(
  defineProps<{
    open: boolean;
    mode: "add" | "edit";
    mapping?: OrgDomainMapping | null;
    /** Verified domains only; the backend rejects a mapping for any other. */
    domainOptions: SelectOption[];
    orgOptions: SelectOption[];
    defaultOrgId: string;
    /** `domain|org_id` of the other mappings, so one pair is mapped once. */
    takenKeys?: string[];
    /** Resolves true once the mapping is persisted; the dialog stays open on false. */
    submit: (_mapping: OrgDomainMapping) => Promise<boolean>;
  }>(),
  { mapping: null, takenKeys: () => [] },
);

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
}>();

const { t } = useI18nTyped();

const ROLE_LABEL_KEYS = {
  admin: "components.badge.userRole.admin",
  editor: "components.badge.userRole.editor",
  viewer: "components.badge.userRole.viewer",
  allowed_user: "components.badge.userRole.user",
} as const;

const roleOptions = computed<SelectOption[]>(() =>
  BASE_ROLES.map((role) => ({ label: t(ROLE_LABEL_KEYS[role]), value: role })),
);

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const isEditing = computed(() => props.mode === "edit");

const mappingDefaults = computed((): OrgDomainMappingForm => {
  const firstDomain = String(props.domainOptions[0]?.value ?? "");
  const base = orgDomainMappingDefaults(props.defaultOrgId, firstDomain);
  if (!props.mapping) return base;
  const role = props.mapping.base_role as BaseRole;
  return {
    domain: props.mapping.domain,
    org_id: props.mapping.org_id,
    base_role: BASE_ROLES.includes(role) ? role : base.base_role,
    role_claim_name: props.mapping.role_claim_name ?? "",
    create_missing_roles: props.mapping.create_missing_roles,
  };
});

const form = useOForm<OrgDomainMappingForm>({
  defaultValues: mappingDefaults.value,
  schema: makeOrgDomainMappingSchema(t),
  onSubmit,
});

const hasClaim = form.useStore((s) => s.values.role_claim_name.trim() !== "");

// The form outlives the dialog body, so it is re-seeded on every open.
watch(
  () => props.open,
  (visible) => {
    if (visible) form.reset(mappingDefaults.value);
  },
);

async function onSubmit(value: OrgDomainMappingForm) {
  const domain = value.domain.trim().toLowerCase();
  if (props.takenKeys.includes(`${domain}|${value.org_id}`)) {
    toast({ variant: "error", message: t("settings.orgDomainMapping.duplicateMapping") });
    return;
  }
  const claim = value.role_claim_name.trim();
  const saved = await props.submit({
    domain,
    org_id: value.org_id,
    base_role: value.base_role,
    role_claim_name: claim || null,
    create_missing_roles: !!claim && value.create_missing_roles,
  });
  if (saved) emit("update:open", false);
}
</script>
