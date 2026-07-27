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
    class="border-card-glass-border bg-card-glass-bg rounded-default dark:bg-surface-base dark:border-border-default flex h-full w-full flex-col border shadow-none"
  >
    <div class="flex items-center justify-between px-3 py-2">
      <div>
        <h3 class="text-text-heading m-0 pt-2 text-base leading-6 font-semibold">
          {{ t("billing.enterpriseLabel") }}
        </h3>
        <p class="text-text-secondary m-0 mt-2 text-sm leading-[1.125rem] font-normal">
          {{ t("billing.enterpriseSubtitle") }}
        </p>
      </div>
      <OTag type="billingTag" value="discount" class="mt-2" />
    </div>

    <OSeparator class="my-2" />

    <div class="h-137.5 px-3 pt-2">
      <h4 class="text-compact text-text-heading m-0 leading-[0.983rem] font-semibold">
        {{ t("billing.features") }}
      </h4>
      <p class="text-compact text-text-secondary m-0 mt-1 mb-3 leading-[1.125rem] font-normal">
        {{ t("billing.included") }}
      </p>

      <div
        v-if="pricingError && !features?.length"
        class="text-status-error-text mb-2 flex items-center"
      >
        <OIcon name="warning" size="sm" class="mr-2" />
        <span class="text-text-body text-base leading-[1.375rem]"
          >Failed to load pricing details. Please refresh the page.</span
        >
      </div>
      <div
        v-for="(feature, index) in features"
        :key="index"
        class="mb-2 flex items-center justify-between"
      >
        <div class="flex items-center">
          <OIcon
            v-if="feature.is_parent"
            name="check-circle"
            size="md"
            class="text-status-positive check-icon mr-2"
          />
          <div
            class="text-text-body text-base leading-[1.375rem]"
            :class="{ 'ml-6': !feature.is_parent }"
          >
            {{ feature.name }}
          </div>
        </div>
        <div class="text-text-body text-base leading-[1.375rem] font-bold">{{ feature.price }}</div>
      </div>
    </div>

    <OSeparator />

    <p class="text-compact text-text-secondary m-0 px-3 pt-2 leading-[1.125rem] font-normal">
      {{ t("billing.enterpriseNote") }}
    </p>

    <div class="mt-4.5 flex justify-between p-3">
      <OButton variant="primary" size="sm-action" class="w-full" @click="contactSales">
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
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCard from "@/lib/core/Card/OCard.vue";

export default defineComponent({
  name: "enterprisePlan",
  components: { OSeparator, OButton, OTag, OIcon, OCard },
  props: ["features", "pricingError"],
  setup() {
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
