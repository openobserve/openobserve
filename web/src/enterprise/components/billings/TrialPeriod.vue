<!-- Copyright 2025 OpenObserve Inc.

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
  <div class="full-width trial-period-container q-pa-md gradient-banner" v-if="showTrialPeriodMsg == true">
    <div class="row">
      <div class="col">
        <span class="o2-trial-message">{{ getTrialPeriodMessage() }}</span>
        <br />
        <span class="o2-trial-subtitle">Upgrade to a plan to continue enjoying the services by OpenObserve.</span>
      </div>
      <div class="col-2 q-mt-sm" v-if="currentPage != 'billing'">
        <q-btn 
          @click="redirectBilling" 
          class="cursor-pointer text-capitalize bg-primary text-white q-px-md q-py-sm rounded-md float-right"
          dense
        >{{ t("billing.upgradeNow") }}</q-btn>
      </div>
      <div class="col-2 q-mt-sm" v-if="currentPage == 'billing'">
        <q-btn 
          @click="redirectContactSupport" 
          class="cursor-pointer text-capitalize bg-primary text-white q-px-md q-py-sm rounded-md float-right"
          dense
        >{{ t("billing.contactSupport") }}</q-btn>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import config from "@/aws-exports";
import { siteURL } from "@/constants/config";
import { getDueDays } from "@/utils/zincutils";

export default defineComponent({
  name: "TrialPeriod",
  props: ["currentPage"],
  methods: {
    getTrialPeriodMessage() {
      if(Object.hasOwn(this.store.state.organizationData.organizationSettings, "free_trial_expiry") && this.store.state.organizationData.organizationSettings.free_trial_expiry != "" && this.store.state.organizationData.organizationSettings.free_trial_expiry != null) {
        let dueDays = this.getDueDays(this.store.state.organizationData.organizationSettings.free_trial_expiry);
        if(dueDays >= 0) {
          if(dueDays > 1) {
            return `${dueDays} Days remaining in your trial account`;
          } else {
            return `${dueDays} Day remaining in your trial account`;
          }
        } else {
          return "Your trial period has expired.";
        }
      }
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();
    const router: any = useRouter();

    const showTrialPeriodMsg = ref((Object.hasOwn(store.state.organizationData.organizationSettings, "free_trial_expiry") && store.state.organizationData.organizationSettings.free_trial_expiry != "" && store.state.organizationData.organizationSettings.free_trial_expiry != null) ? true : false);
    
    const redirectBilling = () => {
      router.push('/billings/plans/')
    };

    const redirectContactSupport = () => {
      window.open(siteURL.contactSupport, "_blank");
    }

    return {
      t,
      store,
      router,
      config,
      redirectBilling,
      getDueDays,
      showTrialPeriodMsg,
      redirectContactSupport,
    };
  },
});
</script>

<style>
.gradient-banner {
  background: linear-gradient(
    to right,
    transparent 60%,
    #f7f7ff 70%,
    #cdf7e4 100%  );
}

.trial-period-container {
  border: 1px solid #D7D7D7;
  border-radius: 6px;
}

.o2-trial-message {
  font-size: 18px;
  font-weight: 600;
  line-height: 32px;
}

.o2-trial-subtitle {
  font-size: 16px;
  font-weight: 400;
  line-height: 22px;
}

.body--dark {
  .gradient-banner {
    background: linear-gradient(
      to right,
      transparent 60%,
      #24262F 70%,
      #2C3934 100%  );
  }

  .trial-period-container {
    border: 1px solid #454F5B;
  }
}
</style>