import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import organizationService from "../../services/organizations";

const MainLayoutOpenSourceMixin = {
  setup() {
    const store: any = useStore();
    const { t } = useI18n();

    const leftNavigationLinks = (linksList: any) => {
      linksList.value.splice(5, 0, {
        title: t("menu.function"),
        icon: "transform",
        link: "/functions",
      });

      return linksList.value;
    };

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
      t,
      leftNavigationLinks,
      getDefaultOrganization,
    };
  },
};

export default MainLayoutOpenSourceMixin;
