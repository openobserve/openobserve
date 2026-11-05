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
  <ODialog
    :open="open"
    size="sm"
    :title="title"
    :show-close="false"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="confirmLabel"
    primary-button-variant="destructive"
    :primary-button-disabled="!confirmable"
    :primary-button-loading="busy"
    initial-focus="secondary"
    :data-test="
      kind === 'delete' ? 'assistant-history-delete-dialog' : 'assistant-history-clear-all-dialog'
    "
    @update:open="(value) => !value && emit('update:open', false)"
    @click:secondary="emit('update:open', false)"
    @click:primary="confirm"
  >
    <div class="flex flex-col gap-2" data-dd-privacy="mask">
      <OText as="p" class="break-words" data-test="assistant-history-confirm-body">{{
        body
      }}</OText>
      <OText
        v-if="linksLine"
        as="p"
        variant="meta"
        class="break-words"
        data-test="assistant-history-confirm-links"
        >{{ linksLine }}</OText
      >
      <OText
        v-if="kind === 'delete' && running"
        as="p"
        class="break-words"
        data-test="assistant-history-confirm-running"
        >{{ t("assistant.history.delete.running") }}</OText
      >
      <OInput
        v-if="typeToConfirm"
        v-model="typed"
        size="sm"
        :label="t('assistant.history.clearAll.typeToConfirm')"
        autocomplete="off"
        data-test="assistant-history-clear-all-confirm"
        @keydown.enter.prevent="confirmable && confirm()"
      />
    </div>
  </ODialog>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantHistoryConfirmProps {
  kind: "delete" | "clear_all";
  open: boolean;
  mode: "server" | "local";
  org: string;
  orgName: string;
  /** Delete one: the chat, its title and whether it still answers. */
  sid?: Sid | null;
  chatTitle?: string;
  running?: boolean;
  /** Clear all: how many chats go; `null` when the server has more than this browser has read. */
  count?: number | null;
  busy?: boolean;
}

/** From this many chats a clear-all asks the user to type the word. */
export const TYPE_TO_CONFIRM_FROM = 25;
</script>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, ref, watch } from "vue";

import OText from "@/lib/core/Typography/OText.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { chatSharesQuery, mySharesQuery } from "@/services/ai_chat_share.queries";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantHistoryConfirmProps>(), {
  sid: null,
  chatTitle: "",
  running: false,
  count: null,
  busy: false,
});

const emit = defineEmits<{ "update:open": [open: boolean]; confirm: [] }>();

const { t } = useI18nTyped();
const typed = ref("");

const server = computed(() => props.mode === "server");
// The links line resolves inline; the dialog never waits on it.
const chatLinks = useQuery(
  computed(() => ({
    ...chatSharesQuery(props.org, props.sid ?? ""),
    enabled: props.open && server.value && props.kind === "delete" && !!props.sid,
    retry: false,
  })),
);
const myLinks = useQuery(
  computed(() => ({
    ...mySharesQuery(props.org),
    enabled: props.open && server.value && props.kind === "clear_all",
    retry: false,
  })),
);
const links = computed(() => (props.kind === "delete" ? chatLinks : myLinks));
const linkCount = computed(() => links.value.data.value?.length ?? null);
const linksFailed = computed(() => links.value.isError.value);

watch(
  () => props.open,
  (open) => {
    if (open) typed.value = "";
  },
);

const title = computed(() =>
  props.kind === "delete"
    ? t("assistant.history.delete.title", { title: raw(props.chatTitle) })
    : props.count === null
      ? t("assistant.history.clearAll.titleAll", { org: raw(props.orgName) })
      : t("assistant.history.clearAll.title", { count: props.count }, props.count),
);

const body = computed(() => {
  if (props.kind === "delete")
    return server.value
      ? t("assistant.history.delete.bodyServer")
      : t("assistant.history.delete.bodyLocal");
  if (!server.value)
    return t(
      "assistant.history.clearAll.bodyLocal",
      { count: props.count ?? 0, org: raw(props.orgName) },
      props.count ?? 0,
    );
  return t("assistant.history.clearAll.bodyServer", { links: linkCount.value ?? "—" });
});

// A failed count never reads as zero.
const linksLine = computed(() => {
  if (!server.value) return null;
  if (props.kind === "clear_all")
    return linksFailed.value ? t("assistant.history.clearAll.linksUnknown") : null;
  if (linksFailed.value) return t("assistant.history.delete.links.unknown");
  if (linkCount.value === null) return t("assistant.history.delete.links.checking");
  if (linkCount.value === 0) return t("assistant.history.delete.links.none");
  return t("assistant.history.delete.links.count", { count: linkCount.value }, linkCount.value);
});

const typeToConfirm = computed(
  () =>
    props.kind === "clear_all" &&
    (props.count === null ||
      props.count >= TYPE_TO_CONFIRM_FROM ||
      (server.value && (linksFailed.value || (linkCount.value ?? 0) > 0))),
);
const confirmable = computed(
  () =>
    !props.busy &&
    (!typeToConfirm.value ||
      typed.value.trim().toLowerCase() ===
        String(t("assistant.history.clearAll.confirmWord")).toLowerCase()),
);
const confirmLabel = computed(() => {
  if (props.busy) return t("assistant.history.clearAll.deleting");
  if (props.kind === "delete") return t("assistant.history.deleteAction");
  return props.count === null
    ? t("assistant.history.clearAll.confirmAll")
    : t("assistant.history.clearAll.confirm", { count: props.count }, props.count);
});

function confirm(): void {
  if (confirmable.value) emit("confirm");
}
</script>
