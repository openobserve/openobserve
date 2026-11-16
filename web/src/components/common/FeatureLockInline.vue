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

<!-- The in-place lock of a gated page: the feature's name and one line about it, opened where the page would be. -->
<template>
  <OPageLayout :title="name" data-test="feature-lock-inline">
    <OEmptyState
      icon="lock"
      kind="denied"
      :title="
        access.ctaRelevant ? t('featureLock.enterpriseTitle') : t('featureLock.turnedOffTitle')
      "
      :text="text"
    >
      <template v-if="access.ctaRelevant" #actions>
        <OButton
          variant="primary"
          data-test="feature-lock-inline-cta"
          @click="router.push({ name: 'enterpriseFeatures', query: route.query })"
        >
          {{ t("enterpriseFeature.featuresPageTitle") }}
        </OButton>
      </template>
      <template v-else #actions>
        <OButton
          :href="DOCS_URL"
          target="_blank"
          rel="noopener noreferrer"
          data-test="feature-lock-inline-docs"
        >
          {{ t("featureLock.readDocs") }}
        </OButton>
      </template>
    </OEmptyState>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import {
  buildFeatureGateContext,
  checkFeatureAccess,
  type FeatureKey,
} from "@/utils/enterpriseFeatures";

const DOCS_URL = "https://openobserve.ai/docs/";
const RBAC_ENV = "O2_OPENFGA_ENABLED";

const props = defineProps<{ featureKey: FeatureKey; name: I18nText }>();

const { t } = useI18nTyped();
const router = useRouter();
const route = useRoute();
const store = useStore();

const access = computed(() =>
  checkFeatureAccess(props.featureKey, buildFeatureGateContext(store.state.zoConfig)),
);

// RBAC is the one gate the edition already supports, so the cause is a server setting, not an upgrade.
const text = computed(() =>
  access.value.ctaRelevant
    ? access.value.message
    : t("featureLock.rbacOff", { env: raw(RBAC_ENV) }),
);
</script>
