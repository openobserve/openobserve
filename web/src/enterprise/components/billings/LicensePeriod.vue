<template>
  <div
    v-if="showLicenseExpiryWarning && config.isEnterprise == 'true' && config.isCloud === 'false'"
    data-test="license-period-container"
    class="border-border-default rounded-default w-full border p-3 [background:var(--color-usage-banner-success-bg)]"
  >
    <div class="flex">
      <div class="flex flex-col">
        <span data-test="license-period-message" class="text-lg leading-8 font-semibold">{{
          getLicenseExpiryMessage()
        }}</span>
        <br />
        <span data-test="license-period-subtitle" class="text-base leading-5.5 font-normal">{{
          t("billing.licenseExpiryContactAdmin")
        }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";

export default defineComponent({
  name: "LicensePeriod",
  emits: ["updateLicense"],
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const showLicenseExpiryWarning = computed(() => {
      if (!store.state.zoConfig.license_expiry) return false;
      const now = Date.now();
      //convert micro to millseconds
      const expiryDate = store.state.zoConfig.license_expiry / 1000;
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry < 14;
    });

    const getLicenseExpiryMessage = () => {
      if (!store.state.zoConfig.license_expiry) return "";
      const now = Date.now();
      const expiryDate = store.state.zoConfig.license_expiry / 1000;
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry > 1) {
        return `${daysUntilExpiry} days remaining until your license expires`;
      } else if (daysUntilExpiry === 1) {
        return `1 day remaining until your license expires`;
      } else {
        return "Your license has expired";
      }
    };
    return {
      t,
      getLicenseExpiryMessage,
      showLicenseExpiryWarning,
      config,
    };
  },
});
</script>
