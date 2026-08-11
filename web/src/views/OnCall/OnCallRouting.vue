<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  Route stub for `oncall/routing` (spec §2.10). Registered now because the team
  detail screen drops its Ownership tab in favour of this route; the ownership
  tree, the unrouted queue and the tester are step 12 and land in this file.
-->
<template>
  <OPageLayout
    data-test="oncall-routing-page"
    :title="t('oncall.routingTitle')"
    :subtitle="t('oncall.routingSubtitle')"
    icon="account-tree"
  >
    <OEmptyState
      size="hero"
      preset="no-oncall-rules"
      data-test="oncall-routing-empty"
      @action="goToTeams"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

function goToTeams() {
  router.push({
    name: "onCallTeams",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
}
</script>
