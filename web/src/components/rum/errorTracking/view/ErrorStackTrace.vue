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
  <div class="row q-mt-lg q-ml-xs">
    <div class="col-12">
      <div class="tags-title text-bold q-mb-xs">{{ t("rum.errorStack") }}</div>
      <div class="q-mb-sm">{{ error_stack[0] }}</div>

      <!-- Tabs for Pretty and Raw views -->
      <OTabs
        v-model="activeTab"
        dense
        class="text-grey q-mb-xs"
        align="left"
      >
        <OTab name="raw" label="Raw" />
        <OTab name="pretty" label="Pretty" />
      </OTabs>

      <q-separator class="q-mb-sm" />

      <!-- Tab panels -->
      <OTabPanels v-model="activeTab" animated>
        <!-- Raw view -->
        <OTabPanel name="raw">
          <div class="error-stacks">
            <template v-for="(stack, index) in error_stack" :key="stack">
              <div
                v-if="index"
                class="error_stack q-px-sm"
                :style="{
                  'border-top': Number(index) === 1 ? '1px solid #e0e0e0' : '',
                  'border-radius':
                    Number(index) === error_stack.length - 1
                      ? '0 0 4px 4px'
                      : Number(index) === 1
                      ? '4px 4px 0 0'
                      : '',
                }"
              >
                {{ stack }}
              </div>
            </template>
          </div>
        </OTabPanel>

        <!-- Pretty formatted view -->
        <OTabPanel name="pretty">
          <PrettyStackTrace v-if="activeTab === 'pretty'" :error_stack="error_stack" :error="error" />
        </OTabPanel>
      </OTabPanels>
    </div>
  </div>
</template>

<script setup lang="ts">
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue'
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue'
import { useI18n } from "vue-i18n";
import { ref } from "vue";
import PrettyStackTrace from "./PrettyStackTrace.vue";

const { t } = useI18n();

defineProps({
  error_stack: {
    type: Array,
    required: true,
  },
  error: {
    type: Object,
    required: true,
  },
});

const activeTab = ref("raw");
</script>

<style lang="scss" scoped>
.tags-title {
  font-size: 16px;
}

.error_stack {
  border-bottom: 1px solid #e0e0e0;
  border-left: 1px solid #e0e0e0;
  border-right: 1px solid #e0e0e0;
  font-size: 13px;
  padding: 6px 8px;
}

.error_stacks:first-child .error_stack {
  border-top: 1px solid #e0e0e0;
}
</style>
