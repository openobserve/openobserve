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
  <q-card class="cols q-py-md q-pl-md q-pr-sm my-card">
    <q-card-section>
      <div class="row q-mt-sm justify-between items-center">
        <div class="row">
          <div v-if="planData.for == 'individuals'">
            <q-icon
              :name="'img:' + getImageURL('images/common/basic-icon.svg')"
              size="72px"
            />
          </div>
          <div v-if="planData.for == 'startups'">
            <q-icon
              :name="'img:' + getImageURL('images/common/pro_plan_icon.svg')"
              size="72px"
            />
          </div>

          <div class="q-ml-md q-mt-xs">
            <span class="row text-body1 text-weight-redular">
              <span v-if="planData.for == 'individuals'">{{
                t("billing.individuals")
              }}</span>
              <span v-if="planData.for == 'startups'">{{
                t("billing.startups")
              }}</span>
            </span>
            <span class="row text-h5 text-weight-bold">
              <span class="secondaryColor" v-if="planData.type == 'basic'">{{
                t("billing.basic")
              }}</span>
              <span class="primaryColor" v-if="planData.type == 'pro'">{{
                t("billing.pro")
              }}</span>
            </span>
          </div>
        </div>
        <q-icon
          v-if="(isProPlan && planData.pro) || (!isProPlan && planData.basic)"
          name="check_circle"
          size="md"
          color="primary"
        />
      </div>
      <!-- <div class="q-mt-md text-body1 text-weight-redular">
        {{ planData.description }}
      </div> -->
      <!-- <div class="row q-mt-md items-center" :v-show="1 == 0">
        <span
          class="text-weight-bold free"
          :class="{
            secondaryColor: planData.price == 'Free',
            primaryColor: planData.price != 'Free',
          }"
          >{{ planData.price }}</span
        >
        <span class="text-weight-regular text-h6">
          &nbsp;&nbsp;/&nbsp;{{ planData.duration }}
        </span>
      </div> -->
      <div class="text-body1 text-weight-bold q-mt-md">
        {{ t("billing.whatIsIncluded") }}
      </div>
      <div class="text-body1 text-weight-bold q-mt-md" v-if="planData.type == 'pro'">
          {{ t("billing.everythingDeveloperPlan") }}
      </div>
      <div class="q-mt-lg q-mb-xl">
        <div class="q-mt-sm">
          <q-icon name="check_circle" size="20px"
:color="cardColor" />
          <span class="q-ml-sm text-body1 text-weight-redular">{{
            planData.included.rule1
          }}</span>
        </div>
        <div class="q-mt-sm">
          <q-icon name="check_circle" size="20px"
:color="cardColor" />
          <span class="q-ml-sm text-body1 text-weight-redular">{{
            planData.included.rule2
          }}</span>
        </div>
        <div class="q-mt-sm" v-if="planData.included.rule3 != ''">
          <q-icon name="check_circle" size="20px"
:color="cardColor" />
          <span class="q-ml-sm text-body1 text-weight-redular">{{
            planData.included.rule3
          }}</span>
        </div>
      </div>
      <q-btn
        v-if="(planData.basic && isProPlan) || (planData.pro && !isProPlan)"
        class="full-width card-btn"
        type="button"
        :color="cardColor"
        no-caps
        @click="onGetStartedSubscription"
        :disable="freeLoading || proLoading"
      >
        <div v-if="freeLoading || proLoading">
          <q-spinner-dots
            color="white"
            size="40px"
            style="margin: 0 auto; display: block"
          />
        </div>
        <div v-else>
          {{ planData.getStarted }}
        </div>
      </q-btn>

      <div
        v-if="(isProPlan && planData.pro) || (!isProPlan && planData.basic)"
        class="row justify-center items-center card-btn"
        :class="cardColor"
      >
        {{ planData.subscribed }}
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "PlanCard",
  props: ["plan", "hasProPlan", "freeLoading", "proLoading"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();
    const planData = ref(props?.plan);
    const cardColor = ref(props?.plan?.color);
    const loading = ref(false);

    const isProPlan = computed(() => {
      return props.hasProPlan;
    });

    const onGetStartedSubscription = () => {
      loading.value = true;
      if (planData.value.for == "startups") {
        emit("update:proSubscription");
      } else if (isProPlan.value && planData.value.for == "individuals") {
        emit("update:freeSubscription");
      }
    };

    return {
      t,
      planData,
      cardColor,
      isProPlan,
      onGetStartedSubscription,
      loading,
      getImageURL,
    };
  },
});
</script>
<style lang="scss" scoped>
.my-card {
  width: 394px;
  max-width: 394px;
  height: 530px;
  max-height: 530px;
  border: 1px solid $card-border;
  box-shadow: 0px 2px 12px rgba(20, 20, 43, 0.08);
  border-radius: 24px;
  .secondaryColor {
    color: $secondary;
  }
  .primaryColor {
    color: $primary;
  }
  .free {
    font-size: 42px;
  }
  .card-btn {
    height: 72px;
    font-size: 18px;
    font-weight: 700;
    border-radius: 10px;
  }
  .secondary {
    border: 1px solid $secondary;
    color: $secondary;
  }
  .primary {
    border: 1px solid $primary;
    color: $primary;
  }
}
</style>
