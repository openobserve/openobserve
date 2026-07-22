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
  <ODialog data-test="add-role-dialog"
    :open="open"
    size="sm"
    :title="t('iam.addRole')"
    :primaryButtonLabel="t('alerts.save')"
    :secondaryButtonLabel="t('alerts.cancel')"
    form-id="add-role-form"
    @click:secondary="emits('update:open', false)"
    @update:open="emits('update:open', $event)"
  >
    <div data-test="add-role-section">
      <OForm
        id="add-role-form"
        :schema="addRoleSchema"
        :default-values="addRoleDefaults"
        @submit="saveRole"
      >
        <OFormInput
          name="name"
          :label="t('common.name')"
          required
          class="showLabelOnTop mt-2"
          :maxlength="100"
          data-test="add-role-rolename-input-btn"
          :help-text="t('iam.nameHelpText')"
        />

        <div data-test="add-role-start-from-section" class="mt-4">
          <div class="mb-1 text-sm font-medium">
            {{ t("iam.role.startFrom.label") }}
          </div>
          <OFormRadioGroup name="startFrom" orientation="vertical">
            <ORadio
              v-for="option in startFromOptions"
              :key="option.value"
              :val="option.value"
              :label="option.label"
              :data-test="`add-role-start-from-${option.value}-radio`"
            />
          </OFormRadioGroup>
        </div>
      </OForm>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { createRole } from "@/services/iam";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { makeAddRoleSchema, type AddRoleForm } from "./AddRole.schema";

const { t } = useI18n();
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  role: {
    type: Object,
    default: () => null,
  },
  org_identifier: {
    type: String,
    default: "",
  },
});

const emits = defineEmits(["update:open", "added:role"]);

const { track } = useReo();

// "Start from" preset options — the selected value is form-owned (startFrom):
// "custom" = empty role (default); "readonly" = seed read-only permissions
// (AllowList + AllowGet) once the user lands on EditRole.
const startFromOptions = computed(() => [
  { label: t("iam.role.startFrom.custom"), value: "custom" },
  { label: t("iam.role.startFrom.readonly"), value: "readonly" },
]);

const store = useStore();

const addRoleSchema = makeAddRoleSchema(t);

// The OForm owns `name` + `startFrom`. The ODialog unmounts its body on close +
// remounts fresh on open, so this typed computed re-seeds `:default-values` each
// open (the optional `role` prop prefills the name; startFrom resets to "custom").
// No local model / watch.
const addRoleDefaults = computed((): AddRoleForm => ({
  name: props.role?.name ?? "",
  startFrom: "custom",
}));

// Plain async @submit handler — the validated `value` is the source of truth.
// The schema validates the trimmed name; trim again here so the saved value
// matches (mirrors the old `v-model.trim`). `saveRole` always calls createRole
// (even when prefilled in edit mode) — behavior preserved from the original.
// Emits the "start from" preset so AppRoles can seed EditRole's permissions.
const saveRole = async (value: AddRoleForm) => {
  const name = value.name.trim();
  try {
    await createRole(name, store.state.selectedOrganization.identifier);
    emits("update:open", false);
    emits("added:role", { role_name: name, startFrom: value.startFrom });
    toast({
      message: t("iam.addRolePage.roleCreated", { name }),
      variant: "success",
    });
  } catch (err: any) {
    if (err.response?.status != 403) {
      toast({
        message: err?.response?.data?.message,
        variant: "error",
      });
    }
    console.log(err);
  }

  track("Button Click", {
    button: "Save Role",
    page: "Add Role",
  });
};
</script>
