// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { ref } from "vue";
import organizationsService from "../services/organizations";
import { useLocalOrganization, getPath } from "./zincutils";
import { isSameOriginRedirect } from "@/utils/safeUrl";

const selectedOrg = ref("");
const orgOptions = ref([{ label: Number, value: String }]);

export const getDefaultOrganization = async (userInfo: any, org_identifier: any) => {
  await organizationsService
    .os_list(0, 100000, "id", false, "", org_identifier)
    .then((res: any) => {
      const localOrg: any = useLocalOrganization();
      if (localOrg.value != null && localOrg.value.user_email !== userInfo.email) {
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
          note: string;
        }) => {
          const optiondata: any = {
            label: data.name,
            id: data.id,
            type: data.org_type,
            identifier: data.identifier,
            user_email: userInfo.email,
            ingest_threshold: data.ingest_threshold,
            search_threshold: data.search_threshold,
            note: data.note,
          };

          if (
            ((selectedOrg.value == "" || selectedOrg.value == undefined) &&
              data.org_type == "default" &&
              userInfo.email == data.user_obj.email) ||
            res.data.data.length == 1
          ) {
            selectedOrg.value = localOrg.value ? localOrg.value : optiondata;
            useLocalOrganization(selectedOrg.value);
            //   $store.dispatch("setSelectedOrganization", selectedOrg.value);
          }
          return optiondata;
        },
      );
      return res.data.data;
    });
};

export const redirectUser = (redirectURI: string | null) => {
  const path = getPath();
  // `redirectURI` comes from the `?short_url=` query param (router/index.ts),
  // so it is attacker-controllable. The previous check was
  // `redirectURI.includes("http")` — a substring test that happily matched
  // `https://evil.com/` and sent the user off-site immediately AFTER they
  // authenticated. Anything not on this origin falls back to the home path.
  if (redirectURI != null && redirectURI != "") {
    if (!isSameOriginRedirect(redirectURI)) {
      // Off-origin: refuse it and go home instead.
      window.location.replace(path);
    } else if (redirectURI.startsWith("/")) {
      // Relative path — keep using `replace` so the login page does not stay
      // in history (unchanged from the original behaviour).
      window.location.replace(redirectURI);
    } else {
      window.location.href = redirectURI;
    }
  } else {
    // $router.push({ path: "/" });
    window.location.replace(path);
  }
};

export const logsErrorMessage = (code: number) => {
  const messages: any = {
    10001: "ServerInternalError",
    20001: "SearchSQLNotValid",
    20002: "SearchStreamNotFound",
    20003: "FullTextSearchFieldNotFound",
    20004: "SearchFieldNotFound",
    20005: "SearchFunctionNotDefined",
    20006: "SearchParquetFileNotFound",
    20007: "SearchFieldHasNoCompatibleDataType",
    20008: "SearchSQLExecuteError",
    20009: "SearchSQLCancelled",
  };

  if (messages[code] != undefined) {
    return "message." + messages[code];
  } else {
    return "";
  }
};
