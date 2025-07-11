import pipelines from "@/services/pipelines";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import destinationService from "@/services/alert_destination";


export const usePipelines = () => {
    const store = useStore();
    const $q = useQuasar();

    async function getUsedStreamsList() {
        const org_identifier = store.state.selectedOrganization.identifier;
      try {
        const res = await pipelines.getPipelineStreams(org_identifier);
        return res.data.list;
      } catch (error:any) {
        if(error.response.status != 403){
          $q.notify({
          message: error.response?.data?.message || "Error fetching used streams",
          color: "negative",
          position: "bottom",
          timeout: 2000,
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