import pipelines from "@/services/pipelines";
import { useStore } from "vuex";
import destinationService from "@/services/alert_destination";
import { toast } from "@/lib/feedback/Toast/useToast";


export const usePipelines = () => {
    const store = useStore();

    async function getUsedStreamsList() {
        const org_identifier = store.state.selectedOrganization.identifier;
      try {
        const res = await pipelines.getPipelineStreams(org_identifier);
        return res.data.list;
      } catch (error:any) {
        if(error.response.status != 403){
          toast({
            variant: "error",
            message: error.response?.data?.message || "Error fetching used streams",
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
        return destinations.data.map((dest: any)=>{
          return dest.name;
        });
      }
    return {
        getUsedStreamsList,
        getPipelineDestinations
    }
}

export default usePipelines;