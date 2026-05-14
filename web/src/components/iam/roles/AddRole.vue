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
  <ODrawer data-test="add-role-dialog"
    :open="open"
    :width="30"
    :title="t('iam.addRole')"
    @update:open="emits('update:open', $event)"
  >
    <div data-test="add-role-section" class="tw:p-4">
      <q-input
        v-model.trim="name"
        :label="t('common.name') + ' *'"
        class="showLabelOnTop tw:mt-2"
        stack-label
        borderless
        dense
        :rules="[
          (val: any, rules: any) =>
            !!val
              ? isValidRoleName ||
                `Use alphanumeric and '_' characters only, without spaces.`
              : t('common.nameRequired'),
        ]"
        maxlength="100"
        data-test="add-role-rolename-input-btn"
        hide-bottom-space
      >
        <template v-slot:hint>
          Use alphanumeric and '_' characters only, without spaces.
        </template>
      </q-input>

      <div class="flex justify-start tw:mt-6 tw:gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          @click="emits('update:open', false)"
          data-test="add-alert-cancel-btn"
        >
          {{ t('alerts.cancel') }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="!name || !isValidRoleName"
          @click="saveRole"
          data-test="add-alert-submit-btn"
        >
          {{ t('alerts.save') }}
        </OButton>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { createRole, updateRole } from "@/services/iam";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
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

const q = useQuasar();

const isValidRoleName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9_]+$/;
  // Check if the role name is valid
  return roleNameRegex.test(name.value);
});

const saveRole = () => {
  if (!name.value || !isValidRoleName.value) return;
  createRole(name.value, store.state.selectedOrganization.identifier)
    .then(() => {
      emits("update:open", false);
      emits("added:role");
      q.notify({
        message: `Role "${name.value}" Created Successfully!`,
        color: "positive",
        position: "bottom",
        timeout: 3000,
      });
    })
    .catch((err) => {
      if(err.response.status != 403){
        q.notify({
        message: err?.response?.data?.message,
        color: "negative",
        position: "bottom",
        timeout: 3000,
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

