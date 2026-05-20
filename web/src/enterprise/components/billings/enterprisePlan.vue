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
  <OCard class="tw:flex tw:flex-col o2-card-wrapper">
    <div class="tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2">
      <div>
        <div class="tw:pt-2">
          {{ t("billing.enterpriseLabel") }}
        </div>
        <div class="o2-card-subtitle tw:mt-2">
          {{ t("billing.enterpriseSubtitle") }}
        </div>
      </div>
      <OBadge
        variant="primary-soft"
        class="tw:mt-2 tw:text-xs tw:px-2 tw:py-3"
        style="border-radius: 0px"
      >
        {{ t("billing.discountTag") }}
      </OBadge>
    </div>

    <OSeparator class="tw:my-2" />

    <div class="tw:px-3 tw:pt-2 tw:h-[550px]">
      <div class="o2-page-subtitle1">{{ t("billing.features") }}</div>
      <div class="o2-page-subtitle2 tw:mb-3 tw:mt-1">
        {{ t("billing.included") }}
      </div>

      <div
        v-if="pricingError && !features?.length"
        class="tw:flex tw:items-center tw:mb-2 tw:text-red-500"
      >
        <OIcon name="warning" size="sm" class="tw:mr-2" />
        <span class="o2-page-subtitle3"
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
            size="sm"
            class="tw:mr-2"
          />
          <OIcon v-else name="check-circle-outline" size="sm" class="tw:mr-2 tw:text-green-500" />
          <div class="o2-page-subtitle3">{{ feature.name }}</div>
        </div>
        <div class="o2-page-subtitle3 tw:font-bold">{{ feature.price }}</div>
      </div>
    </div>

    <OSeparator />

    <div class="o2-page-subtitle2 tw:px-3 tw:pt-2">
      {{ t("billing.enterpriseNote") }}
    </div>

    <div class="tw:flex tw:justify-between tw:p-3 tw:mt-[18px]">
      <OButton variant="primary" size="sm-action" tw:block @click="contactSales">
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

<style scoped>
.full-width {
  width: 100%;
}
</style>
