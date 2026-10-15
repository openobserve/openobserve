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
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { siteURL } from "@/constants/config";

// Label and icon mirror each feature's own nav entry.
const FEATURES: Record<string, { labelKey: I18nKey; icon: IconName }> = {
  workflows: { labelKey: "menu.workflows", icon: "schema" },
  oncall: { labelKey: "menu.onCall", icon: "notifications-active" },
  incidents: { labelKey: "menu.incidents", icon: "notifications-active" },
  ai_assistant: { labelKey: "menu.aiAssistant", icon: "auto-awesome" },
  ai_observability: { labelKey: "menu.aiObservability", icon: "auto-awesome" },
};

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();

const meta = computed(() => FEATURES[String(route.params.feature ?? "")]);
const label = computed(() => (meta.value ? t(meta.value.labelKey) : t("featureLock.thisFeature")));
// The license page only exists on enterprise builds.
const hasLicensePage = computed(() => router.hasRoute("license"));

const openLicense = () => {
  router.push({
    name: "license",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
};

const openContactSales = () => {
  window.open(siteURL.contactSales, "_blank", "noopener");
};
</script>
