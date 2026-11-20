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
  Full-page version of the enterprise offer `EnterpriseUpgradeDialog` shows in
  a modal — same copy and feature catalog (via `useEnterpriseOfferContent`), laid
  out as categorised columns. A locked left-nav item or left-side tab routes
  here on click (see MenuLink.vue / ONavGroup.vue / SectionRail.vue).
-->
<template>
  <OPageLayout
    :title="t('enterpriseFeature.featuresPageTitle')"
    :about="dialogConfig.offerText"
    data-test="enterprise-features-page"
  >
    <template #status>
      <OSkeleton v-if="isLoadingLicense" shape="block" class="h-5 w-32" />
      <OTag v-else tone="accent" :label="dialogConfig.badgeText" />
    </template>
    <template #actions-overflow>
      <OButton
        v-if="dialogConfig.showContactSales"
        variant="secondary"
        @click="trackCta('contact_sales', contactSales)"
      >
        {{ t("about.enterprise_offer.buttons.contact_sales") }}
      </OButton>
      <OButton v-else variant="secondary" @click="trackCta('learn_more', openDocsLink)">
        {{ t("about.enterprise_offer.buttons.learn_more") }}
      </OButton>
    </template>
    <template #actions>
      <OButton
        v-if="dialogConfig.showPrimaryButton"
        variant="primary"
        data-test="enterprise-features-primary-btn"
        @click="trackCta('primary', handlePrimaryButtonClick)"
      >
        {{ dialogConfig.primaryButtonText }}
      </OButton>
    </template>

    <div class="flex flex-col gap-6 py-4" data-test="enterprise-features-columns">
      <section
        v-for="column in columns"
        :key="column.category"
        class="flex flex-col gap-2"
        data-test="enterprise-features-category"
      >
        <h2 class="text-text-heading text-sm font-semibold">
          {{ t(`enterpriseFeature.category.${column.category}`) }}
        </h2>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <EnterpriseFeatureCard
            v-for="feature in column.features"
            :key="feature.name"
            :feature="feature"
            data-test="enterprise-features-item"
          />
        </div>
      </section>

      <p class="text-text-secondary text-compact">
        {{ t("enterpriseFeature.docsFooter") }}
        <OButton
          variant="link"
          data-test="enterprise-features-docs-link"
          @click="openFeatureLink(DOCS_URL)"
        >
          {{ t("enterpriseFeature.viewAllDocs") }}
        </OButton>
      </p>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import EnterpriseFeatureCard from "@/components/EnterpriseFeatureCard.vue";
import { useI18nTyped } from "@/types/i18n";
import {
  useEnterpriseOfferContent,
  type EnterpriseFeatureCategory,
} from "@/composables/useEnterpriseOfferContent";
import analytics from "@/services/product_analytics";

const { t } = useI18nTyped();

const {
  dialogConfig,
  enterpriseFeatures,
  isLoadingLicense,
  fetchLicenseData,
  openDocsLink,
  contactSales,
  openFeatureLink,
  handlePrimaryButtonClick,
} = useEnterpriseOfferContent();

const DOCS_URL = "https://openobserve.ai/docs/";

const trackCta = (action: "primary" | "contact_sales" | "learn_more", run: () => void) => {
  analytics.track("enterprise_features_cta_clicked", { action });
  run();
};

const CATEGORY_ORDER: EnterpriseFeatureCategory[] = ["security", "scale", "ai", "analysis"];

const columns = computed(() =>
  CATEGORY_ORDER.map((category) => ({
    category,
    features: enterpriseFeatures.filter(
      (f) =>
        f.category === category &&
        (dialogConfig.value.isCloudLayout ? !f.cloudHidden : !f.cloudOnly),
    ),
  })),
);

onMounted(fetchLicenseData);
</script>
