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
  <div class="flex flex-col gap-6" data-test="settings-assistant-access-tab">
    <AssistantOrgPolicyForm ref="policy" />
    <AssistantRoleChatAccess ref="roles" />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import AssistantOrgPolicyForm from "./AssistantOrgPolicyForm.vue";
import AssistantRoleChatAccess from "./AssistantRoleChatAccess.vue";

const policy = ref<InstanceType<typeof AssistantOrgPolicyForm> | null>(null);
const roles = ref<InstanceType<typeof AssistantRoleChatAccess> | null>(null);

function refresh() {
  return Promise.all([policy.value?.refresh(), roles.value?.refresh()]);
}

defineExpose({ refresh });
</script>
