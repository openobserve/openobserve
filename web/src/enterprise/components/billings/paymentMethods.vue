<!-- Copyright 2023 Zinc Labs Inc.

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
import Card from "@/constants/cards";

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
