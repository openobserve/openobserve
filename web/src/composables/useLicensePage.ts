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

import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";

export const useLicensePage = () => {
  const store = useStore();
  const router = useRouter();
  const { t } = useI18nTyped();

  // The license route redirects away unless the selected org is the meta org, so switch before pushing.
  const goToLicensePage = () => {
    const metaOrgIdentifier = store.state.zoConfig.meta_org;
    const metaOrg = store.state.organizations?.find(
      (org: { identifier: string }) => org.identifier === metaOrgIdentifier,
    );
    if (!metaOrg) {
      toast({ message: t("toastMessages.views.youAreNotAuthorizedToManage"), variant: "error" });
      return;
    }
    store.dispatch("setSelectedOrganization", {
      label: metaOrg.name,
      id: metaOrg.id,
      identifier: metaOrg.identifier,
      user_email: store.state.userInfo.email,
      ingest_threshold: metaOrg.ingest_threshold,
      search_threshold: metaOrg.search_threshold,
    });
    router.push({ name: "license", query: { org_identifier: metaOrgIdentifier } });
  };

  return { goToLicensePage };
};
