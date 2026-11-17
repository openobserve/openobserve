<template>
  <OBanner
    v-if="showBanner"
    variant="warning"
    icon="warning"
    inline-actions
    data-test="license-period-container"
  >
    <div data-test="license-period-message">{{ getLicenseExpiryMessage() }}</div>
    <div v-if="licenseData && !licenseData.can_update_license" data-test="license-period-ask-admin">
      {{ t("billing.licenseAskAdminToRenew") }}
    </div>

    <!-- OBanner reads its slots once, so this slot stays and only the button comes and goes -->
    <template #actions>
      <OButton
        v-if="licenseData?.can_update_license"
        variant="primary"
        size="sm"
        data-test="license-period-renew-btn"
        @click="$emit('renew')"
      >
        {{ t("billing.renewLicense") }}
      </OButton>
    </template>
  </OBanner>
</template>

<script lang="ts">
import { computed, defineComponent } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { licenseQuery } from "@/services/license_server.queries";
import { formatLicenseDay, type LicenseWaiverFields } from "@/utils/licenseWaivers";

export default defineComponent({
  name: "LicensePeriod",
  components: { OBanner, OButton },
  emits: ["renew"],
  setup() {
    const store = useStore();
    const { t, locale } = useI18nTyped();
    const showLicenseExpiryWarning = computed(() => {
      if (!store.state.zoConfig.license_expiry) return false;
      const now = Date.now();
      //convert micro to millseconds
      const expiryDate = store.state.zoConfig.license_expiry / 1000;
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry < 14;
    });
    const showBanner = computed(
      () =>
        showLicenseExpiryWarning.value &&
        config.isEnterprise === "true" &&
        config.isCloud === "false",
    );

    const license = useQuery(() => ({ ...licenseQuery(), enabled: showBanner.value }));
    const licenseData = computed(() => license.data.value as LicenseWaiverFields | undefined);

    const getExpiredMessage = () => {
      const expiredOn = t("billing.licenseExpiredOn", {
        date: formatLicenseDay(store.state.zoConfig.license_expiry, locale.value),
      });
      const decision = licenseData.value?.decision;
      if (licenseData.value?.evaluated_at === 0 || decision?.limit_today_gb == null) {
        return expiredOn;
      }
      const limitLine = t("billing.licenseExpiredLimit", {
        limit: decision.limit_today_gb,
        allowed: decision.allowed_days,
      });
      return raw(`${expiredOn} ${limitLine}`);
    };

    const getLicenseExpiryMessage = () => {
      if (!store.state.zoConfig.license_expiry) return "";
      const now = Date.now();
      const expiryDate = store.state.zoConfig.license_expiry / 1000;
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry > 1) {
        return t("settings.licensePage.daysRemaining", { days: daysUntilExpiry });
      } else if (daysUntilExpiry === 1) {
        return t("billing.oneDayUntilLicenseExpires");
      } else {
        return getExpiredMessage();
      }
    };
    return {
      t,
      getLicenseExpiryMessage,
      showLicenseExpiryWarning,
      showBanner,
      licenseData,
      config,
    };
  },
});
</script>
