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

<!-- The enterprise offer's feature catalog as a card grid, so the dialog and the features page never drift apart. -->
<template>
  <div
    :data-test="
      isCloudLayout
        ? 'enterprise-upgrade-features-list-cloud'
        : 'enterprise-upgrade-features-list-standard'
    "
    class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
  >
    <EnterpriseFeatureCard v-for="feature in features" :key="feature.name" :feature="feature" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import EnterpriseFeatureCard, {
  type EnterpriseFeatureCardItem,
} from "@/components/EnterpriseFeatureCard.vue";

interface OfferFeature extends EnterpriseFeatureCardItem {
  cloudOnly?: boolean;
  cloudHidden?: boolean;
}

const props = defineProps<{
  isCloudLayout?: boolean;
  coreFeatures: OfferFeature[];
  enterpriseFeatures: OfferFeature[];
}>();

// Cloud lists what the subscription includes, core first; self-hosted lists what a license unlocks.
const features = computed(() =>
  props.isCloudLayout
    ? [...props.coreFeatures, ...props.enterpriseFeatures.filter((f) => !f.cloudHidden)]
    : props.enterpriseFeatures.filter((f) => !f.cloudOnly),
);
</script>
