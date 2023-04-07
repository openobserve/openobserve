import { useStore } from "vuex";
import organizationService from "@/services/organizations";

const MainLayoutOpenSourceMixin = {
  setup() {
    const store: any = useStore();

    /**
     * Add function menu in left navigation
     * @param linksList
     * @returns linksList.value
     */
    const leftNavigationLinks = (linksList: any, t: any) => {
      linksList.value.splice(5, 0, {
        title: t("menu.function"),
        icon: "transform",
        link: "/functions",
      });

      return linksList.value;
    };

    /**
     * Get default organization
     */
    const getDefaultOrganization = async () => {
      await organizationService
        .os_list(
          0,
          1000,
          "id",
          false,
          "",
          store.state.selectedOrganization.identifier
        )
        .then((res: any) => {
          store.dispatch("setOrganizations", res.data.data);
        });
    };

    getDefaultOrganization();

    return {
      leftNavigationLinks,
      getDefaultOrganization,
    };
  },
};

export default MainLayoutOpenSourceMixin;
