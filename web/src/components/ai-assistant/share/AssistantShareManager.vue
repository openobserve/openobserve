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
  <ODrawer
    v-model:open="open"
    side="right"
    size="lg"
    :width="mdUp ? undefined : 100"
    :title="t('assistant.share.managerTitle')"
    data-dd-privacy="mask"
    data-test="assistant-share-manager"
  >
    <div class="flex min-h-0 flex-col gap-4" data-dd-privacy="mask">
      <OToggleGroup
        v-model="scope"
        type="single"
        class="self-start"
        :label="t('assistant.share.scopeLabel')"
        data-test="assistant-share-manager-scope"
      >
        <OToggleGroupItem
          v-if="sid"
          value="chat"
          size="sm"
          data-test="assistant-share-manager-scope-chat"
          >{{ t("assistant.share.scope.chat") }}</OToggleGroupItem
        >
        <OToggleGroupItem value="mine" size="sm" data-test="assistant-share-manager-scope-mine">{{
          t("assistant.share.scope.mine")
        }}</OToggleGroupItem>
        <OToggleGroupItem
          v-if="capability.isAdmin"
          value="all"
          size="sm"
          data-test="assistant-share-manager-scope-all"
          >{{ t("assistant.share.scope.all") }}</OToggleGroupItem
        >
      </OToggleGroup>

      <OCollapsible
        v-if="sid && scope === 'chat'"
        v-model="newOpen"
        :label="t('assistant.share.newLink')"
        data-test="assistant-share-manager-new"
      >
        <AssistantShareSettings
          :key="formKey"
          :org="org"
          :sid="sid"
          :share="null"
          :running="running(sid)"
          :public-links="capability.publicLinks"
          :public-max-expiry-days="capability.publicMaxExpiryDays"
          :redact-attachments="redactAttachments"
          :has-attachments="attachments"
          :link-count="0"
          @created="onCreated"
          @announce="announce"
        />
      </OCollapsible>

      <div
        v-if="read.isPending.value"
        class="flex flex-col gap-3"
        data-test="assistant-share-manager-loading"
      >
        <OSkeleton v-for="n in 3" :key="n" type="text" class="h-12 w-full" />
      </div>
      <template v-else-if="read.error.value">
        <AssistantGateState
          v-if="forbidden && scope !== 'all'"
          reason="no_share_read"
          size="inline"
          :is-admin="capability.isAdmin"
          :context="{ org, feature: 'share' }"
        />
        <OText
          v-else-if="forbidden"
          variant="body"
          data-test="assistant-share-manager-admin-only"
          >{{ t("assistant.share.allOrgAdminOnly") }}</OText
        >
        <OEmptyState
          v-else
          size="block"
          :backdrop="false"
          :title="offline ? t('assistant.share.offline') : t('assistant.share.loadFailed')"
          data-test="assistant-share-manager-error"
        >
          <template #actions>
            <OButton
              variant="outline"
              size="sm"
              class="max-md:min-h-11"
              data-test="assistant-share-manager-retry"
              @click="read.refetch()"
              >{{ t("common.retry") }}</OButton
            >
          </template>
          <template v-if="!offline && error" #description>
            <AssistantErrorDetails
              :error="error"
              :at="read.errorUpdatedAt.value"
              :is-admin="capability.isAdmin"
            />
          </template>
        </OEmptyState>
      </template>
      <OText v-else-if="!rows.length" variant="body" data-test="assistant-share-manager-empty">{{
        t(emptyKey)
      }}</OText>
      <ul v-else class="flex flex-col" data-test="assistant-share-manager-list">
        <AssistantShareRow
          v-for="(share, index) in rows"
          :key="share.id"
          :ref="(el) => setRow(index, el)"
          :org="org"
          :share="share"
          :running="running(share.session_id)"
          :out-of-date="outOfDate(share)"
          :public-max-expiry-days="capability.publicMaxExpiryDays"
          @open-chat="openChat"
          @announce="announce"
        />
      </ul>
    </div>
    <AssistantStatusRegion ref="region" data-test="assistant-share-manager-status" />
  </ODrawer>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export type ShareManagerScope = "chat" | "mine" | "all";

