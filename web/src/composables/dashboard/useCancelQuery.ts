import { ref } from "vue";
import useNotifications from "@/composables/useNotifications";
import queryService from "../../services/search";
import { useStore } from "vuex";

const useCancelQuery = () => {
  const { showPositiveNotification, showErrorNotification } =
    useNotifications();
  const traceIdRef: any = ref([]);
  const store = useStore();

  const searchRequestTraceIds = (data: any) => {
    traceIdRef.value = Array.isArray(data) ? data : [data];
  };

  const cancelQuery = () => {
    window.dispatchEvent(new Event("cancelQuery"));

    const traceIdArray = Array.isArray(traceIdRef.value)
      ? traceIdRef.value
      : [];

    if (traceIdArray.length === 0) {
      console.error("No trace IDs to cancel");
      return;
    }

    const tracesIdsCopy = [...traceIdArray];

    queryService
      .delete_running_queries(
        store.state.selectedOrganization.identifier,
        traceIdArray,
      )
      .then((res) => {
        const isCancelled = res.data.some((item: any) => item.is_success);

        if (isCancelled) {
          showPositiveNotification("Running query cancelled successfully", {
            timeout: 3000,
          });
        }
      })
      .catch((error) => {
        console.error("delete running queries error", error);
        showErrorNotification(
          error.response?.data?.message || "Failed to cancel running query",
          { timeout: 3000 },
        );
      })
      .finally(() => {
        traceIdRef.value = traceIdRef.value.filter(
          (id: any) => !tracesIdsCopy.includes(id),
        );
      });
  };

  return {
    traceIdRef,
    searchRequestTraceIds,
    cancelQuery,
  };
};

export default useCancelQuery;
