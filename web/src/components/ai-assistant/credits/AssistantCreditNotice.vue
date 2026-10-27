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
  <div ref="root" class="@container min-w-0">
    <OBanner
      variant="warning"
      dense
      inline-actions
      :role="threshold === 70 ? 'status' : 'alert'"
      :content="line"
      data-test="assistant-credit-notice"
      :data-threshold="threshold"
    >
      <template #actions>
        <div class="flex shrink-0 items-center gap-1">
          <AssistantCreditManage
            v-if="canManage"
            :org="org"
            variant="outline"
            id-prefix="assistant-credit-notice"
            @manage="emit('manage')"
          />
          <AssistantAskAdminPopover v-else kind="credits" :org="org">
            <template #trigger>
              <OButton
                variant="outline"
                size="sm"
                :class="TOUCH_TARGET_CLASS"
                data-test="assistant-credit-notice-ask-admin"
                @click="emit('ask-admin')"
              >
                {{ t("assistant.outcome.actions.askAdmin") }}
              </OButton>
            </template>
          </AssistantAskAdminPopover>
          <AssistantIconButton
            :label="t('assistant.credits.noticeDismiss')"
            :icon="assistantGlyph.close"
            data-test="assistant-credit-notice-dismiss"
            @click="emit('dismiss')"
          />
        </div>
      </template>
    </OBanner>
  </div>
</template>

<script lang="ts">
export interface AssistantCreditNoticeProps {
  threshold: 70 | 90;
  canManage: boolean;
  resetsAt?: number;
  /** The org the manage link and the admin request name. */
  org: string;
}

export interface AssistantCreditNoticeEmits {
  (e: "dismiss"): void;
  (e: "manage"): void;
  (e: "ask-admin"): void;
}
</script>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { registerEscapeRung } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatOrgDay } from "@/utils/formatters";

import AssistantCreditManage from "./AssistantCreditManage.vue";

// The request flow reads the org's members, so it loads only for a member's notice.
const AssistantAskAdminPopover = defineAsyncComponent(
  () => import("@/components/ai-assistant/gate/AssistantAskAdminPopover.vue"),
);

const props = withDefaults(defineProps<AssistantCreditNoticeProps>(), { resetsAt: undefined });
const emit = defineEmits<AssistantCreditNoticeEmits>();

const { t } = useI18nTyped();
const root = ref<HTMLElement | null>(null);

const line = computed(() =>
  props.resetsAt === undefined
    ? t("assistant.credits.notice", { percent: props.threshold })
    : t("assistant.credits.noticeResets", {
        percent: props.threshold,
        date: raw(formatOrgDay(props.resetsAt)),
      }),
);

let off: (() => void) | null = null;

// Escape with focus inside closes only the notice, before the ladder reaches the panel's close.
onMounted(() => {
  off = registerEscapeRung("b", (event) => {
    const target = event.target instanceof Node ? event.target : document.activeElement;
    if (!target || !root.value?.contains(target)) return false;
    emit("dismiss");
    return true;
  });
});
onBeforeUnmount(() => off?.());
</script>
