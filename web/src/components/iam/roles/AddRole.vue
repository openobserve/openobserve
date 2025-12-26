<!-- Copyright 2023 OpenObserve Inc.

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
  <q-card class="o2-side-dialog column full-height">
    <q-card-section class="q-py-md tw:w-full">
      <div class="row items-center no-wrap q-py-sm">
        <div class="col">
          <div data-test="add-role-section-title" style="font-size: 18px">
            {{ t("iam.addRole") }}
          </div>
        </div>
        <div class="col-auto">
          <q-icon
            data-test="add-role-close-dialog-btn"
            name="cancel"
            class="cursor-pointer"
            size="20px"
            @click="emits('cancel:hideform')"
          />
        </div>
      </div>

      <q-separator />
      <div data-test="add-role-section">
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

        <div class="flex justify-start tw:mt-6">
          <q-btn
            v-close-popup
            class="q-mr-md o2-secondary-button tw:h-[36px]"
            :label="t('alerts.cancel')"
            no-caps
            flat
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            @click="emits('cancel:hideform')"
            data-test="add-alert-cancel-btn"
          />
          <q-btn
            :disable="!name || !isValidRoleName"
            class="o2-primary-button no-border tw:h-[36px]"
            :label="t('alerts.save')"
            no-caps
            flat
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            @click="saveRole"
            data-test="add-alert-submit-btn"
          />
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { createRole, updateRole } from "@/services/iam";
import { useQuasar } from "quasar";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useReo } from "@/services/reodotdev_analytics";

const { t } = useI18n();
const props = defineProps({
  role: {
    type: Object,
    default: () => null,
  },
  org_identifier: {
    type: String,
    default: "",
  },
});

const emits = defineEmits(["cancel:hideform", "added:role"]);

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
      emits("cancel:hideform");
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

