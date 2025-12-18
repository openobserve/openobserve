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
          <div data-test="add-group-section-title" style="font-size: 18px">
            {{ t("iam.addGroup") }}
          </div>
        </div>
        <div class="col-auto">
          <q-icon
            data-test="add-group-close-dialog-btn"
            name="cancel"
            class="cursor-pointer"
            size="20px"
            @click="emits('cancel:hideform')"
          />
        </div>
      </div>

      <q-separator />
      <div data-test="add-group-section">
        <q-input
          v-model.trim="name"
          :label="t('common.name') + ' *'"
          class="showLabelOnTop tw:mt-2"
          stack-label
          hide-bottom-space
          borderless
          dense
          :rules="[
            (val: any, rules: any) =>
              !!val
                ? isValidGroupName ||
                  `Use alphanumeric and '_' characters only, without spaces.`
                : t('common.nameRequired'),
          ]"
          maxlength="100"
          data-test="add-group-groupname-input-btn"
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
            @click="$emit('cancel:hideform')"
            data-test="add-group-cancel-btn"
          />
          <q-btn
            :disable="!name || !isValidGroupName"
            class="o2-primary-button no-border tw:h-[36px]"
            :label="t('alerts.save')"
            no-caps
            flat
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            @click="saveGroup"
            data-test="add-group-submit-btn"
          />
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { createGroup } from "@/services/iam";
import { useQuasar } from "quasar";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useReo } from "@/services/reodotdev_analytics";

const { t } = useI18n();
const props = defineProps({
  group: {
    type: Object,
    default: () => null,
  },
  org_identifier: {
    type: String,
    default: "",
  },
});

const emits = defineEmits(["cancel:hideform", "added:group"]);

const name = ref(props.group?.name || "");

const q = useQuasar();

const { track } = useReo();

const store = useStore();

const isValidGroupName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9_]+$/;
  // Check if the role name is valid
  return roleNameRegex.test(name.value);
});

const saveGroup = () => {
  if (!name.value || !isValidGroupName.value) return;
  createGroup(name.value, store.state.selectedOrganization.identifier)
    .then((res) => {
      emits("added:group", res.data);
      emits("cancel:hideform");

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

