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
  <OCard
    class="border-card-glass-border bg-card-glass-bg rounded-default dark:bg-surface-base dark:border-border-default row-span-7 grid! h-full w-full grid-rows-subgrid gap-0 border shadow-none max-lg:row-span-1 max-lg:flex!"
  >
    <div class="flex items-start justify-between gap-3 px-4 py-3">
      <div>
        <h3 class="text-text-heading m-0 text-base leading-6 font-semibold">
          {{ t("billing.enterpriseLabel") }}
        </h3>
        <p class="text-text-secondary m-0 text-xs leading-4 font-normal">
          {{ t("billing.enterpriseSubtitle") }}
        </p>
      </div>
      <OTag v-if="!price" type="billingTag" value="discount" class="shrink-0" />
    </div>

    <!-- Always rendered: the card is a subgrid row, so the price slot must exist even when empty. -->
    <div :class="{ 'px-4 pb-3': price }">
      <div
        v-if="price"
        class="rounded-default border-border-default flex h-full flex-col border px-2.5 py-2"
        data-test="billing-plans-enterprise-price"
      >
        <div class="flex min-h-4 items-center">
          <OTag variant="primary-soft" size="xs" :label="t('billing.discountTag')" />
        </div>
        <span class="text-text-heading text-2xl leading-7 font-semibold">{{
          raw(price.price)
        }}</span>
        <span class="text-text-secondary text-xs leading-4">{{ raw(price.note) }}</span>
      </div>
    </div>

    <OSeparator />

    <div class="flex-1 px-4 py-3">
      <div
        v-if="pricingError && !features?.length"
        class="text-status-error-text mb-2 flex items-center"
      >
        <OIcon name="warning" size="sm" class="me-2" />
        <span class="text-text-body text-sm leading-5">{{ t("billing.pricingErrorMessage") }}</span>
        <OButton
          variant="ghost"
          size="sm"
          class="ms-2"
          data-test="billing-pricing-retry"
          @click="$emit('retry-pricing')"
        >
          {{ t("common.retry") }}
        </OButton>
      </div>
      <div class="xl:columns-2 xl:gap-6">
        <div
          v-for="(feature, index) in features"
          :key="index"
          class="flex break-inside-avoid items-center justify-between py-0.5"
        >
          <div class="flex items-start">
            <OIcon
              v-if="feature.is_parent"
              name="check-circle"
              size="sm"
              class="text-status-positive check-icon me-2 mt-0.5 shrink-0"
            />
            <div
              class="text-sm leading-5"
              :class="feature.is_parent ? 'text-text-body' : 'text-text-secondary ms-6'"
            >
              {{ feature.name }}
            </div>
          </div>
          <div class="text-text-body text-sm leading-5 font-semibold whitespace-nowrap">
            {{ feature.price }}
          </div>
        </div>
      </div>
    </div>

    <OSeparator />

    <p class="text-text-secondary m-0 px-4 pt-3 text-xs leading-4 font-normal">
      {{ t("billing.enterpriseNote") }}
    </p>

    <div class="flex justify-between px-4 pt-2 pb-3">
      <OButton
        variant="outline"
        size="sm-action"
        block
        data-test="billing-plans-enterprise-contact-btn"
        @click="contactSales"
      >
        {{ t("billing.contactLabel") }}
      </OButton>
    </div>
  </OCard>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import { siteURL } from "@/constants/config";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import analytics from "@/services/product_analytics";

export default defineComponent({
  name: "enterprisePlan",
  components: { OSeparator, OButton, OTag, OIcon, OCard },
  props: ["features", "price", "pricingError"],
  setup() {
    const { t } = useI18nTyped();

    const contactSales = () => {
      analytics.track("billing_contact_sales_clicked", { plan: "enterprise" });
      window.open(siteURL.contactSales, "_blank");
    };

    return {
      t,
      raw,
      contactSales,
    };
  },
});
</script>
