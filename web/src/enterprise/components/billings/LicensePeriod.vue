<template>
    <div v-if="showLicenseExpiryWarning && config.isEnterprise == 'true' && config.isCloud === 'false'" class="full-width license-expiry-container q-pa-md gradient-banner">
        <div class="row" >
        <div class="col">
        <span class="o2-license-message">{{ getLicenseExpiryMessage() }}</span>
        <br />
        <span class="o2-license-subtitle">Please update your license by contacting your administrator.</span>
        </div>
  </div>
    </div>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import config from '@/aws-exports';

export default defineComponent({
  name: 'LicensePeriod',
  emits: ['updateLicense'],
  setup(emits) {
    const store = useStore();
    const router = useRouter();
    const showLicenseExpiryWarning = computed(() => {
      if (!store.state.zoConfig.license_expiry) return false;
      const now = Date.now();
      //convert micro to millseconds
      const expiryDate = store.state.zoConfig.license_expiry / 1000;
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry < 14;
    });

    const getLicenseExpiryMessage = () => {
      if (!store.state.zoConfig.license_expiry) return '';
      const now = Date.now();
      const expiryDate = store.state.zoConfig.license_expiry / 1000;
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      
      if (daysUntilExpiry > 1) {
        return `${daysUntilExpiry} days remaining until your license expires`;
      } else if (daysUntilExpiry === 1) {
        return `1 day remaining until your license expires`;
      } else {
        return 'Your license has expired';
      }
    };
    return {
      getLicenseExpiryMessage,
      showLicenseExpiryWarning,
      config,
    };
  },
});
</script>


<style lang="scss" scoped>
.gradient-banner {
  background: linear-gradient(
    to right,
    transparent 60%,
    #f7f7ff 70%,
    #cdf7e4 100%  );
}

.license-expiry-container {
  border: 1px solid #D7D7D7;
  border-radius: 6px;
}

.o2-license-message {
  font-size: 18px;
  font-weight: 600;
  line-height: 32px;
}

.o2-license-subtitle {
  font-size: 16px;
  font-weight: 400;
  line-height: 22px;
}

.compact-table {
  td, th {
    padding: 8px 12px !important;
    line-height: 1.2;
  }
}

.body--dark {
  .gradient-banner {
    background: linear-gradient(
      to right,
      transparent 60%,
      #24262F 70%,
      #2C3934 100%  );
  }

  .license-expiry-container {
    border: 1px solid #454F5B;
  }
}
</style>