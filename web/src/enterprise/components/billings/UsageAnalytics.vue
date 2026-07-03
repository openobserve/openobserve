<!-- web/src/enterprise/components/billings/UsageAnalytics.vue -->
<template>
  <div class="tw:p-3 tw:w-full">
    <!-- no-access -->
    <div
      v-if="viewState === 'no-access'"
      data-test="usage-analytics-no-access"
      class="tw:text-center tw:py-10 tw:text-(--o2-text-heading)"
    >
      {{ t("billing.usageAnalytics.noAdminAccess") }}
    </div>

    <!-- disabled: enable CTA -->
    <div
      v-else-if="viewState === 'disabled'"
      data-test="usage-analytics-enable"
      class="tw:text-center tw:py-10 tw:flex tw:flex-col tw:items-center tw:gap-3"
    >
      <div class="tw:text-xl tw:font-semibold tw:text-(--o2-text-heading)">
        {{ t("billing.usageAnalytics.enableTitle") }}
      </div>
      <div class="tw:max-w-[520px] tw:text-(--o2-text-secondary)">
        {{ t("billing.usageAnalytics.enableBody") }}
      </div>
      <OButton
        data-test="usage-analytics-enable-btn"
        variant="primary"
        size="sm-action"
        :loading="enabling"
        @click="enableUsageAnalytics"
      >
        {{ t("billing.usageAnalytics.enableButton") }}
      </OButton>
    </div>

    <!-- warming -->
    <div
      v-else-if="viewState === 'warming'"
      data-test="usage-analytics-warming"
      class="tw:text-center tw:py-10 tw:flex tw:flex-col tw:items-center tw:gap-2"
    >
      <div class="tw:text-xl tw:font-semibold tw:text-(--o2-text-heading)">
        {{ t("billing.usageAnalytics.warmingTitle") }}
      </div>
      <div class="tw:max-w-[520px] tw:text-(--o2-text-secondary)">
        {{ t("billing.usageAnalytics.warmingBody") }}
      </div>
    </div>

    <!-- live -->
    <div v-else data-test="usage-analytics-live" class="tw:flex tw:flex-col tw:gap-4">
      <div class="tw:flex tw:justify-end tw:mb-2">
        <DateTimePicker
          data-test="usage-analytics-date-picker"
          :model-value="dateModel"
          @update:model-value="onDateChange"
        />
      </div>
      <div class="tw:grid tw:grid-cols-2 tw:gap-4">
        <div class="tw:bg-(--o2-card-bg) tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:p-4">
          <div class="tw:text-(--o2-text-secondary)">{{ t("billing.usageAnalytics.last24h") }}</div>
          <div class="tw:text-2xl tw:font-semibold tw:text-(--o2-text-heading)">
            {{ display(result.last24hMb) }} {{ unitLabel }}
          </div>
        </div>
        <div class="tw:bg-(--o2-card-bg) tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:p-4">
          <div class="tw:text-(--o2-text-secondary)">{{ t("billing.usageAnalytics.avgDaily") }}</div>
          <div class="tw:text-2xl tw:font-semibold tw:text-(--o2-text-heading)">
            {{ display(result.avgDailyMb) }} {{ unitLabel }}
          </div>
          <div v-if="result.daysOfData < 7" class="tw:text-xs tw:text-(--o2-text-secondary)">
            {{ t("billing.usageAnalytics.avgDailyCaveat", { days: result.daysOfData }) }}
          </div>
        </div>
      </div>

      <!-- per-stream table -->
      <div>
        <div class="tw:font-semibold tw:mb-2 tw:text-(--o2-text-heading)">
          {{ t("billing.usageAnalytics.perStreamTitle") }}
        </div>
        <table data-test="usage-analytics-per-stream" class="tw:w-full tw:text-left">
          <thead>
            <tr class="tw:text-(--o2-text-secondary)">
              <th class="tw:py-1">{{ t("billing.usageAnalytics.streamColumn") }}</th>
              <th class="tw:py-1">{{ unitLabel }}</th>
              <th class="tw:py-1">{{ t("billing.usageAnalytics.percentOfTotal") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in result.perStream" :key="row.stream_name" class="tw:border-t tw:border-(--o2-border-color)">
              <td class="tw:py-1 tw:text-(--o2-text-heading)">{{ row.stream_name }}</td>
              <td class="tw:py-1">{{ display(row.total_mb) }}</td>
              <td class="tw:py-1">{{ percent(row.total_mb) }}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- trend chart -->
      <div>
        <div class="tw:font-semibold tw:mb-2 tw:text-(--o2-text-heading)">
          {{ t("billing.usageAnalytics.trendTitle") }}
        </div>
        <div style="height: 260px">
          <CustomChartRenderer :data="trendChart" />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, defineAsyncComponent, getCurrentInstance } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import DateTimePicker from "@/components/DateTimePicker.vue";
import organizations from "@/services/organizations";
import { toast } from "@/lib/feedback/Toast/useToast";
import { getConsumableDateTime } from "@/utils/commons";
import { fetchUsageAnalytics, type UsageAnalyticsResult } from "./useUsageAnalytics";
import { mbToDisplay } from "./usageAnalytics";

const CustomChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/CustomChartRenderer.vue"),
);

