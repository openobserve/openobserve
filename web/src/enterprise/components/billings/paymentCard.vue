<!-- Copyright 2023 Zinc Labs Inc.

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
        <q-icon name="do_not_disturb_on" size="20px"
color="white" />
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
