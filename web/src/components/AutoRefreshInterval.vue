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
    <ODropdown v-model:open="btnRefreshInterval" side="bottom" align="center">
      <template #trigger>
        <OButton
          v-if="isCompact"
          icon-only
          data-test="logs-search-bar-refresh-interval-btn"
          :variant="variant"
          :pressed="isAnimating"
          :aria-label="triggerAriaLabel"
        >
          <OIcon
            name="update"
            :class="isAnimating ? 'auto-refresh-icon--spinning' : ''"
            size="sm"
          />
          <OTooltip :content="t('search.autoRefreshWithValue', { value: triggerLabel })" />
        </OButton>
        <OButton
          v-else
          data-test="logs-search-bar-refresh-interval-btn-dropdown"
          :variant="variant"
          :pressed="isOn"
          :aria-label="triggerAriaLabel"
        >
          <div class="flex flex-nowrap items-center">
            <OIcon name="update" size="sm" class="me-1" />
            <div class="text-compact text-center leading-4">
              {{ t("search.autoRefreshTrigger", { interval: triggerLabel }) }}
            </div>
            <OIcon name="arrow-drop-down" size="sm" class="ms-0.5" />
          </div>
          <OTooltip :content="t('search.autoRefreshTitle')" />
        </OButton>
      </template>
      <ODropdownItem
        data-test="logs-search-off-refresh-interval"
        :checked="!isOn"
        @select="onSwitch(false)"
      >
        {{ t("common.off") }}
      </ODropdownItem>
      <template v-for="section in refreshSections" :key="section.key">
        <ODropdownSeparator />
        <ODropdownGroup :label="section.label">
          <ODropdownItem
            v-for="item in section.items"
            :key="item.value"
            :data-test="`logs-search-bar-refresh-time-${item.value}`"
            :checked="Number(modelValue) === item.value"
            :disabled="item.disabled"
            @select="onPick(item)"
          >
            {{ item.label }}
          </ODropdownItem>
        </ODropdownGroup>
      </template>
      <template v-if="hasDisabled || !hideRelativeNote">
        <ODropdownSeparator />
        <div
          class="text-text-muted text-2xs flex flex-col gap-0.5 px-2 py-1.5"
          data-test="auto-refresh-footer"
        >
          <span v-if="hasDisabled" data-test="auto-refresh-minimum">{{
            minRangeRestrictionMessageVal
          }}</span>
          <span v-if="!hideRelativeNote">{{ t("search.autoRefreshRelativeOnly") }}</span>
        </div>
      </template>
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
  onUnmounted,
  type PropType,
} from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRouter } from "vue-router";
import { generateDurationLabel } from "../utils/date";
import {
  AUTO_REFRESH_INTERVALS,
  autoRefreshLabel,
  autoRefreshShortLabel,
} from "@/utils/dashboard/autoRefresh";
import OButton from "@/lib/core/Button/OButton.vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";

export default defineComponent({
  name: "AutoRefreshInterval",
  components: {
    OButton,
    ODropdown,
    ODropdownItem,
    ODropdownGroup,
    ODropdownSeparator,
    OTooltip,
    OIcon,
  },
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
      default: "secondary",
    },
    hideRelativeNote: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue", "trigger"],
  setup(props: any, { emit }) {
    const router = useRouter();
    const { t } = useI18nTyped();

    const btnRefreshInterval = ref(false);
    let intervalInstance = 0;

    const isDisabled = (value: number) => {
      return value < props.minRefreshInterval;
    };

    const refreshTimes = computed(() =>
      [
        AUTO_REFRESH_INTERVALS.filter((v) => v < 60),
        AUTO_REFRESH_INTERVALS.filter((v) => v >= 60 && v < 3600),
        AUTO_REFRESH_INTERVALS.filter((v) => v >= 3600),
      ].map((values) =>
        values.map((value) => ({
          label: autoRefreshLabel(value, t),
          shortLabel: autoRefreshShortLabel(value, t),
          value: value as number,
          disabled: isDisabled(value),
        })),
      ),
    );

    const refreshSections = computed(() => {
      const keys = [
        ["seconds", t("search.autoRefreshSeconds")],
        ["minutes", t("search.autoRefreshMinutes")],
        ["hours", t("search.autoRefreshHours")],
      ] as const;
      return keys.map(([key, label], i) => ({ key, label, items: refreshTimes.value[i] }));
    });

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

    const isOn = computed(() => selectedValue.value > 0);

    const triggerLabel = computed(() =>
      isOn.value ? autoRefreshShortLabel(selectedValue.value, t) : t("common.off"),
    );

    const triggerAriaLabel = computed(() =>
      isOn.value
        ? t("search.autoRefreshAriaOn", { value: triggerLabel.value })
        : t("search.autoRefreshAriaOff"),
    );

    const onSwitch = (on: unknown) => {
      if (!on) selectedValue.value = 0;
    };

    const hasDisabled = computed(() => refreshTimes.value.flat().some((it) => it.disabled));

    const onItemClick = (item: { value: number }) => {
      selectedValue.value = item.value;
    };

    const onPick = (item: { value: number }) => {
      onItemClick(item);
      btnRefreshInterval.value = false;
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

    const minRangeRestrictionMessageVal = computed(() =>
      t("common.minRefreshIntervalMessage", { interval: props.minRefreshInterval }),
    );

    // on component mount and unmount, update the intervals
    onActivated(() => {
      resetTimers();
    });

    onDeactivated(() => {
      clearInterval(intervalInstance);
    });

    onUnmounted(() => {
      clearInterval(intervalInstance);
    });

    return {
      raw,
      t,
      router,
      btnRefreshInterval,
      selectedLabel,
      triggerLabel,
      isOn,
      hasDisabled,
      triggerAriaLabel,
      refreshTimes,
      refreshSections,
      onItemClick,
      onPick,
      onSwitch,
      minRangeRestrictionMessageVal,
      isAnimating,
      selectedValue,
    };
  },
});
</script>

<style scoped>
/* keep(keyframes): scoped compiler renames the keyframe and this reference together, which a template utility cannot. */
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