export default defineComponent({
  name: "UsageAnalytics",
  components: { OButton, CustomChartRenderer, DateTimePicker },
  props: {
    unit: { type: String, default: "gb" },
    canAdmin: { type: Boolean, default: true },
  },
  setup(props) {
    const instance = getCurrentInstance();
    const t = (key: string, params?: Record<string, unknown>) =>
      (instance?.proxy as any)?.$t?.(key, params) ?? key;
    const store = useStore();

    const empty: UsageAnalyticsResult = {
      hasData: false,
      last24hMb: 0,
      avgDailyMb: 0,
      daysOfData: 0,
      perStream: [],
      trend: [],
    };
    const result = ref<UsageAnalyticsResult>(empty);
    const loading = ref(false);
    const enabling = ref(false);

    const enabled = computed(
      () => !!store.state?.organizationData?.organizationSettings?.usage_stream_enabled,
    );

    const viewState = computed(() => {
      if (!props.canAdmin) return "no-access";
      if (!enabled.value) return "disabled";
      if (!result.value.hasData) return "warming";
      return "live";
    });

    const unitLabel = computed(() => (props.unit === "gb" ? "GB" : "MB"));
    const display = (mb: number) => mbToDisplay(mb, props.unit as "gb" | "mb");

    const totalMb = computed(() =>
      result.value.perStream.reduce((s, r) => s + r.total_mb, 0),
    );
    const percent = (mb: number) =>
      totalMb.value > 0 ? Math.round((mb / totalMb.value) * 1000) / 10 : 0;

    const trendChart = computed(() => ({
      options: {
        xAxis: {
          type: "category",
          data: result.value.trend.map((p) => p.day),
        },
        yAxis: { type: "value" },
        series: [
          {
            type: "bar",
            data: result.value.trend.map((p) => display(p.total_mb)),
          },
        ],
      },
    }));

    const dateModel = ref({
      tab: "relative",
      relative: { period: { label: "Days", value: "Days" }, value: 1 },
      absolute: {
        date: { from: "", to: "" },
        startTime: "00:00",
        endTime: "23:59",
      },
    });

    const currentWindow = () => {
      const { start_time, end_time } = getConsumableDateTime(
        JSON.parse(JSON.stringify(dateModel.value)),
      );
      return {
        start: new Date(start_time).getTime() * 1000,
        end: new Date(end_time).getTime() * 1000,
      };
    };

    const load = async () => {
      if (props.canAdmin !== true || !enabled.value) return;
      loading.value = true;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const { start, end } = currentWindow();
        result.value = await fetchUsageAnalytics(orgId, start, end);
      } catch (e) {
        result.value = empty;
      } finally {
        loading.value = false;
      }
    };

    const onDateChange = (val: any) => {
      dateModel.value = val;
      load();
    };

    const enableUsageAnalytics = async () => {
      enabling.value = true;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const existing = store.state?.organizationData?.organizationSettings ?? {};
        const payload = { ...existing, usage_stream_enabled: true };
        await organizations.post_organization_settings(orgId, payload);
        store.dispatch("setOrganizationSettings", payload);
        toast({ message: t("billing.usageAnalytics.enableButton"), variant: "success" });
        await load();
      } catch (e) {
        toast({ message: "Failed to enable Usage Analytics", variant: "error" });
      } finally {
        enabling.value = false;
      }
    };

    onMounted(load);

    return {
      t,
      result,
      viewState,
      unitLabel,
      display,
      percent,
      trendChart,
      enabling,
      enableUsageAnalytics,
      dateModel,
      onDateChange,
    };
  },
});
</script>
