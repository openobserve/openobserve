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

<template>
  <div class="flex flex-col gap-3 p-6" data-test="bulk-review-harness">
    <div class="flex flex-wrap gap-2">
      <OButton
        v-for="scenario in SCENARIOS"
        :key="scenario"
        variant="outline"
        size="sm"
        :data-test="`bulk-review-harness-open-${scenario}`"
        @click="open(scenario)"
      >
        {{ raw(scenario) }}
      </OButton>
    </div>
    <BulkReviewDrawer />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import commonService from "@/services/common";
import { raw } from "@/types/i18n";
import BulkReviewDrawer from "./BulkReviewDrawer.vue";
import { harnessRequest, type FolderIds } from "./bulkFixtures";
import { openBulkReview, setFolderRightsSource } from "./useBulkReview";

const SCENARIOS = ["m12", "one", "many", "source", "fields"];
const route = useRoute();
const store = useStore();

const folderIds = async (org: string): Promise<FolderIds> => {
  const res = await commonService.list_Folders(org, "alerts", { skipAccessToast: true });
  return Object.fromEntries((res.data?.list ?? []).map((f: any) => [f.name, f.folderId]));
};

// `?locked=payments` stands in for the per-folder write rights the server does not serve yet.
const lockedNames = () =>
  String(route.query.locked ?? "")
    .split(",")
    .filter(Boolean);

// `?ids=payments:123` names folders the signed-in user cannot list, so a reader's review still targets them.
const namedIds = (): FolderIds =>
  Object.fromEntries(
    String(route.query.ids ?? "")
      .split(",")
      .filter((pair) => pair.includes(":"))
      .map((pair) => pair.split(":")),
  );

const open = async (scenario: string) => {
  const org = String(store.state.selectedOrganization?.identifier ?? "");
  const ids = { ...(await folderIds(org).catch(() => ({}) as FolderIds)), ...namedIds() };
  const locked = lockedNames();
  setFolderRightsSource(
    locked.length
      ? async () => Object.fromEntries(locked.map((name) => [ids[name] ?? name, false]))
      : null,
  );
  openBulkReview(harnessRequest(scenario, ids));
};

onBeforeUnmount(() => setFolderRightsSource(null));
</script>
