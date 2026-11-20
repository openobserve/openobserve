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

<script setup lang="ts">
import { computed, useId } from "vue";
import { RouterLink, useRouter, type RouteLocationRaw } from "vue-router";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";

const props = withDefaults(
  defineProps<{
    label: I18nText;
    icon?: IconName;
    /** Groups keep their destination while expanded clicks toggle their children. */
    to?: RouteLocationRaw;
    active?: boolean;
    /** A child page is open: the parent group carries the accent icon, no fill. */
    childActive?: boolean;
    collapsed?: boolean;
    sub?: boolean;
    /** Edition lock: inert, opens the Enterprise Features page instead. */
    locked?: boolean;
    licenseLocked?: boolean;
    paywalled?: boolean;
    beta?: boolean;
    expanded?: boolean;
    /** The row opens a flyout, which stands in for the collapsed-rail tooltip. */
    flyout?: boolean;
  }>(),
  {
    icon: undefined,
    to: undefined,
    active: false,
    childActive: false,
    collapsed: false,
    sub: false,
    locked: false,
    licenseLocked: false,
    paywalled: false,
    beta: false,
    expanded: undefined,
    flyout: false,
  },
);

const emit = defineEmits<{ (e: "toggle"): void }>();

const { t } = useI18nTyped();
const router = useRouter();
const paywallId = useId();

const isToggle = computed(
  () => !props.locked && (!props.to || (props.expanded !== undefined && !props.collapsed)),
);
const iconClass = computed(() =>
  props.active || props.childActive ? "text-selected-fg" : "text-text-secondary",
);

const rootAttrs = computed<Record<string, unknown>>(() => {
  if (props.locked) return { type: "button" };
  if (!props.to) return { type: "button", "aria-expanded": props.expanded };
  return {
    to: props.to,
    role: isToggle.value ? "button" : undefined,
    "aria-expanded": isToggle.value ? props.expanded : undefined,
    "aria-current": props.active ? "page" : undefined,
    "aria-describedby": props.paywalled ? paywallId : undefined,
  };
});

// `!` on the text colour: the global link colour rule is unlayered and would otherwise tint <a> rows.
const rowClass = computed(() => [
  "group/nav flex min-w-9 w-full items-center gap-2.5 overflow-hidden rounded-default text-xs [text-decoration:none]! transition-colors duration-150 motion-reduce:transition-none cursor-pointer border-0 text-start [font-family:inherit]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
  props.sub ? "h-8 ps-8.5 pe-2" : "h-8 px-2",
  // Calm selection: a soft accent tint, no ring and no bold; the accent icon carries the state cue.
  props.active
    ? "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-text-body! font-normal"
    : props.childActive
      ? "bg-transparent hover:bg-surface-hover font-normal text-text-heading!"
      : "bg-transparent hover:bg-surface-hover hover:text-text-body! font-normal text-text-body!",
  props.locked || props.paywalled ? "opacity-70" : "",
]);

function onClick(event: MouseEvent) {
  if (props.locked) {
    router.push({ name: "enterpriseFeatures" }).catch(() => {});
    return;
  }
  if (isToggle.value) {
    event.preventDefault();
    emit("toggle");
  }
}
function onKeydown(event: KeyboardEvent) {
  if (props.to && isToggle.value && event.key === " ") {
    event.preventDefault();
    emit("toggle");
  }
}
</script>

<template>
  <component
    :is="locked || !to ? 'button' : RouterLink"
    v-bind="rootAttrs"
    :class="rowClass"
    :aria-label="collapsed ? label : undefined"
    @click.capture="onClick"
    @keydown="onKeydown"
  >
    <OIcon v-if="icon" :name="icon" size="sm" class="size-4! shrink-0" :class="iconClass" />
    <span
      class="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden whitespace-nowrap transition-opacity duration-150 motion-reduce:transition-none"
      :class="collapsed ? 'opacity-0' : 'opacity-100'"
      :aria-hidden="collapsed ? true : undefined"
    >
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <BetaBadge v-if="beta" size="xs" class="px-1! py-px! text-[9px]! leading-none! font-medium! tracking-normal! normal-case!" />
      <OIcon
        v-if="locked || licenseLocked || paywalled"
        name="lock"
        size="sm"
        class="size-4.5! shrink-0"
        :class="iconClass"
      />
      <OIcon
        v-if="expanded !== undefined || flyout"
        name="sidebar-chevron-right"
        size="sm"
        class="size-4.5! shrink-0 transition-transform duration-150 motion-reduce:transition-none rtl:rotate-180"
        :class="[iconClass, expanded ? 'rotate-90 rtl:rotate-90' : '']"
      />
    </span>
    <span v-if="paywalled" :id="paywallId" class="sr-only">{{
      t("menu.trialPageNeedsPlan", { page: label })
    }}</span>
    <OTooltip v-if="collapsed && !flyout" :content="label" side="right" />
  </component>
</template>
