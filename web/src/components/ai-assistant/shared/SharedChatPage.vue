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
  <div
    class="bg-surface-base flex min-h-0 flex-col overflow-y-auto"
    :class="isPublic ? 'h-screen' : 'h-full'"
    data-test="assistant-shared-page"
    :data-variant="variant"
  >
    <component
      :is="isPublic ? 'main' : 'section'"
      class="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-4 px-4 py-6 max-md:px-3 max-md:py-4"
    >
      <SharedChatState
        v-if="pageState !== 'ready'"
        :state="pageState"
        :variant="variant"
        :org="org"
        :is-admin="isAdmin"
        :signed-in="signedIn"
        :error="assistantError"
        :error-at="chatQuery.errorUpdatedAt.value"
        @retry="reload"
        @go-to-chats="goToChats"
      />
      <template v-else-if="chat">
        <SharedChatHeader
          :variant="variant"
          :chat="chat"
          :share="{ mode: chat.mode, visibility: variant === 'public' ? 'public' : 'org' }"
          :viewer="viewer"
          :polling="poll.state.value"
          :can-continue="canContinue"
          :timezone="timezone"
          @open-mine="openMine"
          @copy-markdown="copyMarkdown"
        >
          <template #continue>
            <SharedChatContinue
              :token="token"
              :org="continueOrg"
              :chat="chat"
              :user-org-key="userOrgKey"
              :reread="reread"
            />
          </template>
        </SharedChatHeader>
        <SharedChatNotices
          :chat="chat"
          :polling="poll.state.value"
          :timezone="timezone"
          @retry="reload"
        />
        <div
          v-if="chat.truncated"
          class="flex items-center gap-2"
          role="separator"
          data-test="assistant-shared-truncated-divider"
        >
          <span class="border-border-default flex-1 border-t" />
          <OText variant="meta">{{ t("assistant.shared.truncatedDivider") }}</OText>
          <span class="border-border-default flex-1 border-t" />
        </div>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-dd-privacy="mask">
          <AssistantTranscript
            readonly
            :messages="messages"
            :openable="variant === 'org'"
            density="roomy"
          />
        </div>
      </template>
    </component>
    <AssistantStatusRegion ref="region" data-test="assistant-shared-status" />
  </div>
</template>

