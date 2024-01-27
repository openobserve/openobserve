<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div style="padding: 10px; min-width: 40%" class="scroll o2-input">
    <div
      class="flex justify-between items-center q-pa-md"
      style="border-bottom: 2px solid gray; margin-bottom: 5px"
    >
      <div class="flex items-center q-table__title q-mr-md">
        <span data-test="dashboard-viewpanel-title"> Create Drilldown </span>
      </div>
      <div class="flex q-gutter-sm items-center">
        <q-btn
          no-caps
          @click="$emit('close')"
          padding="xs"
          class="q-ml-md"
          flat
          icon="close"
          data-test="dashboard-viewpanel-close-btn"
        />
      </div>
    </div>
    <q-input
      v-model="drilldownData.name"
      :label="t('dashboard.nameOfVariable') + '*'"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      outlined
      filled
      dense
      :rules="[(val) => !!val.trim() || t('dashboard.nameRequired')]"
      :lazy-rules="true"
      style="width: 400px"
    />
    Action:
    <div style="display: flex; flex-direction: row; gap: 10px">
      <q-btn
        :class="drilldownData.type == 'byDashboard' ? 'selected' : ''"
        size="sm"
        @click="
          () => {
            drilldownData.type = 'byDashboard';
          }
        "
        style="max-width: 100px; height: 80px"
        ><q-icon
          class="q-mr-xs"
          size="20px"
          :name="outlinedDashboard"
          style="cursor: pointer; height: 40px"
        />Go to Dashboard</q-btn
      >
      <q-btn
        :class="drilldownData.type === 'byUrl' ? 'selected' : ''"
        size="sm"
        @click="
          () => {
            drilldownData.type = 'byUrl';
          }
        "
        style="max-width: 100px; height: 80px"
        ><q-icon
          class="q-mr-xs"
          size="20px"
          name="link"
          style="cursor: pointer"
        />Go to URL</q-btn
      >
    </div>

    <div v-if="drilldownData.type == 'byUrl'">
      <q-input
        outlined
        v-model="drilldownData.data.url"
        filled
        autogrow
        class="showLabelOnTop"
        label="Enter URL:"
      />
    </div>

    <q-card-actions class="confirmActions">
      <q-btn
        v-close-popup
        unelevated
        no-caps
        class="q-mr-sm"
        @click="$emit('close')"
        data-test="cancel-button"
      >
        {{ t("confirmDialog.cancel") }}
      </q-btn>
      <q-btn
        v-close-popup
        unelevated
        no-caps
        class="no-border"
        color="primary"
        @click="() => {}"
        style="min-width: 60px"
        data-test="confirm-button"
      >
        {{ t("confirmDialog.ok") }}
      </q-btn>
    </q-card-actions>
  </div>
</template>

<script lang="ts">
import { ref } from "vue";
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { outlinedDashboard } from "@quasar/extras/material-icons-outlined";

export default defineComponent({
  name: "DrilldownPopUp",
  components: {},
  props: {},
  setup(props, { emit }) {
    const { t } = useI18n();
    const drilldownData: any = ref({
      name: "",
      type: "",
      data: {
        url: "",
      },
    });
    return {
      t,
      drilldownData,
      outlinedDashboard,
    };
  },
});
</script>

<style lang="scss" scoped></style>
