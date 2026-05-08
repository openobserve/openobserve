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
  <ODrawer
    :open="open"
    size="sm"
    :title="t('panel.layout')"
    :secondary-button-label="t('dashboard.cancel')"
    :primary-button-label="t('dashboard.save')"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
    @click:primary="submitForm()"
  >
  <div
    class="q-pa-none tw:w-[300px]!"
    :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
    style="min-height: inherit"
  >
    <q-form ref="panelFormRef" @submit="savePanelLayout">
      <div class="q-mx-md">
        <div
          data-test="panel-layout-settings-height"
          class="o2-input"
          style="padding-top: 12px"
        >
          <q-input
            v-model.number="updatedLayout.h"
            :label="t('dashboard.panelHeight') + ' *'"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop"
            stack-label
            borderless
            hide-bottom-space
            dense
            type="number"
            :rules="[
              (val: any) => {
                if (val === null || val === undefined || val === '') {
                  return t('common.required'); // If value is empty or null
                }
                return val > 0 ? true : t('common.valueMustBeGreaterThanZero'); // Ensure value is greater than 0
              },
            ]"
            style="min-width: 220px"
            data-test="panel-layout-settings-height-input"
          />

          <div class="tw:text-[12px] tw:flex tw:items-center tw:gap-1 tw:mt-1">
            <span class="tw:whitespace-nowrap">Approximately <strong>{{ getRowCount }}</strong> table rows will be displayed</span>
            <q-icon
              name="info_outline"
              class="cursor-pointer tw:shrink-0"
              size="14px"
            >
              <q-tooltip
                anchor="center end"
                self="center left"
                class="tw:text-[12px]"
              >
                1 unit = 30px
              </q-tooltip>
            </q-icon>
          </div>

       
        </div>
      </div>
    </q-form>
  </div>
  </ODrawer>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getImageURL } from "../../utils/zincutils";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
export default defineComponent({
  name: "PanelLayoutSettings",
  components: { ODrawer },
  props: {
    layout: {
      type: Object,
      required: true,
    },
    open: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["save:layout", "close", "update:open"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();

    const panelFormRef = ref(null);
    const updatedLayout = ref({ ...props.layout });

    const savePanelLayout = () => {
      emit("save:layout", { ...updatedLayout.value });
    };

    const submitForm = () => {
      panelFormRef.value?.submit();
    };

    const getRowCount = computed(() => {
      // 24 is the height of toolbar
      // 28.5 is the height of each row
      const count = Number(Math.ceil((updatedLayout.value.h * 30 - 24) / 28.5));

      if (count < 0) return 0;

      return count;
    });

    return {
      t,
      store,
      router,
      getImageURL,
      savePanelLayout,
      submitForm,
      getRowCount,
      updatedLayout,
      panelFormRef,
    };
  },
});
</script>

<style scoped lang="scss">
.dark-mode {
  background-color: $dark-page;
}
</style>
