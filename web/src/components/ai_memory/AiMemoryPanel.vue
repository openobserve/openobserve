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
  <OPopover side="bottom" align="end" content-class="w-[28rem] max-h-[70vh] overflow-auto p-3">
    <template #trigger>
      <OButton
        variant="ghost"
        size="icon-sm"
        data-test="ai-memory-panel-btn"
        :aria-label="t('aiMemory.header')"
      >
        <OIcon name="psychology" size="sm" />
      </OButton>
    </template>
    <div data-test="ai-memory-panel">
      <AiMemoryEditor :target="{ scope: 'org' }" :title="t('aiMemory.orgMemory')" readonly />
      <router-link
        v-if="hasPage"
        :to="{ name: 'aiMemory', query: { org_identifier: org } }"
        class="text-primary mb-4 block text-xs"
        data-test="ai-memory-panel-link"
      >
        {{ t("aiMemory.openPage") }}
      </router-link>
      <AiMemoryEditor :target="{ scope: 'user' }" :title="t('aiMemory.myNotes')" />
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { useI18nTyped } from "@/types/i18n";
import AiMemoryEditor from "./AiMemoryEditor.vue";

const { t } = useI18nTyped();
const store = useStore();
const org = computed(() => store.state.selectedOrganization?.identifier);
// The page is registered only where its feature is offered (`useManagementRoutes`).
const hasPage = !!getCurrentInstance()?.proxy?.$router?.hasRoute("aiMemory");
</script>
