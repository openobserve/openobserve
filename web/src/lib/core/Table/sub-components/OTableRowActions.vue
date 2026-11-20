<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import {
  OTableRowActionsKey,
  type OTableRowActionMark,
  type OTableRowActionPlacement,
  type OTableRowDataTest,
  type OTableRowValue,
} from "../OTable.types";

const props = defineProps<{ row: any; index?: number }>();

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();
const ctx = inject(OTableRowActionsKey, null);

interface ResolvedItem {
  id: string;
  label: I18nText;
  icon: IconName | undefined;
  shortcut: string;
  dataTest: string;
  disabled: boolean;
  reason: I18nText | undefined;
  destructive: boolean;
  loading: OTableRowActionMark | undefined;
  badge: (placement: OTableRowActionPlacement) => OTableRowActionMark | undefined;
  run: () => void;
}

const read = <T,>(value: OTableRowValue<T>): T =>
  typeof value === "function" ? (value as (row: any) => T)(props.row) : value;

const mark = (state: boolean | OTableRowActionMark | undefined): OTableRowActionMark | undefined =>
  state === true ? {} : state || undefined;

const testId = (value: OTableRowDataTest | undefined, fallback: string): string =>
  typeof value === "function" ? value(props.row, props.index ?? 0) : (value ?? fallback);

const inline = computed<ResolvedItem[]>(() =>
  (ctx?.actions.value ?? [])
    .filter((action) => !action.hidden?.(props.row))
    .map((action) => {
      const loading = mark(action.loading?.(props.row));
      const disabled = !!action.disabled?.(props.row);
      return {
        id: action.id,
        label: read(action.label),
        icon: read(action.icon),
        shortcut: action.shortcut === undefined ? action.id : read(action.shortcut),
        dataTest: testId(action.dataTest, `o2-table-row-action-${action.id}`),
        disabled: disabled || !!loading,
        reason: disabled ? action.disabledReason?.(props.row) : loading?.label,
        destructive: false,
        loading,
        badge: () => mark(action.badge?.(props.row)),
        run: () => action.onClick(props.row),
      };
    }),
);

// Destructive items go last, in red (B7).
const menu = computed<ResolvedItem[]>(() => {
  const visible = (ctx?.menu.value ?? []).filter((item) => !item.hidden?.(props.row));
  return [...visible.filter((i) => !i.destructive), ...visible.filter((i) => i.destructive)].map(
    (item) => {
      const disabled = !!item.disabled?.(props.row);
      return {
        id: item.id,
        label: read(item.label),
        icon: item.icon === undefined ? undefined : read(item.icon),
        shortcut: item.shortcut === undefined ? item.id : read(item.shortcut),
        dataTest: testId(item.dataTest, `o2-table-row-menu-${item.id}`),
        disabled,
        reason: disabled ? item.disabledReason?.(props.row) : undefined,
        destructive: !!item.destructive,
        loading: undefined,
        badge: (placement: OTableRowActionPlacement) => mark(item.badge?.(props.row, placement)),
        run: () => item.onSelect(props.row),
      };
    },
  );
});

// < md the inline actions fold into the ⋯ menu, so the row keeps one kebab (R1).
const shown = computed(() => (isMobile.value ? [] : inline.value));
const menuItems = computed<ResolvedItem[]>(() => [
  ...(isMobile.value ? inline.value : []).map((item) => ({
    ...item,
    dataTest: `${item.dataTest}-menu`,
  })),
  ...menu.value,
]);
const showMenu = computed(() => menuItems.value.length > 0);

const menuLabel = computed<I18nText>(
  () =>
    menu.value.map((item) => item.badge("more")?.label).find(Boolean) ??
    t("components.table.moreRowActions"),
);
const menuBadge = computed(() => menu.value.map((item) => item.badge("more")).find(Boolean));
const menuTest = computed(() => testId(ctx?.menuDataTest.value, "o2-table-row-menu"));
// A badge or a running action says something about the row, so it shows without hover.
const pinned = computed(
  () => !!menuBadge.value || shown.value.some((item) => item.loading || item.badge("inline")),
);

function run(item: ResolvedItem): void {
  if (!item.disabled) item.run();
}
</script>

<template>
  <div
    class="flex items-center justify-end gap-0.5 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[aria-expanded=true]]:opacity-100 max-md:opacity-100 pointer-coarse:opacity-100"
    :class="pinned ? 'opacity-100' : 'opacity-0'"
    data-test="o2-table-row-actions"
  >
    <template v-for="item in shown" :key="item.id">
      <span
        v-if="item.loading"
        class="size-control-xs inline-flex items-center justify-center"
        :data-test="item.loading.dataTest ?? `${item.dataTest}-spinner`"
      >
        <OSpinner size="sm" />
        <OTooltip :content="item.loading.label ?? item.label" />
      </span>
      <OButton
        v-else
        variant="ghost"
        size="xs"
        icon-only
        :icon="item.icon"
        :label="item.badge('inline')?.label ?? item.label"
        :disabled="item.disabled"
        :disabled-reason="item.reason"
        :data-row-action="item.shortcut"
        :data-test="item.dataTest"
        @click.stop="run(item)"
      >
        <span
          v-if="item.badge('inline')"
          class="bg-button-pending-bg ring-button-pending-bg/30 pointer-events-none absolute -end-1 -top-1 size-2.5 rounded-full ring-4"
          aria-hidden="true"
          :data-test="item.badge('inline')?.dataTest ?? `${item.dataTest}-badge`"
        />
      </OButton>
    </template>
    <!-- The menu renders outside the row, so the row shortcuts click these instead. -->
    <button
      v-for="item in menuItems"
      :key="`proxy-${item.id}`"
      type="button"
      hidden
      tabindex="-1"
      aria-hidden="true"
      data-row-action-proxy
      :data-row-action="item.shortcut"
      @click.stop="run(item)"
    />
    <ODropdown v-if="showMenu" side="bottom" align="end">
      <template #trigger>
        <OButton
          variant="ghost"
          size="xs"
          icon-only
          icon="more-horiz"
          :label="menuLabel"
          :data-test="menuTest"
          @click.stop
        >
          <span
            v-if="menuBadge"
            class="bg-button-pending-bg ring-button-pending-bg/30 pointer-events-none absolute -end-1 -top-1 size-2.5 rounded-full ring-4"
            aria-hidden="true"
            :data-test="menuBadge.dataTest ?? `${menuTest}-badge`"
          />
        </OButton>
      </template>
      <template v-for="(item, position) in menuItems" :key="item.id">
        <ODropdownSeparator
          v-if="item.destructive && position > 0 && !menuItems[position - 1].destructive"
        />
        <ODropdownItem
          :icon="item.icon"
          :tone="item.destructive ? 'danger' : 'default'"
          :disabled="item.disabled"
          :disabled-reason="item.reason"
          :data-test="item.dataTest"
          @select="run(item)"
        >
          {{ item.label }}
          <template v-if="item.badge('menu')" #end>
            <span
              role="img"
              :aria-label="item.badge('menu')?.label"
              class="bg-button-pending-bg ring-button-pending-bg/30 inline-block size-2 shrink-0 rounded-full ring-2"
              :data-test="item.badge('menu')?.dataTest ?? `${item.dataTest}-menu-badge`"
            />
          </template>
        </ODropdownItem>
      </template>
    </ODropdown>
  </div>
</template>
