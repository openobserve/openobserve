import { computed } from "vue";
import { useStore } from "vuex";

export default function useIsMetaOrg() {

  const store = useStore();

  const isMetaOrg = computed(() => {
     return (store.state.selectedOrganization.identifier === store.state.zoConfig.meta_org);
  });

  return {
    isMetaOrg,
  };
}
