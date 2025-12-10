import { ref, markRaw, Ref } from "vue";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import { useStore } from "vuex";

import { getUserInfo, getImageURL, useLocalOrganization, invalidateLoginData, useLocalCurrentUser, useLocalUserInfo } from "@/utils/zincutils";
import organizationService from "@/services/organizations";
import billingService from "@/services/billings";
import userService from "@/services/users";
import PipelineIcon from "@/components/icons/PipelineIcon.vue";
import { Network } from "lucide-vue-next";

const MainLayoutCloudMixin = {
  setup() {
    const router = useRouter();
    const store = useStore();
    const orgOptions = ref([{ label: Number, value: String }]);
    const selectedOrg: Ref<string> = ref("");

    /**
     * Add function & organization menu in left navigation
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

      if(!store.state.zoConfig?.custom_hide_menus
          ?.split(",")
          ?.includes("billings")
      ) {
        linksList.value.splice(10, 0, {
          title: t("menu.billings"),
          icon: "payments",
          link: "/billings",
        });
      }

      return linksList.value;
    };

    /**
     * Get default organization
     */
    const getDefaultOrganization = async (store: any) => {
      await organizationService
        .list(0, 100000, "id", false, "")
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
        })
        .catch((error) => {
          if (error.status === 403) signout();
        });
    };

    /**
     * Get refresh token
     */
    const getRefreshToken = () => {
      userService
        .getRefreshToken()
        .then((res) => {
          const sessionUserInfo: any = getUserInfo(
            "#id_token=" + res.data.data.id_token
          );

          const userInfo = sessionUserInfo !== null ? sessionUserInfo : null;
          if (userInfo !== null) {
            store.dispatch("login", {
              loginState: true,
              userInfo: userInfo,
            });

            store.dispatch("setUserInfo", userInfo);
          }
        })
        .catch((e) => {
          console.log("Error while fetching refresh token:", e);
        });
    };



    const signout = async () => {
      if (config.isEnterprise == "true") {
        invalidateLoginData();
      }
      store.dispatch("logout");

      useLocalCurrentUser("", true);
      useLocalUserInfo("", true);

      router.push("/logout");
    };

    return {
      store,
      orgOptions,
      getImageURL,
      leftNavigationLinks,
      getRefreshToken,
      getDefaultOrganization,
    };
  },
};

export default MainLayoutCloudMixin;
