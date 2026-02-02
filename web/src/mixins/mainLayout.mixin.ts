import { markRaw, onActivated, onMounted, ref, Ref } from "vue";
import { useStore } from "vuex";
import organizationService from "@/services/organizations";
import { getImageURL, useLocalOrganization } from "@/utils/zincutils";
import PipelineIcon from "@/components/icons/PipelineIcon.vue";
import { Network } from "lucide-vue-next";

const MainLayoutOpenSourceMixin = {
  setup() {
    const store: any = useStore();
    const orgOptions: any = ref([{ label: Number, value: String }]);
    const selectedOrg: Ref<string> = ref("");

    /**
     * Add function menu in left navigation
     * @param linksList
     * @returns linksList.value
     */
    const leftNavigationLinks = (linksList: any, t: any) => {
      linksList.value.splice(5, 0, {
        title: t("menu.pipeline"),
        iconComponent: markRaw(Network),
        link: "/pipeline",
        name: "pipeline",
      });

      return linksList.value;
    };

    /**
     * Get default organization
     */
    const getDefaultOrganization = async () => {
      await organizationService
        .os_list(0, 100000, "id", false, "", "default")
        .then((res: any) => {
          store.dispatch("setOrganizations", res.data.data);
          const localOrg: any = useLocalOrganization();
          orgOptions.value = res.data.data.map(
            (data: {
              id: any;
              name: any;
              type: any;
              identifier: any;
              UserObj: any;
            }) => {
              const optiondata: any = {
                label: data.name,
                id: data.id,
                identifier: data.identifier,
                user_email: store.state.userInfo.email,
              };

              if (
                (Object.keys(selectedOrg.value).length == 0 &&
                  (data.type == "default" || data.id == "1") &&
                  store.state.userInfo.email == data.UserObj.email) ||
                res.data.data.length == 1
              ) {
                selectedOrg.value = localOrg.value && Object.keys(localOrg.value).length > 0
                  ? localOrg.value
                  : optiondata;
                useLocalOrganization(selectedOrg.value);
                store.dispatch("setSelectedOrganization", selectedOrg.value);
              }
              return optiondata;
            },
          );
        });
    };

    onActivated(() => {
      getDefaultOrganization();
    });

    onMounted(() => {
      getDefaultOrganization();
    });

    return {
      leftNavigationLinks,
      getDefaultOrganization,
    };
  },
};

export default MainLayoutOpenSourceMixin;
