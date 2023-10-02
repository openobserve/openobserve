<template>
  <div class="error-viewer-container">
    <template v-if="isLoading.length">
      <div
        class="q-pb-lg flex items-center justify-center text-center"
        style="height: calc(100vh - 200px)"
      >
        <div>
          <q-spinner-hourglass
            color="primary"
            size="40px"
            style="margin: 0 auto; display: block"
          />
          <div class="text-center full-width">
            Hold on tight, we're fetching error details.
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="q-px-lg q-py-md">
        <ErrorHeader :error="errorDetails" />
      </div>
      <q-separator class="full-width" />
      <div class="q-px-lg q-py-md">
        <ErrorTags :error="errorDetails" />
        <ErrorStackTrace
          :error_stack="errorDetails.error_stack"
          :error="errorDetails"
        />
        <ErrorSessionReplay :error="errorDetails" />
        <ErrorEvents :error="errorDetails" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, ref } from "vue";
import ErrorHeader from "@/components/rum/errorTracking/view/ErrorHeader.vue";
import ErrorTags from "@/components/rum/errorTracking/view/ErrorTags.vue";
import ErrorEvents from "@/components/rum/errorTracking/view/ErrorEvents.vue";
import ErrorSessionReplay from "@/components/rum/errorTracking/view/ErrorSessionReplay.vue";
import { useRouter } from "vue-router";
import useQuery from "@/composables/useQuery";
import { useStore } from "vuex";
import useErrorTracking from "@/composables/useErrorTracking";
import searchService from "@/services/search";
import ErrorStackTrace from "@/components/rum/errorTracking/view/ErrorStackTrace.vue";

const isLoading = ref<boolean[]>([]);
const router = useRouter();
const { getTimeInterval, parseQuery, buildQueryPayload } = useQuery();
const store = useStore();
const { errorTrackingState } = useErrorTracking();
const errorDetails = ref<any>({});

onBeforeMount(() => {
  console.log("on before mount");
  getError();
  getErrorLogs();
});

const getTimestamp = computed(() => {
  return Number(router.currentRoute.value.query.timestamp) || 30000;
});

const getErrorLogs = () => {
  const req = {
    query: {
      sql: 'select *[QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE]',
      start_time: getTimestamp.value - 300000,
      end_time: getTimestamp.value + 300000,
      from: 0,
      size: 10,
      sql_mode: "full",
    },
  };

  req.query.sql = `select * from ${errorTrackingState.data.stream.errorStream} where ${store.state.zoConfig.timestamp_column}<=${router.currentRoute.value.query.timestamp} and type='error' or type='action' or type='view' or (type='resource' and resource_type='xhr') order by ${store.state.zoConfig.timestamp_column} DESC limit 150`;
  isLoading.value.push(true);
  searchService
    .search({
      org_identifier: store.state.selectedOrganization.identifier,
      query: req,
      page_type: "logs",
    })
    .then((res) => {
      const errorIndex = res.data.hits.findIndex(
        (hit: any) => hit.error_id === router.currentRoute.value.params.id
      );
      errorDetails.value.events = res.data.hits.slice(
        errorIndex,
        errorIndex + 100
      );
      errorDetails.value.events = errorDetails.value.events.map(
        (event: any) => ({
          ...event,
          category: getErrorCategory(event),
        })
      );
    })
    .finally(() => isLoading.value.pop());
};

const getErrorCategory = (row: any) => {
  if (row["type"] === "error") return row["error_type"] || "Error";
  else if (row["type"] === "resource") return row["resource_type"];
  else if (row["type"] === "view")
    return row["view_loading_type"] === "route_change"
      ? "Navigation"
      : "Reload";
  else if (row["type"] === "action") return row["action_type"];
  else return row["type"];
};

const getError = () => {
  const req = {
    query: {
      sql: 'select *[QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE]',
      start_time: getTimestamp.value - 300000,
      end_time: getTimestamp.value + 86400000000,
      from: 0,
      size: 10,
      sql_mode: "full",
    },
  };

  req.query.sql = `select * from ${errorTrackingState.data.stream.errorStream} where error_id='${router.currentRoute.value.params.id}'`;
  isLoading.value.push(true);
  searchService
    .search({
      org_identifier: store.state.selectedOrganization.identifier,
      query: req,
      page_type: "logs",
    })
    .then((res) => {
      errorDetails.value = { ...res.data.hits[0] };
      errorDetails.value["category"] = [];
      const errorStack =
        errorDetails.value.error_handling_stack ||
        errorDetails.value.error_stack;
      console.log(errorStack);
      errorDetails.value.error_stack = errorStack.split("\n");
    })
    .finally(() => isLoading.value.pop());
};
</script>

<style scoped>
.error-viewer-container {
  height: calc(100vh - 57px);
  overflow-y: auto;
}
</style>
