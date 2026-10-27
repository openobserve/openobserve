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
  <OPageLayout :title="label" :icon="meta?.icon ?? 'lock'" data-test="feature-locked-page">
    <OEmptyState
      size="hero"
      illustration="lock"
      :title="t('featureLock.title', { feature: label })"
      :description="t('featureLock.description')"
      :action-label="hasLicensePage ? t('featureLock.viewLicense') : undefined"
      :secondary-action-label="t('featureLock.contactSales')"
      @action="openLicense"
      @secondary-action="openContactSales"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useFeatureLockActions } from "@/composables/useFeatureLock";
import { LOCKED_FEATURES } from "@/utils/featureGate";

const { t } = useI18nTyped();
const route = useRoute();
const { hasLicensePage, openLicense, openContactSales } = useFeatureLockActions();

const meta = computed(() => LOCKED_FEATURES[String(route.params.feature ?? "")]);
const label = computed(() => (meta.value ? t(meta.value.labelKey) : t("featureLock.thisFeature")));
</script>
