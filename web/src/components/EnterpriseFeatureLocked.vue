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
  Shared stand-in for an enterprise/cloud-only route in a build that doesn't
  unlock it. `withFeatureGate` (in useManagementRoutes.ts / useEnterpriseRoutes.ts)
  redirects here — with `?feature=<key>` — instead of letting navigation reach
  the real page, so typing the URL directly lands here with the same message
  as the disabled nav entry, not a 404 or the real feature.
-->
<template>
  <OPageLayout :title="title" icon="lock" constrained data-test="enterprise-feature-locked">
    <OEmptyState size="hero" icon="lock" :title="title" :description="description" />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { gt } from "@/types/i18n";
import {
  checkFeatureAccess,
  buildFeatureGateContext,
  isFeatureKey,
  type FeatureKey,
} from "@/utils/enterpriseFeatures";

const route = useRoute();
const store = useStore();

const title = computed(() => gt("enterpriseFeature.lockedTitle"));

const description = computed(() => {
  const featureKey = route.query.feature as FeatureKey | undefined;
  if (!featureKey || !isFeatureKey(featureKey)) return title.value;
  return checkFeatureAccess(featureKey, buildFeatureGateContext(store.state.zoConfig)).message;
});
</script>
