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
  <q-card
    class="cols q-pa-xs payment-card"
    :class="{
      secondaryColor: cardColor == 'secondary',
      primaryColor: cardColor == 'primary',
    }"
  >
    <q-card-section class="card-section">
      <div class="card-text text-weight-bold q-mb-sm">
        {{ cardData.type }}
      </div>
      <div class="card-text text-weight-bold">
        <q-icon
          :name="'img:' + getImageURL('images/common/master_card_icon.svg')"
          size="34px"
        />
        {{ cardData.number }}
      </div>

      <div class="card-icon">
        <q-icon name="do_not_disturb_on" size="20px" color="white" />
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "PlaymentCard",
  props: ["card"],
  setup(props) {
    const { t } = useI18n();
    const cardData = ref(props.card);
    const cardColor = ref(props.card.color);

    const bgImage = computed(() => {
      return `background-image: url("img:${getImageURL(
        "images/common/secondary_card_bg.svg"
      )}");`;
    });

    return {
      t,
      cardData,
      cardColor,
      bgImage,
      getImageURL,
    };
  },
});
</script>
<style lang="scss" scoped>
.payment-card {
  width: 260px;
  max-width: 260px;
  height: 140px;
  max-height: 140px;
  border: 1px solid $payment-card-border;
  border-radius: 8px;
  box-shadow: none;
  .card-section {
    height: 120px;
  }
  .card-text {
    font-size: 18px;
    color: $white;
  }
  .card-icon {
    position: absolute;
    right: 2px;
    bottom: 0;
  }
}
.secondaryColor {
  background: url("../../assets/images/common/secondary_card_bg.svg") no-repeat;
}
.primaryColor {
  background: url("../../assets/images/common/primary_card_bg.svg") no-repeat;
}
</style>
