<template>
  <q-card class="column full-height no-wrap">
    <!-- Header -->
    <div style="width: 40vw" class="q-px-sm q-py-md">
      <q-card-section class="q-pb-sm q-px-sm q-pt-none">
        <div class="row items-center no-wrap">
          <div class="col">
            <div class="text-body1 text-bold" data-test="queryList-title-text">
              {{ t("queries.queryList") }}
            </div>
          </div>
          <div class="col-auto">
            <q-btn
              v-close-popup="true"
              data-test="queryList-cancel"
              round
              flat
              icon="cancel"
            />
          </div>
        </div>
      </q-card-section>
      <q-separator />
    </div>

    <q-table
      class="my-sticky-virtscroll-table"
      virtual-scroll
      v-model:pagination="pagination"
      :rows-per-page-options="[0]"
      :virtual-scroll-sticky-size-start="48"
      dense
      :rows="getRows(schemaData)"
      hide-bottom
      hide-header
      row-key="index"
      wrap-cells
      data-test="queryList-table"
    >
    </q-table>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { timestampToTimezoneDate } from "@/utils/zincutils";
import { useStore } from "vuex";
import { getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";

export default defineComponent({
  name: "QueryList",
  components: {},
  props: {
    schemaData: Object,
  },
  emits: ["save"],
  setup(props: any) {
    const { t } = useI18n();
    const queryData = props.metaData?.queries || [];
    const store = useStore();
    const getRows = (query: any) => {
      const timestampOfStartTime = query?.start_time;
      const formattedStartTime = timestampToTimezoneDate(
        timestampOfStartTime / 1000,
        store.state.timezone,
        "yyyy-MM-dd HH:mm:ss"
      );
      const startTimeEntry = `${formattedStartTime} ${store.state.timezone} (${timestampOfStartTime})`;

      const timestampOfEndTime = query?.end_time;
      const formattedEndTime = timestampToTimezoneDate(
        timestampOfEndTime / 1000,
        store.state.timezone,
        "yyyy-MM-dd HH:mm:ss"
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
          (currentTime - createdAt) / 1000000
        );

        let formattedDuration;
        if (durationInSeconds < 0) {
          formattedDuration = "Invalid duration";
        } else if (durationInSeconds < 60) {
          formattedDuration = `${durationInSeconds}s`;
        } else if (durationInSeconds < 3600) {
          const minutes = Math.floor(durationInSeconds / 60);
          formattedDuration = `${minutes}m`;
        } else {
          const hours = Math.floor(durationInSeconds / 3600);
          formattedDuration = `${hours}h`;
        }

        return formattedDuration;
      };

      //different between start and end time to show in UI as queryRange
      const queryRange = (startTime: number, endTime: number) => {
        const queryDuration = Math.floor((endTime - startTime) / 1000000);
        let formattedDuration;
        if (queryDuration < 0) {
          formattedDuration = "Invalid duration";
        } else if (queryDuration < 60) {
          formattedDuration = `${queryDuration}s`;
        } else if (queryDuration < 3600) {
          const minutes = Math.floor(queryDuration / 60);
          formattedDuration = `${minutes}m`;
        } else {
          const hours = Math.floor(queryDuration / 3600);
          formattedDuration = `${hours}h`;
        }

        return formattedDuration;
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
        ["SQL", query?.sql],
        ["Start Time", startTimeEntry],
        ["End Time", endTimeEntry],
        ["Exec. Duration", getDuration(query?.created_at)],
        ["Query Range", queryRange(query?.start_time, query?.end_time)],
        ["Scan Records", query?.records],
        ["Files", query?.files],
        [
          "Original Size",
          originalSize.value ? `${originalSize.value} ${originalSize.unit}` : "",
        ],
        [
          "Compressed Size",
          compressedSize.value ? `${compressedSize.value} ${compressedSize.unit}` : "",
        ],
      ];

      return rows;
    };

    return {
      queryData,
      t,
      getRows,
      pagination: ref({
        rowsPerPage: 0,
      }),
    };
  },
});
</script>

<style scoped></style>
