import pipelines from "@/services/pipelines";
import { useStore } from "vuex";
import { toast } from "@/lib/feedback/Toast/useToast";
import { destinationsQuery } from "@/services/alert_destination";

export const usePipelines = () => {
  const store = useStore();

  async function getUsedStreamsList() {
    const org_identifier = store.state.selectedOrganization.identifier;
    try {
      const res = await pipelines.getPipelineStreams(org_identifier);
      return res.data.list;
    } catch (error: any) {
      if (error.response.status != 403) {
        toast({
          variant: "error",
          message: error.response?.data?.message || "Error fetching used streams",
        });
      }
      return [];
    }
  }
  const getPipelineDestinations = async () => {
    const destinations = await destinationsQuery.get(
      store.state.selectedOrganization.identifier,
      "pipeline",
    );
    return destinations.map((dest: any) => dest.name);
  };
  return {
    getUsedStreamsList,
    getPipelineDestinations,
  };
};

export default usePipelines;
