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
  <FeatureLockExempt
    as="nav"
    class="bg-surface-panel flex h-full min-h-0 flex-col"
    data-test="section-rail"
  >
    <!-- One 56 px row with the page header band and its hairline, so the two read as one header row (H4). -->
    <div
      v-if="collapsible && collapsed && icon"
      class="border-border-default flex h-14 shrink-0 items-center justify-center border-b"
      data-test="section-rail-head"
    >
      <!-- The module mark doubles as the expand control, tinted so it reads as a target. -->
      <OButton
        icon-only
        variant="ghost"
        class="bg-tabs-hover-bg"
        :aria-expanded="false"
        :aria-label="collapsedLabel"
        data-test="section-rail-toggle"
        @click="toggle"
      >
        <OIcon :name="icon" size="sm" class="text-accent" />
        <!-- Names the module, not the gesture: `aria-expanded` already carries the action. -->
        <OTooltip :content="collapsedLabel" side="right" />
      </OButton>
    </div>

    <!-- The title starts on the page-edge line that the group headings and item icons below share. -->
    <div
      v-else-if="title"
      class="ps-page-edge border-border-default flex h-14 shrink-0 items-center gap-1.5 border-b pe-2"
      data-test="section-rail-head"
    >
      <OTruncatedText class="text-text-heading flex-1 text-sm font-semibold">{{
        title
      }}</OTruncatedText>
      <!-- Same control the logs field panel uses, so the two rails collapse by the same affordance. -->
      <OButton
        v-if="collapsible"
        icon-only
        variant="ghost"
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

    <div class="flex-1 overflow-y-auto px-2 pt-3 pb-3">
      <OTabs
        :model-value="activeKey ?? ''"
        orientation="vertical"
        class="section-rail-tabs w-full"
        @change="onTabChange"
      >
        <template v-for="(group, idx) in visibleGroups" :key="group.label || idx">
          <!-- ps-2 on the container's px-2 lands the heading on the title's 16 px line. -->
          <div
            v-if="!collapsed && group.label"
            class="text-text-secondary py-1 ps-2 text-xs font-semibold"
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
          <template v-for="item in group.items" :key="item.key">
            <OTab
              :name="item.key"
              :label="collapsed ? undefined : item.label"
              :tooltip="collapsed ? item.label : undefined"
              :icon="item.icon"
              :locked="(item.locked || item.licenseLocked) && !collapsed"
              :locked-label="item.lockedLabel"
              :data-test="item.locked ? `${item.dataTest}-locked` : item.dataTest"
              class="w-full"
              :class="collapsed ? 'justify-center!' : undefined"
              @click="navigate(item.to)"
            >
              <template v-if="collapsed && (item.locked || item.licenseLocked)" #icon>
                <span class="relative inline-flex shrink-0">
                  <OIcon :name="item.icon as IconName" size="sm" class="o-tab__icon" />
                  <OLockBadge :label="item.lockedLabel" />
                </span>
              </template>
            </OTab>
          </template>
        </template>
      </OTabs>
    </div>

    <!-- Pinned below the scrolling groups, e.g. the AI rail's Playground and Tools. -->
    <div
      v-if="$slots.footer"
      class="border-border-default bg-surface-base shrink-0 border-t p-2.5"
      data-test="section-rail-footer"
    >
      <slot name="footer" :collapsed="collapsed" />
    </div>
  </FeatureLockExempt>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { computed } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OLockBadge from "@/lib/core/Badge/OLockBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import type { SectionHubGroup } from "@/components/common/SectionHub.vue";
import FeatureLockExempt from "@/components/common/FeatureLockExempt.vue";

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
