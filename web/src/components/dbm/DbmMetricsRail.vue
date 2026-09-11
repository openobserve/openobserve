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
  DbmMetricsRail — the Metrics tab's section jump list.

  SectionRail's vertical-tab idiom (the IAM/Settings rail), but for IN-PAGE
  navigation: clicking emits `select` and the page scrolls its own container —
  no router involved, which is why SectionRail itself is not reused (its items
  are RouterLinks by contract). The active key is scroll-spy state owned by the
  page; this component just paints it.
-->
<template>
  <nav
    class="bg-surface-panel flex h-full min-h-0 flex-col"
    :aria-label="ariaLabel"
    data-test="dbm-metrics-rail"
  >
    <div class="flex-1 overflow-y-auto px-1.5 pt-2 pb-3">
      <OTabs
        :model-value="activeKey ?? ''"
        orientation="vertical"
        class="w-full"
        @change="onTabChange"
      >
        <OTab
          v-for="item in items"
          :key="item.key"
          :name="item.key"
          :label="item.label"
          class="w-full"
          :data-test="`dbm-metrics-rail-item-${item.key}`"
          @click="emit('select', item.key)"
        />
      </OTabs>
    </div>
  </nav>
</template>

<script setup lang="ts">
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import type { I18nText } from "@/types/i18n";

export interface DbmMetricsRailItem {
  key: string;
  label: I18nText;
}

defineProps<{
  items: DbmMetricsRailItem[];
  /** The section currently in view — scroll-spy state owned by the page. */
  activeKey?: string;
  ariaLabel: I18nText;
}>();

const emit = defineEmits<{ select: [key: string] }>();

// OTabs requires @change; selection is handled per-tab so the jump fires even
// when the clicked tab is already the active one.
function onTabChange() {}
</script>
