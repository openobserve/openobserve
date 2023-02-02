import { ref } from "vue";
import organizationsService from "../services/organizations";
import { useLocalOrganization } from "./zincutils";

const selectedOrg = ref("");
const orgOptions = ref([{ label: Number, value: String }]);
export const getDefaultOrganization = async (userInfo:any, org_identifier: any) => {
  console.log(userInfo);
  await organizationsService.os_list(0, 1000, "id", false, "", org_identifier).then((res: any) => {
    const localOrg: any = useLocalOrganization();
    if (
      localOrg.value != null &&
      localOrg.value.user_email !== userInfo.email
    ) {
      localOrg.value = null;
      useLocalOrganization("");
    }

    orgOptions.value = res.data.data.map(
      (data: {
        id: any;
        name: any;
        org_type: any;
        identifier: any;
        user_obj: any;
        ingest_threshold: number;
        search_threshold: number;
      }) => {
        const optiondata: any = {
          label: data.name,
          id: data.id,
          type: data.org_type,
          identifier: data.identifier,
          user_email: userInfo.email,
          ingest_threshold: data.ingest_threshold,
          search_threshold: data.search_threshold,
        };

        if (
          (selectedOrg.value == "" &&
            data.org_type == "default" &&
            userInfo.email == data.user_obj.email) ||
          res.data.data.length == 1
        ) {
            selectedOrg.value = localOrg.value ? localOrg.value : optiondata;
            useLocalOrganization(selectedOrg.value);
        //   $store.dispatch("setSelectedOrganization", selectedOrg.value);
        }
        return optiondata;
      }
    );

    return res.data.data;
  });
};

export const redirectUser = (redirectURI: string | null) => {
  if (redirectURI != null && redirectURI != "") {
    // $router.push({ path: redirectURI });
    window.location.replace(window.location.origin + redirectURI);
  } else {
    // $router.push({ path: "/" });
    window.location.replace(window.location.origin);
  }
};
