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
  <ODrawer data-test="add-group-dialog"
    :open="open"
    :width="30"
    :title="t('iam.addGroup')"
    @update:open="emits('update:open', $event)"
  >
    <div data-test="add-group-section" class="tw:p-4">
      <OInput
        v-model.trim="name"
        :label="t('common.name') + ' *'"
        class="showLabelOnTop tw:mt-2"
        maxlength="100"
        data-test="add-group-groupname-input-btn"
        :error="showNameError"
        :error-message="nameErrorMessage"
        @update:model-value="showNameError = false"
      />

      <div class="flex justify-start tw:mt-6 tw:gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          @click="emits('update:open', false)"
          data-test="add-group-cancel-btn"
        >
          {{ t('alerts.cancel') }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="!name || !isValidGroupName"
          @click="saveGroup"
          data-test="add-group-submit-btn"
        >
          {{ t('alerts.save') }}
        </OButton>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { createGroup } from "@/services/iam";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { useQuasar } from "quasar";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useReo } from "@/services/reodotdev_analytics";

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

const q = useQuasar();

const { track } = useReo();

const store = useStore();

const isValidGroupName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9_]+$/;
  return roleNameRegex.test(name.value);
});

const showNameError = ref(false);
const nameErrorMessage = computed(() =>
  !name.value ? t('common.nameRequired') : `Use alphanumeric and '_' characters only, without spaces.`
);

const saveGroup = () => {
  if (!name.value || !isValidGroupName.value) return;
  createGroup(name.value, store.state.selectedOrganization.identifier)
    .then((res) => {
      emits("added:group", res.data);
      emits("update:open", false);

      q.notify({
        message: `User Group "${name.value}" Created Successfully!`,
        color: "positive",
        position: "bottom",
        timeout: 3000,
      });
    })
    .catch((err) => {
      if(err.response.status != 403){
        q.notify({
        message: "Error while creating group",
        color: "negative",
        position: "bottom",
        timeout: 3000,
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

