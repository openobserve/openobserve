<template>
    <div v-if="showBanner && config.isEnterprise == 'true' && config.isCloud === 'false'" class="tw:w-full usage-report-container tw:p-3" :class="bannerClass">
        <div class="tw:flex">
        <div class="tw:flex tw:flex-col">
        <span class="o2-usage-message">{{ message }}</span>
        <br />
        <span class="o2-usage-subtitle">{{ subtitle }}</span>
        </div>
  </div>
    </div>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useStore } from 'vuex';
import config from '@/aws-exports';

export default defineComponent({
  name: 'UsageReportBanner',
  setup() {
    const store = useStore();

    // Purely reactive: the banner derives everything from
    // store.state.zoConfig.last_usage_report_ts. UsageTab refreshes that config
    // on mount, so the banner updates on every Usage-tab visit without owning an
    // API call itself.
    const elapsedMs = computed(() => {
      if (!store.state.zoConfig || !('last_usage_report_ts' in store.state.zoConfig)) return 0;
      const ts = store.state.zoConfig.last_usage_report_ts;
      if (!ts || ts === 0) return 0;
      // ts is in microseconds, convert to ms
      const reportedAtMs = ts / 1000;
      return Date.now() - reportedAtMs;
    });

    const ONE_HOUR = 60 * 60 * 1000;
    const SEVEN_DAYS = 7 * 24 * ONE_HOUR;

    const showBanner = computed(() => {
      return elapsedMs.value > 6 * ONE_HOUR;
    });

    const isSevere = computed(() => {
      return elapsedMs.value >= SEVEN_DAYS;
    });

    const message = computed(() => {
      const ms = elapsedMs.value;
      if (ms >= SEVEN_DAYS) {
        const days = Math.floor(ms / (24 * ONE_HOUR));
        return `Usage reporting has failed for ${days} day${days !== 1 ? 's' : ''}, RBAC and SSO features are disabled until usage is successfully reported`;
      }
      const hours = Math.floor(ms / ONE_HOUR);
      return `Usage reporting has been failing for ${hours} hour${hours !== 1 ? 's' : ''}, some features will get disabled soon`;
    });

    const subtitle = computed(() => {
      if (isSevere.value) {
        return 'Please contact your administrator to resolve this issue.';
      }
      return 'Please contact your administrator to ensure usage reporting is restored.';
    });

    const bannerClass = computed(() => {
      return isSevere.value ? 'usage-report-error' : 'usage-report-warning';
    });

    return {
      showBanner,
      message,
      subtitle,
      bannerClass,
      config,
    };
  },
});
</script>

<style lang="scss" scoped>
.usage-report-warning {
  background: linear-gradient(
    to right,
    transparent 60%,
    #fffbf0 70%,
    #fff3cd 100%);
  border: 1px solid #f0c674;
}

.usage-report-error {
  background: linear-gradient(
    to right,
    transparent 60%,
    #fff5f5 70%,
    #fecdd3 100%);
  border: 1px solid #f87171;
}

.usage-report-container {
  border-radius: 6px;
}

.o2-usage-message {
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: var(--leading-xl);
  color: var(--color-text-heading);
}

.o2-usage-subtitle {
  font-size: var(--text-md);
  font-weight: 400;
  line-height: var(--leading-md);
  color: var(--color-text-body);
}

.body--dark {
  .usage-report-warning {
    background: linear-gradient(
      to right,
      transparent 60%,
      #2d2a1f 70%,
      #3d3520 100%);
    border: 1px solid #a08530;
  }

  .usage-report-error {
    background: linear-gradient(
      to right,
      transparent 60%,
      #2d1f1f 70%,
      #3d2020 100%);
    border: 1px solid #dc2626;
  }
}
</style>
