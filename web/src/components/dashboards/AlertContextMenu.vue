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
  <teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="bg-dropdown-bg border-dropdown-border rounded-default fixed z-9999 max-w-[calc(100vw-1rem)] min-w-70 border px-0 py-1 shadow-sm dark:shadow-sm"
      :style="menuStyle"
      @click.stop
      data-test="alert-context-menu"
    >
      <div
        v-if="seriesRole === 'forecast'"
        class="text-dropdown-item-text hover:bg-dropdown-item-hover-bg active:bg-dropdown-item-active-bg flex cursor-pointer items-center px-4 py-2 text-sm [transition:background-color_0.2s]"
        @click="handleMenuItemClick('forecast')"
        data-test="alert-context-menu-forecast"
      >
        <OIcon name="trending-up" size="sm" class="me-2" />
        <span class="whitespace-nowrap select-none max-md:whitespace-normal">{{
          t("dashboard.alertContextMenu.forecastReaches", { value: forecastText })
        }}</span>
      </div>
      <div
        v-if="seriesRole !== 'forecast'"
        class="text-dropdown-item-text hover:bg-dropdown-item-hover-bg active:bg-dropdown-item-active-bg flex cursor-pointer items-center px-4 py-2 text-sm [transition:background-color_0.2s]"
        @click="handleMenuItemClick('above')"
        data-test="alert-context-menu-above"
      >
        <OIcon name="arrow-upward" size="sm" class="me-2" />
        <span class="whitespace-nowrap select-none max-md:whitespace-normal">{{
          t("dashboard.alertContextMenu.thresholdAbove", { value: valueText })
        }}</span>
      </div>
      <div
        v-if="seriesRole !== 'forecast'"
        class="text-dropdown-item-text hover:bg-dropdown-item-hover-bg active:bg-dropdown-item-active-bg flex cursor-pointer items-center px-4 py-2 text-sm [transition:background-color_0.2s]"
        @click="handleMenuItemClick('below')"
        data-test="alert-context-menu-below"
      >
        <OIcon name="arrow-downward" size="sm" class="me-2" />
        <span class="whitespace-nowrap select-none max-md:whitespace-normal">{{
          t("dashboard.alertContextMenu.thresholdBelow", { value: valueText })
        }}</span>
      </div>
    </div>
  </teleport>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onBeforeUnmount, nextTick } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18nTyped } from "@/types/i18n";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import { placeMenu } from "@/utils/dashboard/menuPlacement";

export default defineComponent({
  name: "AlertContextMenu",
  components: {
    OIcon,
  },
  props: {
    visible: {
      type: Boolean,
      default: false,
    },
    x: {
      type: Number,
      required: true,
    },
    y: {
      type: Number,
      required: true,
    },
    value: {
      type: [Number, String],
      required: true,
    },
    /** The clicked series' panel query; absent when the click hit no series. */
    panelQueryIndex: {
      type: Number,
      default: undefined,
    },
    seriesRole: {
      type: String,
      default: undefined,
    },
    unit: { type: String, default: null },
    unitCustom: { type: String, default: null },
  },
  emits: ["select", "close"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const menuRef = ref<HTMLElement | null>(null);

    const formattedValue = computed(() => {
      if (typeof props.value === "number") {
        return props.value.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        });
      }
      return props.value;
    });

    const menuSize = ref({ width: 0, height: 0 });
    const menuStyle = computed(() => {
      const { left, top } = placeMenu({ x: props.x, y: props.y }, menuSize.value, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      return { left: `${left}px`, top: `${top}px` };
    });

    // The threshold is written into the alert's PromQL and notification, so it is the value the item shows.
    const forecastValue = computed(() => Number(Number(props.value).toPrecision(4)));

    // The unit is shown only where it keeps the number written into the alert; a rescaled one would not read the same.
    const withUnit = (value: number, plain: string, baseText: string) => {
      if (!props.unit) return plain;
      const decimals = (String(value).split(".")[1] ?? "").length;
      const shown = getUnitValue(value, props.unit, props.unitCustom ?? "", decimals);
      if (Number(shown.value) === value) return formatUnitValue(shown);
      const base = getUnitValue(1, props.unit, props.unitCustom ?? "", 0);
      return Number(base.value) === 1
        ? formatUnitValue({ value: baseText, unit: base.unit })
        : plain;
    };
    const valueText = computed(() =>
      typeof props.value === "number"
        ? withUnit(props.value, formattedValue.value as string, formattedValue.value as string)
        : props.value,
    );
    const forecastText = computed(() => {
      const value = forecastValue.value;
      return withUnit(
        value,
        value.toLocaleString(undefined, { maximumSignificantDigits: 4 }),
        String(value),
      );
    });

    const handleMenuItemClick = (condition: "above" | "below" | "forecast") => {
      emit("select", {
        condition,
        threshold: condition === "forecast" ? forecastValue.value : props.value,
        panelQueryIndex: props.panelQueryIndex,
        seriesRole: props.seriesRole,
      });
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
        emit("close");
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        emit("close");
      }
    };

    const measure = async () => {
      await nextTick();
      menuSize.value = {
        width: menuRef.value?.offsetWidth ?? 0,
        height: menuRef.value?.offsetHeight ?? 0,
      };
    };
    watch([valueText, forecastText, () => props.seriesRole], () => {
      if (props.visible) measure();
    });

    watch(
      () => props.visible,
      (newVisible) => {
        if (newVisible) {
          // The size is known only once rendered; until then the menu sits at the click.
          menuSize.value = { width: 0, height: 0 };
          measure();
          setTimeout(() => {
            document.addEventListener("click", handleClickOutside);
            document.addEventListener("keydown", handleEscape);
          }, 0);
        } else {
          document.removeEventListener("click", handleClickOutside);
          document.removeEventListener("keydown", handleEscape);
        }
      },
    );

    onBeforeUnmount(() => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    });

    return {
      t,
      menuRef,
      formattedValue,
      forecastValue,
      valueText,
      forecastText,
      menuStyle,
      handleMenuItemClick,
    };
  },
});
</script>
