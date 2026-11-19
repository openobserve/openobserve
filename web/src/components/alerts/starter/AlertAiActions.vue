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

<!-- The AI pane's footer: Draft, Stop, or answer the assistant's proposal with Create alert or Edit in form. -->
<template>
  <p
    v-if="canApprove && controller.destinations.value.length === 0"
    class="text-status-warning-text m-0 flex min-w-0 items-center gap-1 text-xs"
    data-test="alert-starter-ai-nobody-told"
  >
    <OIcon name="warning-amber" size="xs" class="shrink-0" />
    <OTruncatedText class="min-w-0">{{ t("alertStarter.whoToTell.nobodyTold") }}</OTruncatedText>
  </p>

  <OButton
    v-if="phase === 'idle'"
    variant="primary"
    size="sm"
    icon-left="auto-awesome"
    :disabled="!prompt.trim()"
    data-test="alert-starter-ai-draft"
    @click="ai.start(prompt)"
    >{{ t("alertStarter.ai.draft") }}</OButton
  >
  <OButton
    v-else-if="phase === 'drafting'"
    variant="outline"
    size="sm"
    data-test="alert-starter-ai-stop"
    @click="ai.cancel()"
    >{{ t("alertStarter.ai.stop") }}</OButton
  >
  <template v-else>
    <OButton
      v-if="chatOpens"
      variant="ghost-primary"
      size="sm"
      icon-left="chat"
      data-test="alert-starter-ai-continue-chat"
      @click="continueInChat"
      >{{ t("alertStarter.ai.continueInChat") }}</OButton
    >
    <OButton
      v-if="ai.result.value"
      variant="outline"
      size="sm"
      :disabled="phase === 'approving'"
      data-test="alert-starter-ai-edit-in-form"
      @click="editInForm"
      >{{ t("alertStarter.ai.editInForm") }}</OButton
    >
    <OButton
      v-if="canApprove || phase === 'approving'"
      variant="primary"
      size="sm"
      :loading="phase === 'approving'"
      data-test="alert-starter-ai-create"
      @click="create"
      >{{ t("alertStarter.ai.create") }}</OButton
    >
  </template>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { AlertAiDraft } from "@/components/alerts/starter/useAlertAiDraft";
import { useAlertCreation } from "@/composables/alerts/useAlertCreation";
import useAiChat from "@/composables/useAiChat";
import { useChatHistory } from "@/composables/useChatHistory";
import { approveProposedAlertMutation } from "@/services/alerts.queries";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{ controller: AlertAiDraft; prompt: string }>();
const emit = defineEmits<{ created: []; opened: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const { openAlertCreation } = useAlertCreation();
const { chatHistoryServer } = useAiChat();
const { adoptServerChat } = useChatHistory(
  () => store.state.userInfo?.email ?? "",
  () => store.state.selectedOrganization?.identifier ?? "",
  t,
  chatHistoryServer(),
);

const ai = props.controller.ai;
const org = (): string => store.state.selectedOrganization?.identifier ?? "";
const approveAlert = useMutation(() => approveProposedAlertMutation(org()));

const phase = computed(() => ai.phase.value);
const canApprove = computed(() => phase.value === "ready");
// A paused proposal cannot move to the panel, and the panel opens only conversations stored server-side.
const chatOpens = computed(
  () =>
    !!ai.sessionId.value &&
    (phase.value === "reply" || phase.value === "failed") &&
    chatHistoryServer().enabled(),
);

const create = async () => {
  const name = ai.result.value?.draft.name ?? "";
  try {
    await approveAlert.mutateAsync(() => ai.approve());
  } catch {
    // The pane's failure line says what went wrong.
    return;
  }
  toast({ variant: "success", message: t("alertStarter.ai.created", { name: raw(name) }) });
  emit("created");
};

// Declined first, so the agent is not left paused on a proposal the form now owns.
const editInForm = async () => {
  const prefill = props.controller.prefill();
  if (!prefill) return;
  await ai.decline();
  if (openAlertCreation(prefill, { folder: props.controller.folderId() })) emit("opened");
};

const continueInChat = async () => {
  const sessionId = ai.sessionId.value;
  if (!sessionId) return;
  const chatId = await adoptServerChat(sessionId, ai.prompt.value);
  store.dispatch("setCurrentChatTimestamp", chatId);
  store.dispatch("setIsAiChatEnabled", true);
  store.dispatch("setChatUpdated", true);
  emit("opened");
};
</script>
