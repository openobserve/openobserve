import { ref, watch} from "vue";

export const useSearchApi = (dashboardData: any, dateTime: any) => {
  const isLoading = ref(false);
  const data = ref();

  const loadData = async () => {
    isLoading.value = true;
    //single or multiple API call
    //wait for all response 
    //merge the dashboard data and set data ref
    if(dashboardData.data.length > 0){
        console.log(dashboardData.data,"dashboardData.data");
        
      data.value = dashboardData.data;
    }
    isLoading.value = false;
  }
  watch([dashboardData, dateTime], () => {
    loadData();
  });
  return {
    isLoading,
    data,
    loadData,
  };
}