<script lang="ts">
export interface SharedChatPageProps {
  token: string;
  /** Unauthenticated route: reads the public endpoint, no `/config`, no assistant runtime. */
  isPublic?: boolean;
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import config from "@/aws-exports";
import { statusOfError } from "@/components/ai-assistant/share/chatShare";
import { getDecodedUserInfo } from "@/utils/auth";
import AssistantStatusRegion from "@/components/ai-assistant/shell/AssistantStatusRegion.vue";
import AssistantTranscript from "@/components/ai-assistant/transcript/AssistantTranscript.vue";
import { runtimeHandle, type AssistantError } from "@/composables/assistant/pure";
import OText from "@/lib/core/Typography/OText.vue";
import {
  mySharesQuery,
  publicSharedChatQuery,
  sharedChatQuery,
} from "@/services/ai_chat_share.queries";
import assistant from "@/services/assistant";
import organizationsService from "@/services/organizations";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { computeUserOrgKey } from "@/utils/userOrgKey";

import SharedChatContinue from "./SharedChatContinue.vue";
import SharedChatHeader from "./SharedChatHeader.vue";
import SharedChatNotices from "./SharedChatNotices.vue";
import SharedChatState, { type SharedPageState } from "./SharedChatState.vue";
import { projectSharedRecord, sharedMarkdown } from "./sharedRecord";
import { usePollShared, type PollResult } from "./usePollShared";
import { useReaderSession } from "./useReaderSession";

const props = withDefaults(defineProps<SharedChatPageProps>(), { isPublic: false });

const { t } = useI18nTyped();
const vuex = useStore();
const router = useRouter();

const region = ref<InstanceType<typeof AssistantStatusRegion> | null>(null);
const userOrgKey = ref("");
// The org page reads the app's runtime if it is built; the public page never builds one.
const runtime = runtimeHandle();

const variant = computed(() => (props.isPublic ? "public" : "org"));
const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
// A public route skips the login dispatch, so a signed-in reader is found in the session's user info.
const { email, checking } = useReaderSession({
  storeEmail: () => vuex.state.userInfo?.email || "",
  storedEmail: readSessionEmail,
  verify: assistant.sessionAlive,
});
const signedIn = computed(() => !!email.value);
const ossBuild = config.isEnterprise !== "true" && config.isCloud !== "true";
const aiEnabled = computed(() => vuex.state.zoConfig?.ai_enabled !== false);
const capability = computed(() =>
  props.isPublic ? null : (runtime.value?.capability.capability.value ?? null),
);
const canChat = computed(() => capability.value?.canChat ?? "unknown");
const isAdmin = computed(() => capability.value?.isAdmin ?? false);

let loaded = false;

// Shares never retry a refusal, and once loaded the poll owns retrying with its own back-off.
const retry = (count: number, error: unknown) =>
  !loaded && ![403, 404, 429].includes(statusOfError(error) ?? 0) && count < 2;

const chatQuery = useQuery(() =>
  props.isPublic
    ? Object.assign(publicSharedChatQuery(props.token), {
        enabled: !!props.token && !ossBuild,
        retry,
      })
    : Object.assign(sharedChatQuery(org.value, props.token), {
        enabled: !!props.token && !!org.value && !ossBuild && aiEnabled.value,
        retry,
      }),
);

const chat = computed(() => chatQuery.data.value);
watch(chat, (shown) => (loaded ||= !!shown), { immediate: true });

const reread = async (): Promise<PollResult> => {
  const result = await chatQuery.refetch();
  return { data: result.data, error: result.error ?? undefined };
};
const poll = usePollShared(chat, { refetch: reread });

const errorStatus = computed(() => statusOfError(chatQuery.error.value));
const pageState = computed<SharedPageState | "ready">(() => {
  if (ossBuild) return "oss";
  if (!props.isPublic && !aiEnabled.value) return "not_configured";
  const status = errorStatus.value;
  if (status === 404) return "not_found";
  if (status === 403 && !props.isPublic) return "forbidden";
  if (chat.value) return "ready";
  if (!chatQuery.error.value) return "loading";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return status === undefined ? "offline" : "error";
});
const assistantError = computed(() =>
  chatQuery.error.value ? readError(chatQuery.error.value) : null,
);

const timezone = computed(() =>
  props.isPublic
    ? (chat.value?.org_timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
    : "",
);

const mySharesRead = useQuery(() =>
  Object.assign(mySharesQuery(org.value), {
    enabled: !props.isPublic && !!org.value && !!chat.value,
  }),
);
const ownShare = computed(() =>
  props.isPublic
    ? undefined
    : mySharesRead.data.value?.find((share) => share.token === props.token),
);
const viewer = computed(() => {
  if (!signedIn.value) return checking.value ? ("checking" as const) : ("signedOut" as const);
  if (ownShare.value) return "owner" as const;
  return "member" as const;
});
const author = computed(() =>
  viewer.value === "owner"
    ? undefined
    : String(chat.value?.owner_name || "").slice(0, 200) || String(t("assistant.shared.owner")),
);
const messages = computed(() =>
  projectSharedRecord(chat.value?.turns ?? [], "viewer", {
    redacted: !!chat.value?.redact_tools,
    hidden: chat.value?.hidden,
    scrubModels: true,
    timezone: timezone.value,
    author: author.value,
  }),
);
const continueOrg = computed(() =>
  props.isPublic ? (chat.value?.org_identifier ?? "") : org.value,
);
// The last-selected org is only a local preference, so a member of the owner org may continue from any other.
const memberOrgs = useQuery(() => ({
  queryKey: ["assistant", "shared", "member-orgs", email.value],
  queryFn: async () => {
    const res = await organizationsService.os_list(0, 100000, "id", false, "", continueOrg.value);
    const list: { identifier?: unknown }[] = Array.isArray(res.data?.data) ? res.data.data : [];
    return list.map((entry) => String(entry.identifier ?? ""));
  },
  enabled:
    props.isPublic && signedIn.value && !!continueOrg.value && continueOrg.value !== org.value,
  retry: false,
  staleTime: Infinity,
}));
const canContinue = computed(() => {
  if (!props.isPublic) return canChat.value !== "no";
  if (!continueOrg.value) return false;
  return continueOrg.value === org.value || !!memberOrgs.data.value?.includes(continueOrg.value);
});

watch(
  [email, continueOrg],
  async ([address, target]) => {
    userOrgKey.value = address && target ? await computeUserOrgKey(address, target) : "";
  },
  { immediate: true },
);

watch(
  () => poll.state.value.changes,
  (changes, before) => {
    if (changes > (before ?? 0)) region.value?.announce(t("assistant.shared.updated"));
  },
);

let reported = false;
watch(
  pageState,
  (state) => {
    if (reported || state === "loading" || state === "oss" || state === "not_configured") return;
    reported = true;
    const shown = chat.value;
    trackAssistant("ai_shared_view", {
      visibility: props.isPublic ? "public" : "org",
      mode: shown?.mode ?? "snapshot",
      state: viewState(state),
      redacted: !!shown?.redact_tools,
      truncated: !!shown?.truncated,
    });
  },
  { immediate: true },
);

const robots = typeof document !== "undefined" ? document.createElement("meta") : null;
let darkQuery: MediaQueryList | null = null;
let hadDark = false;

onMounted(() => {
  if (!props.isPublic) return;
  if (robots) {
    robots.name = "robots";
    robots.content = "noindex";
    document.head.appendChild(robots);
  }
  followSystemTheme();
});

onBeforeUnmount(() => {
  robots?.remove();
  darkQuery?.removeEventListener("change", applyDark);
  if (darkQuery) document.documentElement.classList.toggle("dark", hadDark);
});

function readSessionEmail(): string {
  try {
    const info = JSON.parse(String(getDecodedUserInfo() ?? "null"));
    const address = info?.email;
    return typeof address === "string" && address.length <= 320 ? address : "";
  } catch {
    return "";
  }
}

// The ledger lives in the runtime; an anonymous reader sees only the status and the trace id.
function readError(error: unknown): AssistantError {
  const response = (
    error as {
      response?: {
        status?: number;
        headers?: Record<string, string>;
        data?: { message?: string; trace_id?: string };
      };
    }
  )?.response;
  return {
    code: response ? "unknown" : "unreachable",
    phase: "read",
    retryable: true,
    action: "retry",
    ...(response?.status !== undefined && { httpStatus: response.status }),
    ...(!props.isPublic &&
      typeof response?.data?.message === "string" && {
        serverMessage: response.data.message.slice(0, 500),
      }),
    ...(response?.data?.trace_id && { traceId: response.data.trace_id }),
  };
}

function viewState(state: SharedPageState | "ready") {
  if (state === "not_found") return "not_found" as const;
  if (state === "forbidden") return "forbidden" as const;
  if (state === "offline") return "offline" as const;
  if (state === "ready" && chat.value?.active_turn) return "running" as const;
  return "ready" as const;
}

// A signed-out reader has no theme setting, so the page follows the system unless one is stored.
function followSystemTheme(): void {
  if (typeof window === "undefined" || !window.matchMedia) return;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("theme");
  } catch {
    stored = null;
  }
  if (stored) return;
  hadDark = document.documentElement.classList.contains("dark");
  darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  applyDark();
  darkQuery.addEventListener("change", applyDark);
}

function applyDark(): void {
  document.documentElement.classList.toggle("dark", !!darkQuery?.matches);
}

function reload(): void {
  void poll.pollNow();
}

function goToChats(): void {
  void router.push({ name: "assistant" });
}

function openMine(): void {
  const share = ownShare.value;
  if (share) void router.push({ name: "assistant", params: { chatId: share.session_id } });
}

async function copyMarkdown(): Promise<void> {
  const shown = chat.value;
  if (!shown) return;
  const text = sharedMarkdown(
    String(shown.title || t("assistant.thread.newChatTitle")),
    messages.value,
  );
  if (await copyToClipboard(text, t, { silent: true }))
    region.value?.announce(t("assistant.shared.copied"));
}
</script>
