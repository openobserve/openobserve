<!-- Copyright 2023 Zinc Labs Inc.

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
  <div class="bg-white">
    <div class="flex justify-between items-center q-px-md q-py-sm">
      <div style="font-size: 18px">
        {{ t("iam.addGroup") }}
      </div>
      <q-icon name="cancel" class="cursor-pointer" size="20px"></q-icon>
    </div>

    <div class="full-width bg-grey-4" style="height: 1px" />

    <div class="q-px-md q-mt-md o2-input">
      <q-input
        v-model.trim="name"
        :label="t('common.name') + ' *'"
        color="input-border"
        bg-color="input-bg"
        class="q-py-md showLabelOnTop"
        stack-label
        outlined
        filled
        dense
        :rules="[(val, rules) => !!val || t('common.nameRequired')]"
      />

      <div class="flex justify-center q-mt-lg">
        <q-btn
          data-test="add-alert-cancel-btn"
          v-close-popup="true"
          class="q-mb-md text-bold"
          :label="t('alerts.cancel')"
          text-color="light-text"
          padding="sm md"
          no-caps
          @click="$emit('cancel:hideform')"
        />
        <q-btn
          data-test="add-alert-submit-btn"
          :label="t('alerts.save')"
          class="q-mb-md text-bold no-border q-ml-md"
          color="secondary"
          padding="sm xl"
          no-caps
          @click="saveGroup"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { createGroup, updateGroup } from "@/services/iam";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const props = defineProps({
  width: {
    type: String,
    default: "30vw",
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

const emits = defineEmits(["cancel:hideform"]);

const name = ref(props.group?.name || "");

const isUpdating = computed(() => !!props.group);

const saveGroup = () => {
  const params = {
    name: name.value,
    org_identifier: props.org_identifier,
  };

  if (isUpdating.value) {
    _updateGroup(params);
  } else {
    _createGroup(params);
  }
};

const _createGroup = (params: { name: string; org_identifier: string }) => {
  createGroup(params.name, params.org_identifier)
    .then((res) => {
      console.log(res);
    })
    .catch((err) => {
      console.log(err);
    });
};

const _updateGroup = (params: { name: string; org_identifier: string }) => {
  updateGroup(params)
    .then((res) => {
      console.log(res);
    })
    .catch((err) => {
      console.log(err);
    });
};
</script>

<style scoped></style>
