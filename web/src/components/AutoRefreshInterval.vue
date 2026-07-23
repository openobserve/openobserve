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
  <div class="flex items-center">
    <!-- Compact mode: Simple toggle button with dropdown menu -->
    <ODropdown v-if="isCompact" v-model:open="btnRefreshInterval" side="bottom" align="start">
      <template #trigger>
        <OButton
          data-test="logs-search-bar-refresh-interval-btn"
          size="icon-toolbar"
          :variant="variant"
          :active="isAnimating"
        >
          <OIcon
            name="update"
            :class="isAnimating ? 'auto-refresh-icon--spinning' : ''"
            size="sm"
          />
          <OTooltip :content="`${t('search.autoRefresh')}: ${selectedLabel}`" />
        </OButton>
      </template>
      <div class="w-75 p-2">
        <div class="flex">
          <div class="flex w-full flex-col p-2 text-center">
            <OButton
              data-test="logs-search-off-refresh-interval"
              :variant="modelValue.toString() === '0' ? 'primary' : 'ghost'"
              size="sm"
              :block="true"
              @click="
                () => {
                  onItemClick({ label: t('common.off'), value: 0 });
                  btnRefreshInterval = false;
                }
              "
            >
              {{ t("common.off") }}
            </OButton>
          </div>
        </div>
        <hr class="border-border-default my-0 border-0 border-t border-solid" />
        <div v-for="(items, i) in refreshTimes" :key="'row_' + i" class="flex">
          <div
            v-for="(item, j) in items"
            :key="'col_' + i + '_' + j"
            class="flex w-1/3 flex-col p-2 text-center"
          >
            <OButton
              :data-test="`logs-search-bar-refresh-time-${item.value}`"
              :variant="Number(modelValue) === item.value ? 'primary' : 'ghost'"
              size="sm"
              @click="
                () => {
                  onItemClick(item);
                  btnRefreshInterval = false;
                }
              "
              :disabled="item.disabled"
            >
              <OTooltip
                v-if="item.disabled"
                side="right"
                align="center"
                max-width="18.75rem"
                :content="minRangeRestrictionMessageVal"
              />
              {{ item.label }}
            </OButton>
          </div>
        </div>
      </div>
    </ODropdown>

    <!-- Full mode: Dropdown with label -->
    <ODropdown v-else v-model:open="btnRefreshInterval" side="bottom" align="start">
      <template #trigger>
        <OButton
          data-test="logs-search-bar-refresh-interval-btn-dropdown"
          :variant="variant"
          size="sm-toolbar"
        >
          <div class="flex flex-nowrap items-center">
            <OIcon
              left
              name="update"
              size="sm"
              :class="[
                isAnimating ? 'auto-refresh-icon--spinning' : '',
                isAnimating ? 'text-primary' : '',
                'mr-0.5',
              ]"
            />
            <div class="text-compact text-center leading-4">{{ selectedLabel }}</div>
            <OIcon name="arrow-drop-down" size="sm" class="ml-0.5" />
          </div>
        </OButton>
      </template>
      <div class="w-75 p-2">
        <div class="flex">
          <div class="flex w-full flex-col p-2 text-center">
            <OButton
              data-test="logs-search-off-refresh-interval"
              :variant="modelValue.toString() === '0' ? 'primary' : 'ghost'"
              size="sm"
              :block="true"
              @click="
                () => {
                  onItemClick({ label: t('common.off'), value: 0 });
                  btnRefreshInterval = false;
                }
              "
            >
              {{ t("common.off") }}
            </OButton>
          </div>
        </div>
        <ODropdownSeparator />
        <div v-for="(items, i) in refreshTimes" :key="'row_' + i" class="flex">
          <div
            v-for="(item, j) in items"
            :key="'col_' + i + '_' + j"
            class="flex w-1/3 flex-col p-2 text-center"
          >
            <OButton
              :data-test="`logs-search-bar-refresh-time-${item.value}`"
              :variant="Number(modelValue) === item.value ? 'primary' : 'ghost'"
              size="sm"
              @click="
                () => {
                  onItemClick(item);
                  btnRefreshInterval = false;
                }
              "
              :disabled="item.disabled"
            >
              <OTooltip
                v-if="item.disabled"
                side="right"
                align="center"
                max-width="18.75rem"
                :content="minRangeRestrictionMessageVal"
              />
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
  type PropType,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { generateDurationLabel } from "../utils/date";
import OButton from "@/lib/core/Button/OButton.vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";

export default defineComponent({
  name: "AutoRefreshInterval",
  components: { OButton, ODropdown, ODropdownSeparator, OTooltip, OIcon },
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
    variant: {
      type: String as PropType<ButtonVariant>,
      default: "outline",
    },
  },
  emits: ["update:modelValue", "trigger"],
  setup(props: any, { emit }) {
    const router = useRouter();
    const { t } = useI18n();

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
      minRangeRestrictionMessageVal.value = t("common.minRefreshIntervalMessage", {
        interval: props.minRefreshInterval,
      });
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

<style scoped>
/* keep(keyframes): the spinning refresh icon is used only by this component (both
   the icon-only and the labelled dropdown trigger share this one class). The
   `animation` is declared here rather than as a template `[animation:…]` utility
   so Vue's scoped compiler renames the keyframe and this reference together.
   The class lands on an OIcon root, which carries this component's scope id too.
   `!important` is retained from the original `!`-prefixed utilities. */
.auto-refresh-icon--spinning {
  display: inline-block !important;
  transform-origin: center center !important;
  animation: rotate 2s linear infinite !important;
}

@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
