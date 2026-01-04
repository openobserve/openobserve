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
      :class="
        warningMessage && warningMessage.length > 0
          ? 'tw:w-[600px]'
          : 'tw:w-[400px]'
      "
    >
      <q-card-section class="confirmBody">
        <div class="head">{{ title }}</div>
        <div class="para">{{ message }}</div>
        <div v-if="warningMessage && warningMessage.length > 0" class="tw:mt-4">
          <q-banner
            :class="[
              'tw:border-l-4 tw:p-4 tw:rounded',
              store.state.theme === 'dark'
                ? 'tw:bg-gray-800/60 tw:border-yellow-600/70'
                : 'tw:bg-orange-50 tw:border-orange-400',
            ]"
          >
            <template v-slot:avatar>
              <q-icon
                name="warning"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:text-yellow-500/80'
                    : 'tw:text-orange-500'
                "
                size="24px"
              />
            </template>
            <div
              :class="[
                'tw:font-medium tw:text-sm tw:leading-relaxed tw:text-left',
                store.state.theme === 'dark'
                  ? 'tw:text-gray-300'
                  : 'tw:text-orange-800',
              ]"
            >
              {{ warningMessage }}
            </div>
          </q-banner>
        </div>
        <div v-if="hasQuery" class="tw:mt-4">
          <q-checkbox
            v-model="replaceQuery"
            label="Also replace query with example query"
            data-test="replace-query-checkbox"
            :class="
              store.state.theme === 'dark'
                ? 'tw:text-gray-300'
                : 'tw:text-gray-700'
            "
          />
          <div
            class="tw:text-xs tw:mt-1 tw:ml-7"
            :class="
              store.state.theme === 'dark'
                ? 'tw:text-gray-400'
                : 'tw:text-gray-500'
            "
          >
            The example query will be inserted into the query editor
          </div>
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
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

export default defineComponent({
  name: "CustomChartConfirmDialog",
  emits: ["update:ok", "update:cancel"],
  props: {
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    warningMessage: {
      type: String,
      default: "",
    },
    currentQuery: {
      type: String,
      default: "",
    },
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    // If no query exists, default to true (auto-checked); otherwise false
    const hasQuery = computed(() => props.currentQuery?.trim().length > 0);
    const replaceQuery = ref(!hasQuery.value);

    const onCancel = () => {
      emit("update:cancel");
    };

    const onConfirm = () => {
      emit("update:ok", { replaceQuery: replaceQuery.value });
    };
    return {
      t,
      store,
      replaceQuery,
      hasQuery,
      onCancel,
      onConfirm,
    };
  },
});
</script>
