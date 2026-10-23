import { computed } from "vue";
import { useStore } from "vuex";

export default function useIsMetaOrg() {
  const store = useStore();

  const isMetaOrg = computed(() => {
    const metaOrg = store.state.zoConfig?.meta_org;
    return !!metaOrg && store.state.selectedOrganization?.identifier === metaOrg;
  });

  return {
    isMetaOrg,
  };
}
