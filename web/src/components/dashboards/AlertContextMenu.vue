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
      class="bg-dropdown-bg rounded-default shadow-overlay fixed z-9999 max-w-[calc(100vw-1rem)] min-w-40 border border-transparent p-1"
      :style="menuStyle"
      @click.stop
      data-test="alert-context-menu"
    >
      <template v-if="showAlert && locked">
        <div
          v-for="item in lockedItems"
          :key="item.condition"
          class="text-dropdown-item-disabled focus-visible:ring-focus-ring-accent rounded-default flex cursor-not-allowed items-center gap-2 px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-inset"
          role="menuitem"
          aria-disabled="true"
          tabindex="0"
          :data-test="`alert-context-menu-${item.condition}`"
        >
          <OIcon
            name="lock"
            size="sm"
            class="lock-chip"
            :data-test="`alert-context-menu-${item.condition}-lock`"
          />
          <span class="flex min-w-0 flex-col">
            <span class="whitespace-nowrap select-none max-md:whitespace-normal">{{
              item.label
            }}</span>
            <span
              class="text-text-secondary text-xs select-none"
              :data-test="`alert-context-menu-${item.condition}-reason`"
              >{{ lockedReason }}</span
            >
          </span>
        </div>
      </template>
      <template v-else-if="showAlert">
        <div
          v-if="seriesRole === 'forecast'"
          class="text-dropdown-item-text hover:bg-dropdown-item-hover-bg active:bg-dropdown-item-active-bg rounded-default flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm [transition:background-color_0.2s]"
          @click="handleMenuItemClick('forecast')"
          data-test="alert-context-menu-forecast"
        >
          <OIcon name="trending-up" size="sm" />
          <span class="whitespace-nowrap select-none max-md:whitespace-normal">{{
            t("dashboard.alertContextMenu.forecastReaches", { value: forecastText })
          }}</span>
        </div>
        <div
          v-if="seriesRole !== 'forecast'"
          class="text-dropdown-item-text hover:bg-dropdown-item-hover-bg active:bg-dropdown-item-active-bg rounded-default flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm [transition:background-color_0.2s]"
          @click="handleMenuItemClick('above')"
          data-test="alert-context-menu-above"
        >
          <OIcon name="arrow-upward" size="sm" />
          <span class="whitespace-nowrap select-none max-md:whitespace-normal">{{
            t("dashboard.alertContextMenu.thresholdAbove", { value: valueText })
          }}</span>
        </div>
        <div
          v-if="seriesRole !== 'forecast'"
          class="text-dropdown-item-text hover:bg-dropdown-item-hover-bg active:bg-dropdown-item-active-bg rounded-default flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm [transition:background-color_0.2s]"
          @click="handleMenuItemClick('below')"
          data-test="alert-context-menu-below"
        >
          <OIcon name="arrow-downward" size="sm" />
          <span class="whitespace-nowrap select-none max-md:whitespace-normal">{{
            t("dashboard.alertContextMenu.thresholdBelow", { value: valueText })
          }}</span>
        </div>
      </template>
      <!-- A chart point's View logs / traces / metrics rows, below the alert items: a row that
           resolves or disappears changes only the bottom of the menu. -->
      <OSeparator v-if="$slots.points && showAlert" class="my-1" />
      <slot name="points" />
    </div>
  </teleport>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onBeforeUnmount, nextTick } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { useI18nTyped } from "@/types/i18n";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import { keepPlacement, placeMenu } from "@/utils/dashboard/menuPlacement";

export default defineComponent({
  name: "AlertContextMenu",
  components: {
    OIcon,
    OSeparator,
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
    locked: { type: Boolean, default: false },
    lockedReason: { type: String, default: "" },
    /** The Create alert items; off where alerts cannot be created, leaving only the point rows. */
    showAlert: { type: Boolean, default: true },
    /** Changes whenever the slotted rows change, so the menu is measured and placed again. */
    contentKey: { type: String, default: "" },
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
    // Kept from the first full-size measure: a point row resolving or leaving later must not flip
    // the menu, or the alert items at its top would jump.
    const placedTop = ref<number | null>(null);
    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
    const menuStyle = computed(() => {
      const click = { x: props.x, y: props.y };
      const { left, top } =
        placedTop.value === null
          ? placeMenu(click, menuSize.value, viewport())
          : keepPlacement(placedTop.value, click, menuSize.value, viewport());
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

    const lockedItems = computed(() =>
      props.seriesRole === "forecast"
        ? [
            {
              condition: "forecast",
              label: t("dashboard.alertContextMenu.forecastReaches", { value: forecastText.value }),
            },
          ]
        : [
            {
              condition: "above",
              label: t("dashboard.alertContextMenu.thresholdAbove", { value: valueText.value }),
            },
            {
              condition: "below",
              label: t("dashboard.alertContextMenu.thresholdBelow", { value: valueText.value }),
            },
          ],
    );

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

    // Fixed to the viewport, so a scroll or resize would leave it over the wrong panel; another
    // right-click elsewhere opens its own menu, so this one must not stay open beside it.
    const isOutside = (event: Event) =>
      !!menuRef.value && !menuRef.value.contains(event.target as Node);
    const closeIfOutside = (event: Event) => {
      if (isOutside(event)) emit("close");
    };
    const closeOnResize = () => emit("close");
    const listen = (on: boolean) => {
      if (on) {
        document.addEventListener("click", handleClickOutside);
        document.addEventListener("keydown", handleEscape);
        document.addEventListener("contextmenu", closeIfOutside, true);
        window.addEventListener("scroll", closeIfOutside, true);
        window.addEventListener("resize", closeOnResize);
        return;
      }
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("contextmenu", closeIfOutside, true);
      window.removeEventListener("scroll", closeIfOutside, true);
      window.removeEventListener("resize", closeOnResize);
    };

    const measure = async () => {
      await nextTick();
      menuSize.value = {
        width: menuRef.value?.offsetWidth ?? 0,
        height: menuRef.value?.offsetHeight ?? 0,
      };
      if (placedTop.value === null && menuSize.value.height > 0) {
        placedTop.value = placeMenu({ x: props.x, y: props.y }, menuSize.value, viewport()).top;
      }
    };
    watch([valueText, forecastText, () => props.seriesRole, () => props.contentKey], () => {
      if (props.visible) measure();
    });
    // A new right-click is a new menu: placed afresh at the new cursor.
    watch([() => props.x, () => props.y], () => {
      placedTop.value = null;
      if (props.visible) measure();
    });

    watch(
      () => props.visible,
      (newVisible) => {
        if (newVisible) {
          // The size is known only once rendered; until then the menu sits at the click.
          menuSize.value = { width: 0, height: 0 };
          placedTop.value = null;
          measure();
          setTimeout(() => listen(true), 0);
        } else {
          listen(false);
        }
      },
    );

    onBeforeUnmount(() => listen(false));

    return {
      t,
      menuRef,
      formattedValue,
      forecastValue,
      valueText,
      forecastText,
      menuStyle,
      lockedItems,
      handleMenuItemClick,
    };
  },
});
</script>
