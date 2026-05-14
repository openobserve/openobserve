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
  <ODialog
    v-model:open="open"
    data-test="confirm-dialog"
    :size="warningMessage?.length ? 'md' : 'sm'"
    :title="title"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div data-test="dialog-box" class="tw:text-center">
      <div class="para">{{ message }}</div>
      <div v-if="warningMessage && warningMessage.length > 0" class="tw:mt-4 tw:text-left">
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
    </div>
  </ODialog>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

export default defineComponent({
  name: "ConfirmDialog",
  components: { ODialog },
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  props: {
    title: { type: String },
    message: { type: String },
    warningMessage: { type: String },
    modelValue: { type: Boolean, default: false },
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const open = computed({
      get: () => props.modelValue ?? false,
      set: (v: boolean) => emit("update:modelValue", v),
    });

    const onCancel = () => {
      open.value = false;
      emit("update:cancel");
    };

    const onConfirm = () => {
      open.value = false;
      emit("update:ok");
    };

    return {
      t,
      store,
      open,
      onCancel,
      onConfirm,
    };
  },
});
</script>
