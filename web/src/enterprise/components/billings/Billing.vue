<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <q-page class="page">
    <div class="head q-table__title q-pb-md">
      {{ t("billing.header") }}
    </div>
    <q-separator class="separator" />
    <q-splitter
      v-model="splitterModel"
      unit="px"
      style="min-height: calc(100vh - 130px)"
    >
      <template v-slot:before>
        <q-tabs
          v-model="billingtab"
          indicator-color="transparent"
          class="text-secondary"
          inline-label
          vertical
        >
          <q-route-tab
            exact
            default
            name="usage"
            :to="'/billings/usage'"
            icon="img:/assets/images/common/usage_icon.svg"
            label="Usage"
            content-class="tab_content"
          />
          <q-route-tab
            exact
            name="plans"
            :to="'/billings/plans'"
            icon="img:/assets/images/common/plan_icon.svg"
            label="Plans"
            content-class="tab_content"
          />
          <!-- <q-route-tab
            name="payment_methods"
            :to="'/billings/payment_methods'"
            icon="img:/assets/images/common/payment_icon.svg"
            label="Payment Methods"
            content-class="tab_content"
          /> -->
          <q-route-tab
            exact
            name="invoice_history"
            :to="'/billings/invoice_history'"
            icon="img:/assets/images/common/invoice_icon.svg"
            label="Invoice History"
            content-class="tab_content"
          />
        </q-tabs>
      </template>

      <template v-slot:after>
        <router-view title=""> </router-view>
        <!-- <q-tab-panels
          v-model="billingtab"
          animated
          swipeable
          vertical
          transition-prev="jump-up"
          transition-next="jump-up"
          keep-alive-include="usage,plans,invoice_history"
        >
          <q-tab-panel name="usage">
            <router-view title=""> </router-view>
          </q-tab-panel>

          <q-tab-panel name="plans">
            <router-view title=""> </router-view>
          </q-tab-panel> -->

        <!-- <q-tab-panel name="payment_methods">
            <router-view title="Payment Methods"> </router-view>
          </q-tab-panel> -->

        <!-- <q-tab-panel name="invoice_history">
            <router-view title=""> </router-view>
          </q-tab-panel>
        </q-tab-panels> -->
      </template>
    </q-splitter>
  </q-page>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import config from "@/aws-exports";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import Usage from "./usage.vue";

export default defineComponent({
  name: "PageIngestion",
  components: { ConfirmDialog, Usage },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();
    const billingtab = ref("usage");

    onMounted(() => {
      if (router.currentRoute.value.name == "billing") {
        billingtab.value = "usage";
        router.push({ path: "/billings/usage" });
      } else {
        billingtab.value = router.currentRoute.value.name;
        router.push({ path: "/billings/" + router.currentRoute.value.name });
      }
      // getOrganizationPasscode();
    });

    return {
      t,
      store,
      router,
      config,
      billingtab,
      splitterModel: ref(200),
    };
  },
});
</script>

<style scoped lang="scss">
.page {
  padding: 1.5rem 1.5rem 0;
  .head {
    padding-bottom: 1rem;
  }
  .q-tabs {
    &--vertical {
      margin: 1.5rem 1rem 0 0;
      .q-tab {
        justify-content: flex-start;
        // padding: 0 1rem 0 1.25rem;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;
        color: $dark;

        &__content.tab_content {
          .q-tab {
            &__icon + &__label {
              padding-left: 0.875rem;
              font-weight: 600;
            }
          }
        }
        &--active {
          background-color: $accent;
        }
      }
    }
  }
}
</style>
