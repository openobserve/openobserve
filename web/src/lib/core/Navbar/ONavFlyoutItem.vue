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
/** One destination row of a desktop nav flyout or its side panel; `data-test`, spacing and listeners fall through. */
import type { RouteLocationRaw } from "vue-router";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import type { SubnavChild } from "./ONavbar.types";

defineProps<{
  child: SubnavChild;
  to: RouteLocationRaw;
  label: I18nText;
  active: boolean;
  paywalled: boolean;
  descriptionId: string;
  lockTestId: string;
  lockedLabel: I18nText;
  textClass: string;
}>();

const { t } = useI18nTyped();
</script>

<template>
  <!-- `div` when locked: RouterLink's click handler runs before the parent's preventDefault, so only not rendering it stops navigation. -->
  <component
    :is="child.locked ? 'div' : 'router-link'"
    role="menuitem"
    :to="child.locked ? undefined : to"
    :tabindex="child.locked ? 0 : undefined"
    class="nav-group-item rounded-default focus-visible:ring-accent flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm transition-colors duration-150 outline-none select-none [text-decoration:none]! focus-visible:ring-2 focus-visible:ring-inset"
    :class="[
      textClass,
      active ? 'bg-select-item-selected-bg font-medium' : 'hover:bg-dropdown-item-hover-bg',
    ]"
    :aria-current="active ? 'page' : undefined"
    :data-paywalled="paywalled ? 'true' : undefined"
    :aria-describedby="paywalled ? descriptionId : undefined"
  >
    <!-- Icon color is locked to the text color so it never picks up a primary tint via currentColor inheritance. -->
    <OIcon
      :name="child.icon"
      size="sm"
      class="shrink-0"
      :class="paywalled ? 'text-text-secondary!' : textClass"
    />
    <span class="leading-none">{{ label }}</span>
    <BetaBadge v-if="child.beta" size="xs" />
    <OIcon
      v-if="paywalled || child.locked || child.licenseLocked"
      name="lock"
      size="xs"
      class="ms-auto shrink-0"
      :class="child.locked || child.licenseLocked ? 'lock-chip' : 'text-text-secondary'"
      :data-test="lockTestId"
      aria-hidden="true"
    />
    <span v-if="child.licenseLocked" class="sr-only">{{ lockedLabel }}</span>
    <span v-if="paywalled" :id="descriptionId" class="sr-only">{{
      t("menu.trialPageNeedsPlan", { page: label })
    }}</span>
  </component>
</template>
