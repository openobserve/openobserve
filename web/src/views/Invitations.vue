<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="invitations-page tw:h-[100vh-128px] ">
    <InvitationList
      :userEmail="userEmail"
      @invitations-processed="handleInvitationsProcessed"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import InvitationList from "@/components/iam/users/InvitationList.vue";

const store = useStore();
const router = useRouter();

const userEmail = computed(() => store.state.userInfo?.email || "");

const handleInvitationsProcessed = (data: any) => {
  if (data.accepted && data.organization) {
    router.push({
      name: "users",
      query: {
        org_identifier: data.organization.identifier,
      },
    });
  }
};
</script>

<style scoped>
.invitations-page {
  padding: 0;
}
</style>