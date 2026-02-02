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
  <div class="q-pl-sm float-left">
    <q-btn-dropdown
      data-test="logs-search-bar-refresh-interval-btn-dropdown"
      v-model="btnRefreshInterval"
      no-caps
      class="q-pa-xs element-box-shadow el-border"
      content-style="z-index: 10001"
    >
      <template v-slot:label>
        <div class="row items-center no-wrap">
          <q-icon left name="update" />
          <div class="text-center">{{ selectedLabel }}</div>
        </div>
      </template>
      <div class="row">
        <div class="col col-12 q-pa-sm" style="text-align: center; width: 300px">
          <q-btn
            data-test="logs-search-off-refresh-interval"
            no-caps
            :flat="modelValue.toString() !== '0'"
            size="md"
            :class="
              'no-border full-width ' +
              (modelValue.toString() === '0' ? 'selected' : '')
            "
            v-close-popup="true"
            @click="onItemClick({ label: t('common.off'), value: 0 })"
          >
            {{ t("common.off") }}
          </q-btn>
        </div>
      </div>
      <q-separator />
      <div v-for="(items, i) in refreshTimes" :key="'row_' + i" class="row">
        <div
          v-for="(item, j) in items"
          :key="'col_' + i + '_' + j"
          class="col col-4 q-pa-sm"
          style="text-align: center"
        >
          <q-btn
            :data-test="`logs-search-bar-refresh-time-${item.value}`"
            no-caps
            :flat="Number(modelValue) !== item.value"
            size="md"
            :class="[
              'no-border ' +
                (Number(modelValue) === item.value ? 'selected' : ''),
            ]"
            @click="onItemClick(item)"
            v-close-popup="true"
            :disable="item.disabled"
          >
            <q-tooltip
              v-if="item.disabled"
              style="z-index: 10001; font-size: 14px"
              anchor="center right"
              self="center left"
              max-width="300px"
            >
              {{ minRangeRestrictionMessageVal }}
            </q-tooltip>
            {{ item.label }}
          </q-btn>
        </div>
      </div>
    </q-btn-dropdown>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  watch,
  onActivated,
  onDeactivated,
  onMounted,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { generateDurationLabel } from "../utils/date";

export default defineComponent({
  name: "AutoRefreshInterval",
  props: {
    modelValue: {
      type: Number,
      default: 0,
    },
    trigger: {
      type: Boolean,
      default: false,
    },
    minRangeRestrictionMessage: {
      type: String,
      default: "",
    },
    minRefreshInterval: {
      type: Number,
      default: 0,
    },
  },
  emits: ["update:modelValue", "trigger"],
  setup(props: any, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();

    const btnRefreshInterval = ref(false);
    let intervalInstance = 0;

    const refreshTimes = computed(() => [
      [
        { label: `5 ${t("common.sec")}`, value: 5, disabled: false },
        { label: `1 ${t("common.min")}`, value: 60, disabled: false },
        { label: `1 ${t("common.hr")}`, value: 3600, disabled: false },
      ],
      [
        { label: `10 ${t("common.sec")}`, value: 10, disabled: false },
        { label: `5 ${t("common.min")}`, value: 300, disabled: false },
        { label: `2 ${t("common.hr")}`, value: 7200, disabled: false },
      ],
      [
        { label: `15 ${t("common.sec")}`, value: 15, disabled: false },
        { label: `15 ${t("common.min")}`, value: 900, disabled: false },
        { label: `1 ${t("common.day")}`, value: 86400, disabled: false },
      ],
      [
        { label: `30 ${t("common.sec")}`, value: 30, disabled: false },
        { label: `30 ${t("common.min")}`, value: 1800, disabled: false },
      ],
    ]);

    // v-model computed value
    const selectedValue = computed({
      get() {
        return props.modelValue;
      },
      set(value) {
        if (isDisabled(value)) {
          emit("update:modelValue", 0);
        }

        emit("update:modelValue", Number(value));
      },
    });

    // computed label based on the selected value
    const selectedLabel = computed(() => {
      // Handle "Off" case (value 0)
      if (selectedValue.value === 0) {
        return t("common.off");
      }

      // Find the label from refreshTimes
      const found = refreshTimes.value.flat().find((it: any) => it.value == selectedValue.value);
      return found?.label || generateDurationLabel(selectedValue.value);
    });

    // update model when the selection has changed
    const onItemClick = (item: any) => {
      selectedValue.value = item.value;
    };

    // watch on the selected value and update the timers
    watch(selectedValue, () => {
      resetTimers();
    });

    const resetTimers = () => {
      // first reset the current interval callback
      clearInterval(intervalInstance);

      // return if the interval value is zero
      if (selectedValue.value == 0 || !props.trigger) {
        return;
      }

      // if we have the value, continue and set the interval
      intervalInstance = window?.setInterval(() => {
        emit("trigger");
      }, selectedValue.value * 1000);
    };

    const minRangeRestrictionMessageVal = ref("");

    watch(
      () => props.minRefreshInterval,
      () => {
        updateDisabledFlags();
      },
    );

    const isDisabled = (value: number) => {
      return value < props.minRefreshInterval;
    };

    const updateDisabledFlags = () => {
      refreshTimes.value.forEach((row) => {
        row.forEach((item) => {
          item.disabled = isDisabled(item.value);
        });
      });
      minRangeRestrictionMessageVal.value = t("common.minRefreshIntervalMessage", { interval: props.minRefreshInterval });
    };

    onMounted(() => {
      // Initialize the disabled flags on component mount
      updateDisabledFlags();
    });

    // on component mount and unmount, update the intervals
    onActivated(() => {
      resetTimers();
    });

    onDeactivated(() => {
      clearInterval(intervalInstance);
    });

    return {
      t,
      router,
      btnRefreshInterval,
      selectedLabel,
      refreshTimes,
      onItemClick,
      minRangeRestrictionMessageVal,
    };
  },
});
</script>

<style lang="scss" scoped>
.refresh-interval-dropdown {
  min-width: 36px;
  height: 100%;
  min-height: 30px;
  line-height: 30px;
  padding: 0px 5px;
}
</style>
