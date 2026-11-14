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
  <AssistantTimePrefix
    v-model:open="timeOpen"
    :window="context.window.value"
    :page-window="pageWindow"
    :timezone="timezone"
    :disabled="disabled"
    fixed
    align="start"
    @change="applyTime"
  />
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantSessionTimeProps {
  sid: Sid | null;
  disabled?: boolean;
}
</script>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useStore } from "vuex";

import { composerTimeOpenKey } from "@/components/ai-assistant/composer/composerUi";
import {
  timeWindowOf,
  useAssistantContext,
  useAssistantPlacement,
  useAssistantStore,
  type ComposerState,
} from "@/composables/assistant";
import { trackAssistant } from "@/services/assistantAnalytics";

import AssistantTimePrefix from "./AssistantTimePrefix.vue";

const props = withDefaults(defineProps<AssistantSessionTimeProps>(), { disabled: false });

const store = useAssistantStore();
const vuex = useStore();
const context = useAssistantContext(() => props.sid, { store });
const placement = useAssistantPlacement(store);
const timeOpen = inject(composerTimeOpenKey, ref(false));
const timezone = computed<string>(() => vuex.state.timezone || "UTC");

// The page's own window, whatever the draft overrides it with; a page with no range offers no "Page time".
const pageWindow = computed(() => {
  const own = timeWindowOf(context.page.value, null);
  return own.source === "page" ? own : null;
});

// A time picked before the first keystroke starts the chat, as a pick of an agent does.
function applyTime(range: ComposerState["timeOverride"]): void {
  const sid =
    (props.sid && store.state.sessions[props.sid]?.userOrgKey === store.state.userOrgKey
      ? props.sid
      : null) ??
    (store.state.ready
      ? store.createSession({
          origin: {
            entryKind: "empty_state",
            objectKind: "none",
            container: placement.container.value ?? "sidebar",
          },
        })
      : null);
  if (!sid) return;
  store.setTimeOverride(sid, range);
  trackAssistant("ai_context_changed", {
    action: "swap_time",
    kind: context.timeChip.value.kind,
    count: context.timeChip.value.count ?? 1,
    bytes: 0,
  });
}
</script>
