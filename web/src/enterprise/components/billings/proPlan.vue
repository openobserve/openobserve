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
    <div class="row items-center justify-between q-px-md q-py-sm">
      <div>
        <div class="o2-card-title q-pt-sm">{{ t("billing.proPlanLabel") }}</div>
        <div class="o2-card-subtitle q-mt-sm">{{ t("billing.proPlanSubtitle") }}</div>
      </div>
      <q-chip
        v-if="planType == planName"
        color="indigo-1"
        text-color="indigo-10"
        :label="t('billing.subscribed')"
        class="q-mt-sm text-caption q-px-sm q-py-md"
        style="border-radius: 0px"
        dense
      />
    </div>

    <q-separator spaced />

    <div class="q-px-md q-py-sm">
      <div class="o2-page-subtitle1">{{ t("billing.features") }}</div>
      <div class="o2-page-subtitle2 q-mb-md q-mt-xs">{{ t("billing.included") }}</div>

      <div v-for="(feature, index) in features" :key="index" class="row items-center justify-between q-mb-sm">
        <div class="row items-center">
          <q-icon v-if="feature.is_parent" name="check_circle" color="green" size="16px" class="q-mr-sm" />
          <q-icon v-else name="" color="green" size="16px" class="q-mr-sm" />
          <div class="o2-page-subtitle3">{{ feature.name }}</div>
        </div>
        <div
          v-if="feature.price !== ''"
          class="q-mx-sm"
          style="flex: 1; border-top: 1px dotted #454F5B; height: 0; opacity: 0.4;"
        ></div>
        <div class="o2-page-subtitle3 text-bold">{{ feature.price }}</div>
      </div>
    </div>

    <q-separator />

    <div class="o2-page-subtitle2 q-px-md q-pt-sm">
      {{ t("billing.unlimitedNote") }}<br />
      {{ t("billing.paymentNote") }}
    </div>

    <div class="row justify-between q-pa-md">
      <q-btn
        v-if="planType == planName"
        :label="btnCancelSubscription"
        text-color="black"
        class="full-width bg-grey-4 text-bold text-capitalize text-subtitle1"
        flat
        @click="cancelSubscription"
      />
      <q-btn
        v-else
        :label="btnSubscribe"
        text-color="white"
        class="full-width bg-primary text-bold text-capitalize text-subtitle1"
        flat
        @click="onSubscribe"
      />
    </div>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "proPlan",
  props: ["planType"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const planName = "pay-as-you-go";
    const btnCancelSubscription = ref(t('billing.manageSubscription'));
    const btnSubscribe = ref(t('billing.subscribe'));

    const features = [
      { name: 'Ingestion (Logs, Metrics, Traces)', price: '$0.30/GB' , is_parent: true},
      { name: 'Query Volume', price: '$0.01/GB' , is_parent: true},
      { name: 'Pipelines', price: '' , is_parent: true},
      { name: 'Data Processed', price: '$0.20/ GB' , is_parent: false},
      { name: 'Each additional destination', price: '$0.30/ GB' , is_parent: false},
      { name: 'Each remote destination', price: '$0.45/ GB' , is_parent: false},
      { name: 'RUM & Session Replay', price: '$1/ 1K sessions' , is_parent: true},
      { name: 'Error Tracking', price: '$0.15/ 1K events' , is_parent: true},
      { name: 'Action Script', price: '$1/ 1K runs' , is_parent: true},
      { name: 'Unlimited Users', price: '' , is_parent: true},
      { name: 'Role-Based Access Control (RBAC)', price: '' , is_parent: true},
      { name: '15-Days Retention', price: '' , is_parent: true},
      { name: '30 days additional retention', price: '$0.10/GB' , is_parent: true},
    ];

    const cancelSubscription = () => {
      btnCancelSubscription.value = "Loading...";
      setTimeout(function(){
        btnCancelSubscription.value = t('billing.manageSubscription');
      }, 1000);
      emit("update:cancelSubscription");
    }

    const onSubscribe = () => {
      btnSubscribe.value = "Loading...";
      setTimeout(function(){
        btnSubscribe.value = t('billing.subscribe');
      }, 1000);
      emit("update:proSubscription");
    }

    return {
      t,
      features,
      cancelSubscription,
      onSubscribe,
      planName,
      btnSubscribe,
      btnCancelSubscription
    }
  }
});
</script>

<style scoped>
.full-width {
  width: 100%;
}
</style>
