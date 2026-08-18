<template>
  <div
    v-if="showBanner && config.isEnterprise == 'true' && config.isCloud === 'false'"
    class="rounded-default w-full p-3"
    :class="bannerClass"
  >
    <div class="flex">
      <div class="flex flex-col">
        <span class="text-text-heading text-lg leading-(--leading-xl) font-semibold">{{
          message
        }}</span>
        <br />
        <span class="text-text-body text-base leading-(--leading-md) font-normal">{{
          subtitle
        }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { useI18nTyped } from "@/types/i18n";

export default defineComponent({
  name: "UsageReportBanner",
  setup() {
    const { t } = useI18nTyped();
    const store = useStore();

    // Purely reactive: the banner derives everything from
    // store.state.zoConfig.last_usage_report_ts. UsageTab refreshes that config
    // on mount, so the banner updates on every Usage-tab visit without owning an
    // API call itself.
    const elapsedMs = computed(() => {
      if (!store.state.zoConfig || !("last_usage_report_ts" in store.state.zoConfig)) return 0;
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
        return t("billing.usageReportingFailedForDays", { count: days }, days);
      }
      const hours = Math.floor(ms / ONE_HOUR);
      return t("billing.usageReportingFailingForHours", { count: hours }, hours);
    });

    const subtitle = computed(() => {
      if (isSevere.value) {
        return t("billing.contactAdministratorToResolve");
      }
      return t("billing.contactAdministratorUsageReporting");
    });

    const bannerClass = computed(() => {
      return isSevere.value
        ? "border border-usage-banner-error-border [background:var(--color-usage-banner-error-bg)]"
        : "border border-usage-banner-warning-border [background:var(--color-usage-banner-warning-bg)]";
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
