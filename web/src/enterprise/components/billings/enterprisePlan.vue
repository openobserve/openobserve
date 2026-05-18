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
  <q-card class="col o2-card-wrapper">
    <div class="row items-center justify-between q-px-md q-py-sm">
      <div>
        <div class="o2-card-title q-pt-sm">{{ t("billing.enterpriseLabel") }}</div>
        <div class="o2-card-subtitle q-mt-sm">{{ t("billing.enterpriseSubtitle") }}</div>
      </div>
      <q-chip
        color="indigo-1"
        text-color="indigo-10"
        :label="t('billing.discountTag')"
        class="q-mt-sm text-caption q-px-sm q-py-md"
        style="border-radius: 0px"
        dense
      />
    </div>

    <q-separator spaced />

    <div class="q-px-md q-pt-sm tw:h-[550px]">
      <div class="o2-page-subtitle1">{{ t("billing.features") }}</div>
      <div class="o2-page-subtitle2 q-mb-md q-mt-xs">{{ t("billing.included") }}</div>

      <div
        v-if="pricingError && !features?.length"
        class="row items-center q-mb-sm text-negative"
      >
        <OIcon name="warning" size="sm" class="q-mr-sm" />
        <span class="o2-page-subtitle3"
          >Failed to load pricing details. Please refresh the page.</span
        >
      </div>
      <div v-for="(feature, index) in features" :key="index" class="row items-center justify-between q-mb-sm">
        <div class="row items-center">
          <OIcon v-if="feature.is_parent" name="check-circle" size="sm" class="q-mr-sm" />
          <OIcon v-else name="" color="green" size="16px" class="q-mr-sm" />
          <div class="o2-page-subtitle3">{{ feature.name }}</div>
        </div>
        <div class="o2-page-subtitle3 text-bold">{{ feature.price }}</div>
      </div>
    </div>

    <q-separator />

    <div class="o2-page-subtitle2 q-px-md q-pt-sm ">
      {{ t("billing.enterpriseNote") }}
    </div>

    <div class="row justify-between q-pa-md tw:mt-[18px] ">
      <OButton
        variant="primary"
        size="sm-action"
        block
        @click="contactSales"
      >
        {{ t('billing.contactLabel') }}
      </OButton>
    </div>
  </q-card>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { siteURL } from "@/constants/config";
import OButton from '@/lib/core/Button/OButton.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "enterprisePlan",
  components: { OButton,
    OIcon,
},
  props: ["features", "pricingError"],
  setup(props, { emit }) {
    const { t } = useI18n();

    const contactSales = () => {
      window.open(siteURL.contactSales, "_blank");
    }

    return {
      t,
      contactSales,
    }
  }
});
</script>

<style scoped>
.full-width {
  width: 100%;
}
</style>
