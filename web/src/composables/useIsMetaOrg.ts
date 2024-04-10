import { computed } from "vue";
import { useStore } from "vuex";

export default function useIsMetaOrg() {
  console.log("useIsMetaOrg");

  const store = useStore();

  const isMetaOrg = computed(() => {
    console.log("isMetaOrg", store.state.selectedOrganization.label);

    return store.state.selectedOrganization.label === "default";
  });

  return {
    isMetaOrg,
  };
}
