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
  <OCard class="tw:flex tw:flex-col card-wrapper">
    <div class="tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2">
      <div>
        <h3 class="card-title tw:pt-2">
          {{ t("billing.enterpriseLabel") }}
        </h3>
        <p class="card-subtitle tw:mt-2">
          {{ t("billing.enterpriseSubtitle") }}
        </p>
      </div>
      <OBadge
        variant="primary-soft"
        class="tw:mt-2 tw:text-xs tw:px-2 tw:py-3"
      >
        {{ t("billing.discountTag") }}
      </OBadge>
    </div>

    <OSeparator class="tw:my-2" />

    <div class="tw:px-3 tw:pt-2 tw:h-[550px]">
      <h4 class="feature-title">{{ t("billing.features") }}</h4>
      <p class="feature-subtitle tw:mb-3 tw:mt-1">
        {{ t("billing.included") }}
      </p>

      <div
        v-if="pricingError && !features?.length"
        class="tw:flex tw:items-center tw:mb-2 tw:text-red-500"
      >
        <OIcon name="warning" size="sm" class="tw:mr-2" />
        <span class="feature-description"
          >Failed to load pricing details. Please refresh the page.</span
        >
      </div>
      <div
        v-for="(feature, index) in features"
        :key="index"
        class="tw:flex tw:items-center tw:justify-between tw:mb-2"
      >
        <div class="tw:flex tw:items-center">
          <OIcon
            v-if="feature.is_parent"
            name="check-circle"
            size="md"
            class="tw:mr-2 tw:text-green-500 check-icon"
          />
          <div class="feature-description" :class="{ 'tw:ml-6': !feature.is_parent }">{{ feature.name }}</div>
        </div>
        <div class="feature-description tw:font-bold">{{ feature.price }}</div>
      </div>
    </div>

    <OSeparator />

    <p class="feature-note tw:px-3 tw:pt-2">
      {{ t("billing.enterpriseNote") }}
    </p>

    <div class="tw:flex tw:justify-between tw:p-3 tw:mt-[18px]">
      <OButton variant="primary" size="sm-action" class="tw:w-full" @click="contactSales">
        {{ t("billing.contactLabel") }}
      </OButton>
    </div>
  </OCard>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { siteURL } from "@/constants/config";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCard from "@/lib/core/Card/OCard.vue";

export default defineComponent({
  name: "enterprisePlan",
  components: { OSeparator, OButton, OBadge, OIcon, OCard },
  props: ["features", "pricingError"],
  setup(props, { emit }) {
    const { t } = useI18n();

    const contactSales = () => {
      window.open(siteURL.contactSales, "_blank");
    };

    return {
      t,
      contactSales,
    };
  },
});
</script>

<style scoped lang="scss">
.full-width {
  width: 100%;
}

.card-wrapper {
  box-shadow: none;
  border: 1px solid var(--o2-border-color);
  background: var(--o2-card-bg);
  border-radius: 0.5rem;
  width: 100%;
  height: 100%;
}

:deep(.card-wrapper) {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 0.5rem;
}

.body--dark .card-wrapper {
  background: var(--o2-card-background);
  border-color: var(--o2-border);
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.5rem;
  color: var(--o2-text-heading);
  margin: 0;
}

.card-subtitle {
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.125rem;
  color: var(--o2-text-secondary);
  margin: 0;
}

.feature-title {
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 0.983rem;
  color: var(--o2-text-heading);
  margin: 0;
}

.feature-subtitle {
  font-size: 0.8125rem;
  font-weight: 400;
  line-height: 1.125rem;
  color: var(--o2-text-secondary);
  margin: 0;
}

.feature-description {
  font-size: 0.938rem;
  line-height: 1.375rem;
  color: var(--o2-text-body);
}

.feature-note {
  font-size: 0.8125rem;
  font-weight: 400;
  line-height: 1.125rem;
  color: var(--o2-text-secondary);
  margin: 0;
}
</style>
