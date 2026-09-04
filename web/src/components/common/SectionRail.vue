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

<!--
  SectionRail — the grouped left navigation rail (prototype ".l2") shared by the
  admin modules (IAM, Settings/Management). Renders the SAME SectionHubGroup data
  the hub uses, so a module is *configured* once and can show either the hub grid
  or this persistent rail. Each item is a <RouterLink>; the active section gets the
  tinted-active treatment. Sentence-case group headings, soft single-line items.
-->
<template>
  <nav class="bg-surface-panel flex h-full min-h-0 flex-col" data-test="section-rail">
    <!-- Collapsed there is room for one mark, so the module icon doubles as the
         expand control rather than sitting inert beside a second button. It is
         tinted like MenuLink's active module for the same reason the primary nav
         tints one: a grey glyph alone reads as decoration, not as a target. -->
    <OButton
      v-if="collapsible && collapsed && icon"
      variant="ghost"
      size="icon-xs-sq"
      class="bg-tabs-hover-bg mx-auto mt-3 mb-1 shrink-0"
      :aria-expanded="false"
      :aria-label="collapsedLabel"
      data-test="section-rail-toggle"
      @click="toggle"
    >
      <OIcon :name="icon" size="sm" class="text-accent" />
      <!-- The mark stands in for the title, so the tooltip names the module
           rather than the gesture: `aria-expanded` already carries the action,
           and "Expand" alone leaves a collapsed rail unlabelled. -->
      <OTooltip :content="collapsedLabel" side="right" />
    </OButton>

    <!-- Title aligns with the item LABELS below it (the page-edge grid line the
         OTab pills' text lands on), not the pill edge — so 'IAM'/'Settings' sits
         directly above 'Users'. Matches FolderList's heading. -->
    <div v-else-if="title" class="ps-page-edge flex shrink-0 items-center gap-1.5 pe-1.5 pt-3 pb-1">
      <span class="text-text-heading min-w-0 flex-1 truncate text-sm font-semibold">{{
        title
      }}</span>
      <!-- Same control the logs field panel uses, so the two rails collapse by
           the same affordance rather than each inventing one. -->
      <OButton
        v-if="collapsible"
        variant="outline"
        size="icon-xs-sq"
        class="shrink-0"
        :aria-expanded="true"
        :aria-label="toggleLabel"
        data-test="section-rail-toggle"
        @click="toggle"
      >
        <OIcon name="keyboard-double-arrow-left" size="sm" />
        <OTooltip :content="toggleLabel" side="right" />
      </OButton>
    </div>

    <div class="flex-1 overflow-y-auto px-1.5 pt-1 pb-3">
      <OTabs
        :model-value="activeKey ?? ''"
        orientation="vertical"
        class="section-rail-tabs w-full"
        @change="onTabChange"
      >
        <template v-for="(group, idx) in visibleGroups" :key="group.label">
          <!-- Section label. Each group after the first gets top spacing so the
               sub-sections read as separate blocks rather than one merged list. -->
          <!-- ps-1.5 (on top of the container's px-1.5) puts the section label on
               the same 12px item-label grid line as the tabs below it. -->
          <div
            v-if="!collapsed"
            class="text-text-secondary py-1 ps-1.5 text-xs font-semibold"
            :class="{ 'mt-3': idx > 0 }"
          >
            {{ group.label }}
          </div>
          <!-- Collapsed, the heading has no room to render, so the grouping is
               kept as a rule instead of dropped: losing it would run four
               unrelated sections together into one list of icons. -->
          <div
            v-else-if="idx > 0"
            class="bg-border-default mx-2 my-2 h-px"
            data-test="section-rail-group-divider"
          />
          <!-- `justify-center!`: the vertical tab hardcodes `justify-start`, and
               two utilities for one property resolve by stylesheet order, not
               class order — without the marker the icon stays left-aligned. -->
          <OTab
            v-for="item in group.items"
            :key="item.key"
            :name="item.key"
            :label="collapsed ? undefined : item.label"
            :tooltip="collapsed ? item.label : undefined"
            :icon="item.icon"
            :data-test="item.dataTest"
            class="w-full"
            :class="collapsed ? 'justify-center!' : undefined"
            @click="navigate(item.to)"
          />
        </template>
      </OTabs>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { computed } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import type { SectionHubGroup } from "@/components/common/SectionHub.vue";

const router = useRouter();
const { t } = useI18nTyped();

// Guarded navigation: a rejected push (e.g. an already-active route, or a
// unit-test router without the target registered) must not surface as an error.
function navigate(to: RouteLocationRaw) {
  Promise.resolve(router.push(to)).catch(() => {});
}

// OTabs emits change when a tab is clicked; navigation is handled by navigate()
// above, so this is a no-op that satisfies the required @change binding.
function onTabChange() {}

const props = defineProps<{
  /** The same grouped sections the hub uses. */
  groups: SectionHubGroup[];
  /** Currently-active section key (highlighted). */
  activeKey?: string;
  /** Optional small heading shown above the groups (e.g. the module name). */
  title?: I18nText;
  /** Opt in to the collapse control. Pair with `v-model:collapsed` and `icon`. */
  collapsible?: boolean;
  /** Module mark, shown in place of the title once collapsed. */
  icon?: IconName;
}>();

// The owner holds the state because it also sizes the rail; remembering the
// choice is its business too, not this component's.
const collapsedModel = defineModel<boolean>("collapsed", { default: false });

// Guard, not plumbing: `collapsed` without `collapsible` would render a rail
// with no control to reopen it.
const collapsed = computed<boolean>(() => Boolean(props.collapsible) && collapsedModel.value);

function toggle() {
  collapsedModel.value = !collapsed.value;
}

const toggleLabel = computed<I18nText>(() =>
  collapsed.value ? t("common.expand") : t("common.collapse"),
);

/** Falls back to the gesture when a rail has an icon but no title to name. */
const collapsedLabel = computed<I18nText>(() => props.title ?? toggleLabel.value);

// Drop hidden items/empty groups (each item may carry a `visible` flag).
const visibleGroups = computed(() =>
  props.groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.visible !== false),
    }))
    .filter((g) => g.items.length > 0),
);
</script>
