import { computed } from "vue";
import { useStore } from "vuex";

export default function useIsMetaOrg() {
  console.log("useIsMetaOrg");

  const store = useStore();

  const isMetaOrg = computed(() => {
     return store.state.selectedOrganization.label === store.state.zoConfig.meta_org;
  });

  return {
    isMetaOrg,
  };
}
