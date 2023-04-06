<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <q-page class="q-pa-md">
    <div class="row text-body1 text-weight-medium q-pb-md">
      {{ t("billing.paymentMethod") }}
    </div>
    <div class="row q-gutter-md">
      <payment-card
        v-for="card in Cards"
        :key="card.id"
        :card="card"
      ></payment-card>
      <q-card class="cols q-pa-sm add-card">
        <q-card-section class="card-section">
          <q-icon name="add_circle" size="31px" color="secondary" />
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "@vue/runtime-core";
import { useI18n } from "vue-i18n";
import PaymentCard from "./paymentCard.vue";
import Card from "../../../constants/cards";

export default defineComponent({
  name: "Payment Details",
  components: {
    PaymentCard,
  },
  setup() {
    const { t } = useI18n();
    const Cards = Card;
    return {
      t,
      Cards,
    };
  },
});
</script>
<style lang="scss" scoped>
.add-card {
  width: 260px;
  max-width: 260px;
  height: 140px;
  max-height: 140px;
  border: 1px solid $secondary;
  box-shadow: none;
  border-radius: 8px;
  background: rgba(92, 163, 128, 0.1);
  .card-section {
    height: 120px;
    display: flex;
    justify-content: center;
    align-items: center;
  }
}
</style>
