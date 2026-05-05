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
import { computed } from "vue";
import CopyContent from "@/components/CopyContent.vue";
import useIngestion from "@/composables/useIngestion";
import { aiCategories } from "./data";
import type { AICategory, AIIntegration } from "./data";

const props = defineProps<{
  categorySlug: string;
  integrationSlug: string;
}>();

const { aiContent } = useIngestion();

const category = computed<AICategory | undefined>(() =>
  aiCategories.find((c) => c.slug === props.categorySlug),
);

const integration = computed<AIIntegration | undefined>(() =>
  category.value?.integrations.find((i) => i.slug === props.integrationSlug),
);

const docURL = computed(() => integration.value?.docURL ?? "");
const displayName = computed(
  () => integration.value?.name ?? props.integrationSlug,
);
</script>

<template>
  <div v-if="integration" class="q-pa-sm">
    <div class="tw:text-[16px]">
      <CopyContent :content="aiContent" />
      <div class="tw:pt-6">
        <a
          :href="docURL"
          target="_blank"
          rel="noopener noreferrer"
          class="text-blue-500 tw:underline"
        >
          Click here to check further documentation.
        </a>
      </div>
    </div>
  </div>
  <div v-else class="q-pa-sm">
    <p>Select an integration to view details.</p>
  </div>
</template>
