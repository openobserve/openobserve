<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";

import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import type {
  OTableRowAction,
  OTableRowActionMark,
  OTableRowActionPlacement,
  OTableRowValue,
} from "../OTable.types";

const MAX_INLINE = 3;
const INLINE_WITH_MENU = 2;

const props = defineProps<{
  actions: OTableRowAction[];
  row: any;
  index?: number;
  moreDataTest?: string | ((row: any, index: number) => string);
}>();

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();

interface ResolvedAction {
  action: OTableRowAction;
  label: I18nText;
  icon: IconName;
  destructive: boolean;
  success: boolean;
  shortcut: string;
  dataTest: string;
  disabled: boolean;
  reason: I18nText | undefined;
  loading: OTableRowActionMark | undefined;
}

const read = <T,>(value: OTableRowValue<T>): T =>
  typeof value === "function" ? (value as (row: any) => T)(props.row) : value;

const mark = (state: boolean | OTableRowActionMark | undefined): OTableRowActionMark | undefined =>
  state === true ? {} : state || undefined;

const badgeOf = (item: ResolvedAction, placement: OTableRowActionPlacement) =>
  mark(item.action.badge?.(props.row, placement));

const ordered = computed<ResolvedAction[]>(() => {
  const visible = props.actions.filter((a) => a.visible?.(props.row) ?? true);
  const rank = (a: OTableRowAction) => (a.id === "edit" ? 0 : a.id === "delete" ? 2 : 1);
  return [0, 1, 2]
    .flatMap((r) => visible.filter((a) => rank(a) === r))
    .map((action) => {
      const state = action.disabled?.(props.row) ?? false;
      const loading = mark(action.loading?.(props.row));
      const tone = action.tone === undefined ? undefined : read(action.tone);
      return {
        action,
        label: read(action.label),
        icon: read(action.icon),
        destructive: tone ? tone === "destructive" : action.id === "delete",
        success: tone === "success",
        shortcut: action.shortcut === undefined ? action.id : read(action.shortcut),
        dataTest:
          action.dataTest?.(props.row, props.index ?? 0) ?? `o2-table-row-action-${action.id}`,
        disabled: state !== false || !!loading,
        reason: typeof state === "string" ? state : loading?.label,
        loading,
      };
    });
});

const inlineIds = computed<Set<string>>(() => {
  const all = ordered.value.map((r) => r.action);
  if (isMobile.value) return new Set();
  if (all.length <= MAX_INLINE) return new Set(all.map((a) => a.id));
  const marked = all.filter((a) => a.inline).slice(0, INLINE_WITH_MENU);
  const fill = all.filter((a) => !marked.includes(a)).slice(0, INLINE_WITH_MENU - marked.length);
  return new Set([...marked, ...fill].map((a) => a.id));
});

const inline = computed(() => ordered.value.filter((r) => inlineIds.value.has(r.action.id)));
const menu = computed(() => ordered.value.filter((r) => !inlineIds.value.has(r.action.id)));

const moreBadge = computed(() => menu.value.map((item) => badgeOf(item, "more")).find(Boolean));
const moreLabel = computed<I18nText>(() => moreBadge.value?.label ?? t("dashboard.moreActions"));
const moreTest = computed(() =>
  typeof props.moreDataTest === "function"
    ? props.moreDataTest(props.row, props.index ?? 0)
    : (props.moreDataTest ?? "o2-table-row-more-actions"),
);

function run(item: ResolvedAction): void {
  if (!item.disabled) item.action.onSelect(props.row);
}
</script>

<template>
  <div
    v-if="ordered.length"
    class="inline-flex items-center justify-end gap-1"
    data-test="o2-table-row-actions"
  >
    <template v-for="item in inline" :key="item.action.id">
      <span
        v-if="item.loading"
        class="inline-flex size-7 items-center justify-center"
        :data-test="item.loading.dataTest ?? `${item.dataTest}-spinner`"
      >
        <OSpinner size="xs" />
        <OTooltip :content="item.loading.label ?? item.label" />
      </span>
      <OButton
        v-else
        :variant="item.destructive ? 'ghost-destructive' : item.success ? 'ghost-success' : 'ghost'"
        size="icon-xs-sq"
        :icon-left="item.icon"
        :aria-label="badgeOf(item, 'inline')?.label ?? item.label"
        :disabled="item.disabled"
        focusable-unavailable
        :data-row-action="item.shortcut"
        :data-test="item.dataTest"
        @click.stop="run(item)"
      >
        <OTooltip :content="item.reason ?? badgeOf(item, 'inline')?.label ?? item.label" />
        <template v-if="item.reason" #unavailable-reason>{{ item.reason }}</template>
        <span
          v-if="badgeOf(item, 'inline')"
          class="bg-button-pending-bg ring-button-pending-bg/30 pointer-events-none absolute -end-1 -top-1 size-2.5 rounded-full ring-4"
          aria-hidden="true"
          :data-test="badgeOf(item, 'inline')?.dataTest ?? `${item.dataTest}-badge`"
        />
      </OButton>
    </template>
    <!-- The menu renders outside the row, so the row shortcuts click these instead. -->
    <button
      v-for="item in menu"
      :key="`proxy-${item.action.id}`"
      type="button"
      hidden
      tabindex="-1"
      aria-hidden="true"
      data-row-action-proxy
      :data-row-action="item.shortcut"
      @click.stop="run(item)"
    />
    <ODropdown v-if="menu.length" side="bottom" align="end">
      <template #trigger>
        <OButton
          variant="ghost"
          size="icon-xs-sq"
          icon-left="more-vert"
          :aria-label="moreLabel"
          :data-test="moreTest"
          @click.stop
        >
          <OTooltip v-if="!isMobile" :content="moreLabel" />
          <span
            v-if="moreBadge"
            class="bg-button-pending-bg ring-button-pending-bg/30 pointer-events-none absolute -end-1 -top-1 size-2.5 rounded-full ring-4"
            aria-hidden="true"
            :data-test="moreBadge.dataTest ?? `${moreTest}-badge`"
          />
        </OButton>
      </template>
      <template v-for="(item, index) in menu" :key="item.action.id">
        <ODropdownSeparator v-if="item.action.id === 'delete' && index > 0" />
        <ODropdownItem
          :icon-left="item.icon"
          :variant="item.destructive ? 'destructive' : 'default'"
          :disabled="item.disabled"
          focusable-unavailable
          :description="item.reason"
          :data-test="`${item.dataTest}-menu`"
          @select="run(item)"
        >
          <span>{{ item.label }}</span>
          <OTooltip
            v-if="badgeOf(item, 'menu')"
            :content="badgeOf(item, 'menu')?.label"
            side="right"
          >
            <span
              role="img"
              :aria-label="badgeOf(item, 'menu')?.label"
              class="bg-button-pending-bg ring-button-pending-bg/30 inline-block size-2 shrink-0 rounded-full ring-2"
              :data-test="badgeOf(item, 'menu')?.dataTest ?? `${item.dataTest}-menu-badge`"
            />
          </OTooltip>
        </ODropdownItem>
      </template>
    </ODropdown>
  </div>
</template>
