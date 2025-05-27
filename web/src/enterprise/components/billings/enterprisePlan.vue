<!-- Copyright 2023 OpenObserve Inc.

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
    <div class="row items-center justify-between q-pa-md">
      <div>
        <div class="o2-card-title">{{ t("billing.enterpriseLabel") }}</div>
        <div class="o2-card-subtitle">{{ t("billing.enterpriseSubtitle") }}</div>
      </div>
      <q-chip
        color="indigo-1"
        text-color="indigo-10"
        :label="t('billing.discountTag')"
        class="q-mt-sm text-caption"
        dense
      />
    </div>

    <q-separator spaced />

    <div class="q-pa-md">
      <div class="o2-page-subtitle1">{{ t("billing.features") }}</div>
      <div class="o2-page-subtitle2 q-mb-md">{{ t("billing.included") }}</div>

      <div v-for="(feature, index) in features" :key="index" class="row items-center justify-between q-mb-sm">
        <div class="row items-center">
          <q-icon v-if="feature.is_parent" name="check_circle_outline" color="green" size="16px" class="q-mr-sm" />
          <q-icon v-else name="" color="green" size="16px" class="q-mr-sm" />
          <div class="text-body2" :class="{ 'tw-font-semibold': feature.is_parent }">{{ feature.name }}</div>
        </div>
        <div class="text-body2 text-grey-8 text-bold">{{ feature.price }}</div>
      </div>
    </div>

    <q-separator />

    <div class="text-caption text-grey-7 q-px-md q-pt-sm ">
      {{ t("billing.enterpriseNote") }}
    </div>

    <div class="row justify-between q-gutter-sm q-pa-md tw-mt-[10px] ">
      <q-btn
        :label="t('billing.contactLabel')"
        text-color="white"
        class="full-width bg-primary text-capitalize text-bold text-subtitle1"
        flat
        @click="contactSales"
      />
    </div>
  </q-card>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { siteURL } from "@/constants/config";

export default defineComponent({
  name: "enterprisePlan",
  setup(props, { emit }) {
    const { t } = useI18n();
    const planName = "enterprise";

    const features = [
      { name: 'Everything in Pay as you go plan, plus:', price: '' , is_parent: true},
      { name: 'Extended Data Retention', price: '' , is_parent: true},
      { name: 'Priority Support', price: '' , is_parent: true},
      { name: 'SSO (Single Sign On) with Custom Auth Providers', price: '' , is_parent: true},
      { name: '(Okta, Microsoft Entra, etc)', price: '' , is_parent: false},
      { name: 'SLA Guarantees', price: '' , is_parent: true},
      { name: '', price: '' , is_parent: false},
      { name: '', price: '' , is_parent: false},
      { name: '', price: '' , is_parent: false},
      { name: '', price: '' , is_parent: false},
      { name: '', price: '' , is_parent: false},
      { name: '', price: '' , is_parent: false},
      { name: '', price: '' , is_parent: false},
    ];

    const contactSales = () => {
      window.open(siteURL.contactSales, "_blank");
    }

    return {
      t,
      features,
      contactSales,
      planName
    }
  }
});
</script>

<style scoped>
.full-width {
  width: 100%;
}
</style>
