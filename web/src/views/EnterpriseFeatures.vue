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
    icon="workspace-premium"
    data-test="enterprise-features-page"
  >
    <div class="flex flex-col gap-8 pt-6 pb-4">
      <div
        data-test="enterprise-features-banner"
        class="rounded-surface flex flex-wrap items-center justify-between gap-4 bg-[linear-gradient(135deg,var(--color-theme-accent)_0%,color-mix(in_srgb,var(--color-theme-accent)_85%,black_15%)_100%)] px-8 py-6 text-white"
      >
        <div class="flex flex-col gap-1">
          <div class="text-2xl font-bold">{{ dialogConfig.heroTitle }}</div>
          <div class="text-sm italic opacity-90">{{ dialogConfig.offerText }}</div>
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <div
            v-if="!isLoadingLicense"
            class="rounded-default bg-success-500 px-4 py-2 text-base font-bold text-white"
          >
            {{ dialogConfig.badgeText }}
          </div>
          <OButton
            v-if="dialogConfig.showPrimaryButton"
            variant="on-dark-primary"
            data-test="enterprise-features-primary-btn"
            class="text-theme-accent! bg-white!"
            @click="handlePrimaryButtonClick"
          >
            {{ dialogConfig.primaryButtonText }}
            <template v-if="dialogConfig.primaryButtonIcon" #icon-right>
              <OIcon :name="dialogConfig.primaryButtonIcon" size="sm" />
            </template>
          </OButton>
          <OButton
            v-if="dialogConfig.showContactSales"
            variant="on-dark-ghost"
            @click="contactSales"
          >
            {{ t("about.enterprise_offer.buttons.contact_sales") }}
          </OButton>
          <OButton v-else variant="on-dark-ghost" @click="openDocsLink">
            {{ t("about.enterprise_offer.buttons.learn_more") }}
          </OButton>
        </div>
      </div>

      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-col gap-1">
          <div data-test="enterprise-features-title" class="text-text-heading text-xl font-bold">
            {{ dialogConfig.featuresTitle }}
          </div>
          <div class="text-text-secondary text-sm italic">
            {{ dialogConfig.featuresSubtitle }}
          </div>
        </div>
        <div class="text-text-secondary flex items-center gap-4 text-xs italic">
          <span class="flex items-center gap-2">
            <OTag type="featureFlag" value="beta" />
            {{ t("enterpriseFeature.legendBeta") }}
          </span>
          <span class="flex items-center gap-2">
            <OTag type="featureFlag" value="ha" />
            {{ t("enterpriseFeature.legendHa") }}
          </span>
        </div>
      </div>

      <div
        data-test="enterprise-features-columns"
        class="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-4"
      >
        <section v-for="column in columns" :key="column.category" class="flex flex-col gap-2">
          <div
            class="border-border-default text-text-secondary border-b px-4 pb-3 text-sm font-semibold tracking-wider uppercase"
          >
            {{ t(`enterpriseFeature.category.${column.category}`) }}
          </div>
          <div
            v-for="feature in column.features"
            :key="feature.name"
            data-test="enterprise-features-item"
            class="rounded-default hover:bg-surface-hover flex gap-3 p-3 transition-colors"
            :class="feature.link ? 'cursor-pointer' : ''"
            @click="feature.link && openFeatureLink(feature.link)"
          >
            <div
              class="rounded-default bg-theme-accent/10 text-theme-accent flex h-9 w-9 shrink-0 items-center justify-center"
            >
              <OIcon :name="feature.icon" size="sm" />
            </div>
            <div class="min-w-0 flex-1">
              <div
                class="text-text-heading flex flex-wrap items-center gap-1.5 text-base leading-tight font-semibold"
              >
                {{ feature.name }}
                <OTag v-if="feature.beta" type="featureFlag" value="beta" />
                <span v-if="feature.requiresHA" class="inline-flex">
                  <OTag type="featureFlag" value="ha" />
                  <OTooltip
                    side="top"
                    align="center"
                    :sideOffset="8"
                    :content="t('about.enterprise_offer.tooltip.high_availability_mode_only')"
                  />
                </span>
              </div>
              <div class="text-text-secondary mt-1 text-sm italic">{{ feature.note }}</div>
            </div>
          </div>
        </section>
      </div>

      <div class="text-text-secondary text-sm italic">
        {{ t("enterpriseFeature.docsFooter") }}
        <a
          class="text-theme-accent cursor-pointer not-italic hover:underline"
          data-test="enterprise-features-docs-link"
          @click="openFeatureLink(DOCS_URL)"
        >
          {{ t("enterpriseFeature.viewAllDocs") }} →
        </a>
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";
import {
  useEnterpriseOfferContent,
  type EnterpriseFeatureCategory,
} from "@/composables/useEnterpriseOfferContent";

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
