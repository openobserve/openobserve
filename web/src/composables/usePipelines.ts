import pipelines from "@/services/pipelines";
import type { TranslateFn } from "@/types/i18n";
import { useStore } from "vuex";
import destinationService from "@/services/alert_destination";
import { toast } from "@/lib/feedback/Toast/useToast";

export const usePipelines = (t: TranslateFn) => {
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
          message: error.response?.data?.message || t("pipeline.errorFetchingUsedStreams"),
        });
      }
      return [];
    }
  }
  const getPipelineDestinations = async () => {
    const destinations = await destinationService.list({
      page_num: 1,
      page_size: 100000,
      sort_by: "name",
      desc: false,
      org_identifier: store.state.selectedOrganization.identifier,
      module: "pipeline",
    });
    return destinations.data.map((dest: any) => {
      return dest.name;
    });
  };
  return {
    getUsedStreamsList,
    getPipelineDestinations,
  };
};

export default usePipelines;
