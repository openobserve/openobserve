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
  <ODialog data-test="add-group-dialog"
    :open="open"
    size="sm"
    :title="t('iam.addGroup')"
    :primaryButtonLabel="t('alerts.save')"
    :secondaryButtonLabel="t('alerts.cancel')"
    :primaryButtonDisabled="!name || !isValidGroupName"
    @click:primary="saveGroup"
    @click:secondary="emits('update:open', false)"
    @update:open="emits('update:open', $event)"
  >
    <div data-test="add-group-section">
      <OInput
        v-model.trim="name"
        :label="t('common.name') + ' *'"
        class="showLabelOnTop tw:mt-2"
        maxlength="100"
        data-test="add-group-groupname-input-btn"
        :error="showNameError"
        :error-message="nameErrorMessage"
        :help-text="!showNameError ? `Use alphanumeric and '_' characters only, without spaces.` : undefined"
        @update:model-value="showNameError = !!name && !isValidGroupName"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { createGroup } from "@/services/iam";
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
  group: {
    type: Object,
    default: () => null,
  },
  org_identifier: {
    type: String,
    default: "",
  },
});

const emits = defineEmits(["update:open", "added:group"]);

const name = ref(props.group?.name || "");


const { track } = useReo();

const store = useStore();

const isValidGroupName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9_]+$/;
  return roleNameRegex.test(name.value);
});

const showNameError = ref(false);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      name.value = props.group?.name || "";
      showNameError.value = false;
    }
  }
);
const nameErrorMessage = computed(() =>
  !name.value ? t('common.nameRequired') : `Use alphanumeric and '_' characters only, without spaces.`
);

const saveGroup = () => {
  if (!name.value || !isValidGroupName.value) return;
  createGroup(name.value, store.state.selectedOrganization.identifier)
    .then((res) => {
      emits("added:group", res.data);
      emits("update:open", false);

      toast({
        message: `User Group "${name.value}" Created Successfully!`,
        variant: "success",
      });
    })
    .catch((err) => {
      if(err.response.status != 403){
        toast({
        message: "Error while creating group",
        variant: "error",
      });
      }
      console.log(err);
    });
    track("Button Click", {
      button: "Save Group",
      page: "Add Group"
    });
};
</script>

