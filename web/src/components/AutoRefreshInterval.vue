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
  <div :class="isCompact ? 'tw:flex tw:items-center' : 'q-pl-sm float-left'">
    <!-- Compact mode: Simple toggle button with dropdown menu -->
    <OButton
      v-if="isCompact"
      data-test="logs-search-bar-refresh-interval-btn"
      size="icon-toolbar"
      variant="outline"
      :active="isAnimating"
    >
      <q-icon
        name="update"
        :class="isAnimating ? 'rotating-icon' : ''"
        size="18px"
      />
      <q-tooltip class="tw:text-[12px]" :offset="[0, 2]">
        {{ t("search.autoRefresh") }}: {{ selectedLabel }}
      </q-tooltip>

      <!-- Dropdown menu for interval selection -->
      <q-menu content-style="z-index: 10001">
        <div class="row">
          <div
            class="col col-12 q-pa-sm"
            style="text-align: center; width: 300px"
          >
            <OButton
              data-test="logs-search-off-refresh-interval"
              :variant="modelValue.toString() === '0' ? 'primary' : 'ghost'"
              size="sm"
              :block="true"
              v-close-popup="true"
              @click="onItemClick({ label: t('common.off'), value: 0 })"
            >
              {{ t("common.off") }}
            </OButton>
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
            <OButton
              :data-test="`logs-search-bar-refresh-time-${item.value}`"
              :variant="Number(modelValue) === item.value ? 'primary' : 'ghost'"
              size="sm"
              @click="onItemClick(item)"
              v-close-popup="true"
              :disabled="item.disabled"
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
            </OButton>
          </div>
        </div>
      </q-menu>
    </OButton>

    <!-- Full mode: Dropdown with label -->
    <ODropdown
      v-else
      v-model:open="btnRefreshInterval"
      side="bottom"
      align="start"
    >
      <template #trigger>
        <OButton
          data-test="logs-search-bar-refresh-interval-btn-dropdown"
          variant="outline"
          size="sm-toolbar"
        >
          <div class="row items-center no-wrap">
            <q-icon
              left
              name="update"
              :class="[
                isAnimating ? 'rotating-icon' : '',
                isAnimating ? 'text-primary' : '',
              ]"
            />
            <div class="text-center">{{ selectedLabel }}</div>
            <q-icon
              name="arrow_drop_down"
              size="16px"
              class="tw:ml-0.5"
            />
          </div>
        </OButton>
      </template>
      <div class="tw:w-[300px] tw:p-2">
        <div class="row">
          <div
            class="col col-12 q-pa-sm"
            style="text-align: center"
          >
            <OButton
              data-test="logs-search-off-refresh-interval"
              :variant="modelValue.toString() === '0' ? 'primary' : 'ghost'"
              size="sm"
              :block="true"
              @click="() => { onItemClick({ label: t('common.off'), value: 0 }); btnRefreshInterval = false; }"
            >
              {{ t("common.off") }}
            </OButton>
          </div>
        </div>
        <ODropdownSeparator />
        <div v-for="(items, i) in refreshTimes" :key="'row_' + i" class="row">
          <div
            v-for="(item, j) in items"
            :key="'col_' + i + '_' + j"
            class="col col-4 q-pa-sm"
            style="text-align: center"
          >
            <OButton
              :data-test="`logs-search-bar-refresh-time-${item.value}`"
              :variant="Number(modelValue) === item.value ? 'primary' : 'ghost'"
              size="sm"
              @click="() => { onItemClick(item); btnRefreshInterval = false; }"
              :disabled="item.disabled"
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
            </OButton>
          </div>
        </div>
      </div>
    </ODropdown>
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
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";

export default defineComponent({
  name: "AutoRefreshInterval",
  components: { OButton, ODropdown, ODropdownSeparator },
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
    isCompact: {
      type: Boolean,
      default: false,
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
      const found = refreshTimes.value
        .flat()
        .find((it: any) => it.value == selectedValue.value);
      return found?.label || generateDurationLabel(selectedValue.value);
    });

    // Check if animation should be active
    const isAnimating = computed(() => {
      return props.isCompact && selectedValue.value > 0;
    });

    // Default refresh interval (5 seconds)
    const defaultRefreshInterval = 5;
    let lastSelectedInterval = 5;

    // Toggle refresh on/off
    const toggleRefresh = () => {
      if (selectedValue.value > 0) {
        // Currently ON, turn it OFF
        lastSelectedInterval = selectedValue.value;
        selectedValue.value = 0;
      } else {
        // Currently OFF, turn it ON with last interval or default
        selectedValue.value = lastSelectedInterval || defaultRefreshInterval;
      }
    };

    // Open dropdown for selecting specific interval (for right-click or future use)
    const openDropdown = () => {
      btnRefreshInterval.value = true;
    };

    // update model when the selection has changed
    const onItemClick = (item: any) => {
      selectedValue.value = item.value;
      if (item.value > 0) {
        lastSelectedInterval = item.value;
      }
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
      minRangeRestrictionMessageVal.value = t(
        "common.minRefreshIntervalMessage",
        { interval: props.minRefreshInterval },
      );
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
      isAnimating,
      selectedValue,
      toggleRefresh,
      openDropdown,
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

@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

:deep(.rotating-icon) {
  animation: rotate 2s linear infinite !important;
  transform-origin: center center !important;
  display: inline-block !important;
}

.rotating-icon {
  animation: rotate 2s linear infinite !important;
  transform-origin: center center !important;
  display: inline-block !important;
}
</style>
