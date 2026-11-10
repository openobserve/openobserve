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

<!-- A locked tab opens the enterprise features page. -->
<template>
  <OTabs
    v-if="ctx && hasTabs"
    :model-value="ctx.active.value"
    align="left"
    data-test="ai-section-tabs"
    @change="ctx.open"
  >
    <OTab
      v-for="tab in tabs"
      :key="tab.key"
      :name="tab.key"
      :label="tab.label"
      :icon="tab.icon"
      :suffix-icon="tab.locked ? 'lock' : undefined"
      :data-test="tab.locked ? `${tab.dataTest}-locked` : tab.dataTest"
    />
  </OTabs>
</template>

<script setup lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import { useAiSectionTabs } from "./aiSectionTabs";

const { ctx, tabs, hasTabs } = useAiSectionTabs();
</script>
