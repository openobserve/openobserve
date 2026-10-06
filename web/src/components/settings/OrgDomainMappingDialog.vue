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
      <OFormInput
        data-test="settings-org-domain-mapping-domain-input"
        name="domain"
        :label="t('settings.orgDomainMapping.domain')"
        required
        :disabled="!!mapping?.domain"
        :placeholder="t('settings.domainPlaceholder', { example: raw('example.com') })"
        :help-text="t('settings.orgDomainMapping.domainHelp', { at_sign: '@' })"
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
        name="role_name"
        :label="t('settings.orgDomainMapping.role')"
        :options="roleOptions"
        :loading="customRoles.isFetching.value"
        required
        :help-text="t('settings.orgDomainMapping.roleHelp')"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { rolesQuery } from "@/services/iam.queries";
import {
  BUILT_IN_ROLES,
  makeOrgDomainMappingSchema,
  orgDomainMappingDefaults,
  type OrgDomainMapping,
  type OrgDomainMappingForm,
} from "./OrgDomainMapping.schema";

const FORM_ID = "org-domain-mapping-form";

const props = withDefaults(
  defineProps<{
    open: boolean;
    mode: "add" | "edit";
    /** Prefill; a set domain is locked, since changing it would need a new domain link. */
    mapping?: OrgDomainMapping | null;
    orgOptions: SelectOption[];
    defaultOrgId: string;
    /** Domains already mapped, excluding the one being edited. */
    takenDomains?: string[];
    /** Resolves true once the mapping is persisted; the dialog stays open on false. */
    submit: (_mapping: OrgDomainMapping) => Promise<boolean>;
  }>(),
  { mapping: null, takenDomains: () => [] },
);

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
}>();

const { t } = useI18nTyped();

const ROLE_LABEL_KEYS = {
  admin: "components.badge.userRole.admin",
  editor: "components.badge.userRole.editor",
  viewer: "components.badge.userRole.viewer",
  user: "components.badge.userRole.user",
} as const;

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const isEditing = computed(() => props.mode === "edit");

const mappingDefaults = computed((): OrgDomainMappingForm => {
  const base = orgDomainMappingDefaults(props.defaultOrgId);
  if (!props.mapping) return base;
  return {
    domain: props.mapping.domain,
    org_id: props.mapping.org_id,
    role_name: props.mapping.role_name || base.role_name,
  };
});

const form = useOForm<OrgDomainMappingForm>({
  defaultValues: mappingDefaults.value,
  schema: makeOrgDomainMappingSchema(t),
  onSubmit,
});

const selectedOrg = form.useStore((s) => s.values.org_id);
const selectedRole = form.useStore((s) => s.values.role_name);

// The caller may lack access to a child org's roles; that leaves only the built-in roles.
const customRoles = useQuery(() =>
  Object.assign(rolesQuery(selectedOrg.value), { enabled: props.open && !!selectedOrg.value }),
);

const roleOptions = computed<SelectOption[]>(() => {
  const builtIn = BUILT_IN_ROLES.map((role) => ({ label: t(ROLE_LABEL_KEYS[role]), value: role }));
  const custom = (Array.isArray(customRoles.data.value) ? customRoles.data.value : [])
    .filter((name: string) => !(BUILT_IN_ROLES as readonly string[]).includes(name))
    .map((name: string) => ({ label: raw(name), value: name }));
  return [...builtIn, ...custom];
});

// A custom role belongs to one org, so switching the target org can orphan the selection.
watch([selectedOrg, () => customRoles.isFetching.value], ([, fetching]) => {
  if (fetching) return;
  if (!roleOptions.value.some((o) => o.value === selectedRole.value)) {
    form.setFieldValue("role_name", "user");
  }
});

// The form outlives the dialog body, so it is re-seeded on every open.
watch(
  () => props.open,
  (visible) => {
    if (visible) form.reset(mappingDefaults.value);
  },
);

async function onSubmit(value: OrgDomainMappingForm) {
  const domain = value.domain.trim().toLowerCase();
  if (props.takenDomains.includes(domain)) {
    toast({ variant: "error", message: t("settings.orgDomainMapping.duplicateDomain") });
    return;
  }
  const saved = await props.submit({
    domain,
    org_id: value.org_id,
    role_name: value.role_name,
  });
  if (saved) emit("update:open", false);
}
</script>