export interface AssistantShareManagerProps {
  /** Opened from a thread; offers This chat and the New link form. */
  sid?: Sid | null;
  initialScope: ShareManagerScope;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import AssistantErrorDetails from "@/components/ai-assistant/common/AssistantErrorDetails.vue";
import AssistantGateState from "@/components/ai-assistant/gate/AssistantGateState.vue";
import AssistantStatusRegion from "@/components/ai-assistant/shell/AssistantStatusRegion.vue";
import {
  toAssistantError,
  useAssistantCapability,
  useAssistantStore,
} from "@/composables/assistant";
import { isTerminal } from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { ShareView } from "@/services/ai_chat_share";
import { allSharesQuery, chatSharesQuery, mySharesQuery } from "@/services/ai_chat_share.queries";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

import AssistantShareRow from "./AssistantShareRow.vue";
import AssistantShareSettings from "./AssistantShareSettings.vue";
import { checkAttachments, knownAttachments } from "./chatAttachments";
import { canRedactAttachments, isOutOfDate, statusOfError } from "./chatShare";

const EMPTY_KEYS: Record<ShareManagerScope, I18nKey> = {
  chat: "assistant.share.empty.chat",
  mine: "assistant.share.empty.mine",
  all: "assistant.share.empty.all",
};

const props = withDefaults(defineProps<AssistantShareManagerProps>(), { sid: null });

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();
const vuex = useStore();
const store = useAssistantStore();
const capability = useAssistantCapability();
const { mdUp } = useBreakpoint();

const scope = ref<ShareManagerScope>(props.initialScope);
const newOpen = ref(false);
const formKey = ref(0);
const region = ref<InstanceType<typeof AssistantStatusRegion> | null>(null);
const rowRefs: (ComponentPublicInstance | null)[] = [];
let focusNew: string | null = null;

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const redactAttachments = computed(() => canRedactAttachments(vuex.state.zoConfig));
const known = computed(() =>
  props.sid
    ? knownAttachments(org.value, props.sid, store.state.sessions[props.sid]?.messages)
    : "no",
);
// Unknown counts as present until the stored chat has been read.
const attachments = computed(() => known.value !== "no");

const read = useQuery(() => {
  const enabled = open.value && !!org.value;
  if (scope.value === "chat" && props.sid) {
    return Object.assign(chatSharesQuery(org.value, props.sid), { enabled });
  }
  if (scope.value === "all") return Object.assign(allSharesQuery(org.value), { enabled });
  return Object.assign(mySharesQuery(org.value), { enabled });
});

const rows = computed<ShareView[]>(() => read.data.value ?? []);
const forbidden = computed(() => statusOfError(read.error.value) === 403);
const offline = computed(() => typeof navigator !== "undefined" && navigator.onLine === false);
const error = computed(() =>
  read.error.value ? toAssistantError(read.error.value, { phase: "read" }) : null,
);
const emptyKey = computed(() => EMPTY_KEYS[scope.value]);

watch(
  () => [open.value, props.initialScope] as const,
  ([isOpen]) => {
    if (isOpen)
      scope.value = props.sid || props.initialScope !== "chat" ? props.initialScope : "mine";
  },
  { immediate: true },
);

watch(
  () => open.value && !redactAttachments.value && known.value === "unknown",
  (check) => {
    if (check && props.sid) void checkAttachments(org.value, props.sid).catch(() => undefined);
  },
  { immediate: true },
);

// Opening lands on the first row's title, and a link just created lands on its own row.
watch(
  () => [open.value, rows.value] as const,
  async ([isOpen, list]) => {
    if (!isOpen || !list.length) return;
    await nextTick();
    const index = focusNew
      ? Math.max(
          0,
          list.findIndex((share) => share.id === focusNew),
        )
      : 0;
    if (focusNew || document.activeElement === document.body || !document.activeElement) {
      (rowRefs[index] as unknown as { focusTitle?: () => void } | null)?.focusTitle?.();
    }
    focusNew = null;
  },
);

function setRow(index: number, el: Element | ComponentPublicInstance | null): void {
  rowRefs[index] = el && "$el" in el ? el : null;
}

function running(sid: string | null | undefined): boolean {
  const turn = sid ? store.state.sessions[sid]?.turn : undefined;
  return !!turn && turn.state !== "idle" && !isTerminal(turn);
}

function outOfDate(share: ShareView): boolean {
  const session = store.state.sessions[share.session_id];
  return isOutOfDate(share, session?.record.cachedLastSeq ?? session?.turnMeta.lastSeq ?? null);
}

function onCreated(share: ShareView, copied: boolean): void {
  focusNew = share.id;
  newOpen.value = false;
  formKey.value += 1;
  announce(copied ? "assistant.share.createdCopied" : "assistant.share.created");
}

async function openChat(sessionId: string): Promise<void> {
  try {
    await store.openSession({ sid: sessionId }, { focus: true });
    open.value = false;
  } catch {
    toast({ variant: "error", message: t("assistant.share.openFailed") });
  }
}

function announce(key: I18nKey): void {
  region.value?.announce(t(key));
}
</script>
