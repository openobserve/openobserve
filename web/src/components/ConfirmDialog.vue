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
  <q-dialog>
    <q-card
      data-test="dialog-box"
      :class="warningMessage && warningMessage.length > 0 ? 'tw:w-[500px]' : 'tw:w-[240px]'"
    >
      <q-card-section class="confirmBody">
        <div class="head">{{ title }}</div>
        <div class="para">{{ message }}</div>
        <div v-if="warningMessage && warningMessage.length > 0" class="tw:mt-4">
          <q-banner :class="[
            'tw:border-l-4 tw:p-4 tw:rounded',
            store.state.theme === 'dark' 
              ? 'tw:bg-gray-800/60 tw:border-yellow-600/70' 
              : 'tw:bg-orange-50 tw:border-orange-400'
          ]">
            <template v-slot:avatar>
              <q-icon 
                name="warning" 
                :class="store.state.theme === 'dark' ? 'tw:text-yellow-500/80' : 'tw:text-orange-500'" 
                size="24px" 
              />
            </template>
            <div :class="[
              'tw:font-medium tw:text-sm tw:leading-relaxed tw:text-left',
              store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-orange-800'
            ]">
              {{ warningMessage }}
            </div>
          </q-banner>
        </div>
      </q-card-section>

      <q-card-actions class="confirmActions">
        <q-btn
          v-close-popup
          unelevated
          no-caps
          class="q-mr-sm o2-secondary-button"
          @click="onCancel"
          data-test="cancel-button"
        >
          {{ t("confirmDialog.cancel") }}
        </q-btn>
        <q-btn
          v-close-popup
          unelevated
          no-caps
          class="o2-primary-button"
          @click="onConfirm"
          data-test="confirm-button"
        >
          {{ t("confirmDialog.ok") }}
        </q-btn>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

export default defineComponent({
  name: "ConfirmDialog",
  emits: ["update:ok", "update:cancel"],
  props: ["title", "message", "warningMessage"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const onCancel = () => {
      emit("update:cancel");
    };

    const onConfirm = () => {
      emit("update:ok");
    };
    return {
      t,
      store,
      onCancel,
      onConfirm,
    };
  },
});
</script>
