<template>
  <OCard
    class="tw:flex tw:flex-col tw:h-full tw:flex-nowrap"
    style="min-width: 480px; max-width: 800px"
  >
    <!-- Header -->
    <div class="tw:px-2 tw:py-3">
      <OCardSection role="header" class="tw:w-full">
        <div class="tw:flex tw:items-center tw:justify-between tw:w-full">
          <div class="tw:text-base tw:font-bold" data-test="queryList-title-text">
            {{ t("queries.queryList") }}
          </div>
          <OButton
            variant="ghost"
            size="icon-sm"
            data-test="queryList-cancel"
            @click="$emit('close')"
            icon-left="close"
          />
        </div>
      </OCardSection>
      <OSeparator />
    </div>

    <OTable
      class="my-sticky-virtscroll-table o2-table-hide-header"
      :data="queryRows"
      :columns="queryListColumns"
      :default-columns="false"
      row-key="_rowKey"
      pagination="none"
      dense
      data-test="queryList-table"
    />
  </OCard>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { timestampToTimezoneDate, durationFormatter } from "@/utils/zincutils";
import { useStore } from "vuex";
import { getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import OButton from '@/lib/core/Button/OButton.vue';
import OTable from '@/lib/core/Table/OTable.vue';
import { COL } from "@/lib/core/Table/OTable.types";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

export default defineComponent({
  name: "QueryList",
  components: { OSeparator, OButton, OTable, OCard, OCardSection },
  emits: ["save", "close"],
  props: {
    schemaData: Object,
    metaData: Object,
  },
  setup(props: any) {
    const { t } = useI18n();
    const queryData = props.metaData?.queries || [];
    const store = useStore();
    const getRows = (query: any) => {
      const timestampOfStartTime = query?.start_time;
      const formattedStartTime = timestampToTimezoneDate(
        timestampOfStartTime / 1000,
        store.state.timezone,
        "yyyy-MM-dd HH:mm:ss",
      );
      const startTimeEntry = `${formattedStartTime} ${store.state.timezone} (${timestampOfStartTime})`;

      const timestampOfEndTime = query?.end_time;
      const formattedEndTime = timestampToTimezoneDate(
        timestampOfEndTime / 1000,
        store.state.timezone,
        "yyyy-MM-dd HH:mm:ss",
      );
      const endTimeEntry = `${formattedEndTime} ${store.state.timezone} (${timestampOfEndTime})`;

      const localTimeToMicroseconds = () => {
        // Create a Date object representing the current local time
        var date = new Date();

        // Get the timestamp in milliseconds
        var timestampMilliseconds = date.getTime();

        // Convert milliseconds to microseconds
        var timestampMicroseconds = timestampMilliseconds * 1000;

        return timestampMicroseconds;
      };

      const getDuration = (createdAt: number) => {
        const currentTime = localTimeToMicroseconds();
        const durationInSeconds = Math.floor(
          (currentTime - createdAt) / 1000000,
        );

        return durationFormatter(durationInSeconds);
      };

      //different between start and end time to show in UI as queryRange
      const queryRange = (startTime: number, endTime: number) => {
        const queryDuration = Math.floor((endTime - startTime) / 1000000);

        return durationFormatter(queryDuration);
      };

      const originalSize =
        query?.original_size !== undefined
          ? getUnitValue(query?.original_size, "megabytes", "", 2)
          : { value: "", unit: "" };

      const compressedSize =
        query?.compressed_size !== undefined
          ? getUnitValue(query?.compressed_size, "megabytes", "", 2)
          : { value: "", unit: "" };
      const rows: any[] = [
        ["Trace ID", query?.trace_id],
        ["Status", query?.status],
        ["User ID", query?.user_id],
        ["Org ID", query?.org_id],
        ["Stream Type", query?.stream_type],
        ["Search Type", query?.search_type],
        ["Query Source", query?.query_source],
        ["SQL", query?.sql],
        ["Start Time", startTimeEntry],
        ["End Time", endTimeEntry],
        ["Exec. Duration", getDuration(query?.created_at)],
        ["Query Range", queryRange(query?.start_time, query?.end_time)],
        ["Scan Records", query?.records],
        ["Files", query?.files],
        [
          "Original Size",
          originalSize.value
            ? `${originalSize.value} ${originalSize.unit}`
            : "",
        ],
        [
          "Compressed Size",
          compressedSize.value
            ? `${compressedSize.value} ${compressedSize.unit}`
            : "",
        ],
      ];

      return rows;
    };

    const queryRows = computed(() => {
      const rows = getRows(props.schemaData);
      return rows.map(([key, value]: [string, any], index: number) => ({
        _rowKey: `row_${index}`,
        key,
        value,
      }));
    });

    const queryListColumns = [
      { id: "key", header: "", accessorKey: "key", sortable: false, size: COL.owner, meta: { align: "left" as const } },
      { id: "value", header: "", accessorKey: "value", sortable: false, size: COL.description, meta: { align: "left" as const, autoWidth: true } },
    ];

    return {
      queryData,
      t,
      getRows,
      queryRows,
      queryListColumns,
    };
  },
});
</script>

<style scoped>.o2-table-hide-header :deep(thead) {
  display: none;
}
</style>
