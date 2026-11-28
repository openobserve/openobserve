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
<script setup lang="ts">
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

// Packs have no request of their own, so this asks for the same access the assistant's own gate asks for.
defineOptions({ inheritAttrs: false });
withDefaults(defineProps<{ org: string; size?: "sm" | "sm-action" }>(), { size: "sm" });

const { t } = useI18nTyped();
</script>

<template>
  <AssistantAskAdminPopover kind="access" :org="org">
    <template #trigger>
      <OButton variant="outline" :size="size" icon-left="lock" class="shrink-0" v-bind="$attrs">
        {{ t("assistant.gate.noPermission.askAdmin") }}
      </OButton>
    </template>
  </AssistantAskAdminPopover>
</template>
