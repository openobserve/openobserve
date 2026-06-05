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
    :primaryButtonDisabled="!name || !isValidRoleName"
    @click:primary="saveRole"
    @click:secondary="emits('update:open', false)"
    @update:open="emits('update:open', $event)"
  >
    <div data-test="add-role-section">
      <OInput
        v-model.trim="name"
        :label="t('common.name') + ' *'"
        class="showLabelOnTop tw:mt-2"
        maxlength="100"
        data-test="add-role-rolename-input-btn"
        :error="showNameError"
        :error-message="nameErrorMessage"
        :help-text="!showNameError ? `Use alphanumeric and '_' characters only, without spaces.` : undefined"
        @update:model-value="showNameError = !!name && !isValidRoleName"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { createRole, updateRole } from "@/services/iam";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";

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

const name = ref(props.role?.name || "");

const store = useStore();


const isValidRoleName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9_]+$/;
  return roleNameRegex.test(name.value);
});

const showNameError = ref(false);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      name.value = props.role?.name || "";
      showNameError.value = false;
    }
  }
);

const nameErrorMessage = computed(() =>
  !name.value ? t('common.nameRequired') : `Use alphanumeric and '_' characters only, without spaces.`
);

const saveRole = () => {
  if (!name.value || !isValidRoleName.value) return;
  createRole(name.value, store.state.selectedOrganization.identifier)
    .then(() => {
      emits("update:open", false);
      emits("added:role");
      toast({
        message: `Role "${name.value}" Created Successfully!`,
        variant: "success",
      });
    })
    .catch((err) => {
      if(err.response.status != 403){
        toast({
        message: err?.response?.data?.message,
        variant: "error",
      });
      }
      console.log(err);
    });
    track("Button Click", {
      button: "Save Role",
      page: "Add Role"
    });
};
</script>

