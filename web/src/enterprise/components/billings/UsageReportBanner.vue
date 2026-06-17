<template>
    <div v-if="showBanner && config.isEnterprise == 'true' && config.isCloud === 'false'" class="tw:w-full tw:rounded-md tw:p-3" :class="bannerClass">
        <div class="tw:flex">
        <div class="tw:flex tw:flex-col">
        <span class="tw:text-(--text-lg) tw:font-semibold tw:leading-(--leading-xl) tw:text-(--color-text-heading)">{{ message }}</span>
        <br />
        <span class="tw:text-(--text-md) tw:font-normal tw:leading-(--leading-md) tw:text-(--color-text-body)">{{ subtitle }}</span>
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
      return isSevere.value
        ? 'tw:border tw:border-[#f87171] tw:[background:linear-gradient(to_right,transparent_60%,#fff5f5_70%,#fecdd3_100%)] tw:dark:border-[#dc2626] tw:dark:[background:linear-gradient(to_right,transparent_60%,#2d1f1f_70%,#3d2020_100%)]'
        : 'tw:border tw:border-[#f0c674] tw:[background:linear-gradient(to_right,transparent_60%,#fffbf0_70%,#fff3cd_100%)] tw:dark:border-[#a08530] tw:dark:[background:linear-gradient(to_right,transparent_60%,#2d2a1f_70%,#3d3520_100%)]';
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
