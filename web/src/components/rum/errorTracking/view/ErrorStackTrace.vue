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
  <div class="mt-4 ml-1 flex">
    <div class="w-full">
      <div class="mb-1 text-base font-bold">{{ t("rum.errorStack") }}</div>
      <div class="mb-2">{{ error_stack[0] }}</div>

      <!-- Tabs for Pretty and Raw views -->
      <OTabs v-model="activeTab" dense class="text-text-secondary mb-1" align="left">
        <OTab
          name="raw"
          :label="t('rum.stackTraceRaw')"
          data-test="rum-error-stack-trace-raw-tab"
        />
        <OTab
          name="pretty"
          :label="t('rum.stackTracePretty')"
          data-test="rum-error-stack-trace-pretty-tab"
        />
      </OTabs>

      <OSeparator class="mb-2" />

      <!-- Tab panels -->
      <OTabPanels v-model="activeTab" animated>
        <!-- Raw view -->
        <OTabPanel name="raw">
          <div class="error-stacks">
            <template v-for="(stack, index) in error_stack" :key="stack">
              <div
                v-if="index"
                data-test="error-stack-trace-line"
                class="border-border-default text-compact border-r border-b border-l border-solid px-2 py-1.5"
                :style="{
                  'border-top': Number(index) === 1 ? '1px solid var(--color-border-default)' : '',
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
          <PrettyStackTrace
            v-if="activeTab === 'pretty'"
            :error_stack="error_stack"
            :error="error"
          />
        </OTabPanel>
      </OTabPanels>
    </div>
  </div>
</template>

<script setup lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
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
