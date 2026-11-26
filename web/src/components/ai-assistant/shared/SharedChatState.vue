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
    v-if="state === 'loading'"
    class="flex flex-col gap-4"
    aria-hidden="true"
    data-test="assistant-shared-state"
    data-state="loading"
  >
    <OSkeleton type="text" class="h-8 w-2/3" />
    <OSkeleton type="text" class="h-4 w-1/3" />
    <OSkeleton v-for="n in 3" :key="n" type="text" class="h-20 w-full" />
  </div>
  <div
    v-else-if="gateReason"
    class="flex min-h-0 flex-1 flex-col"
    data-test="assistant-shared-state"
    :data-state="state"
  >
    <AssistantGateState
      :reason="gateReason"
      size="hero"
      :is-admin="isAdmin"
      :context="{ org, feature: 'share_read' }"
    />
  </div>
  <OEmptyState
    v-else
    size="hero"
    :backdrop="false"
    :title="copy.title"
    :description="copy.body"
    data-test="assistant-shared-state"
    :data-state="state"
  >
    <template #actions>
      <OButton
        v-if="action"
        :variant="action.primary ? 'primary' : 'outline'"
        size="sm"
        class="max-md:min-h-11"
        :as="action.href ? 'a' : 'button'"
        :href="action.href"
        :target="action.external ? '_blank' : undefined"
        :rel="action.external ? 'noopener noreferrer' : undefined"
        :data-test="`assistant-shared-state-${action.id}`"
        @click="onAction"
        >{{ action.label }}</OButton
      >
    </template>
    <template v-if="state === 'error' && error" #extra>
      <AssistantErrorDetails :error="error" :at="errorAt" :is-admin="isAdmin" />
    </template>
  </OEmptyState>
</template>

<script lang="ts">
import type { AssistantError } from "@/composables/assistant/pure";

export type SharedPageState =
  "loading" | "not_found" | "forbidden" | "offline" | "error" | "oss" | "not_configured";

export interface SharedChatStateProps {
  state: SharedPageState;
  variant: "org" | "public";
  org?: string;
  isAdmin?: boolean;
  /** Signed in: the 404 offers the viewer's own chats. */
  signedIn?: boolean;
  error?: AssistantError | null;
  errorAt?: number;
}
</script>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";

import AssistantErrorDetails from "@/components/ai-assistant/common/AssistantErrorDetails.vue";
import { shareUrl } from "@/components/ai-assistant/share/chatShare";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

interface StateAction {
  id: "retry" | "go-to-chats" | "go-to-app" | "see-plans";
  label: I18nText;
  primary: boolean;
  href?: string;
  external?: boolean;
}

// The gate reads the assistant runtime, which the public page must never load eagerly.
const AssistantGateState = defineAsyncComponent(
  () => import("@/components/ai-assistant/gate/AssistantGateState.vue"),
);

const PLANS_URL = "https://openobserve.ai/pricing/";

const props = withDefaults(defineProps<SharedChatStateProps>(), {
  org: "",
  isAdmin: false,
  signedIn: false,
  error: null,
  errorAt: 0,
});

const emit = defineEmits<{ retry: []; goToChats: [] }>();

const { t } = useI18nTyped();

const gateReason = computed(() => {
  if (props.state === "forbidden") return "no_share_read" as const;
  if (props.state === "not_configured" && props.variant === "org") return "not_configured" as const;
  return null;
});

const copy = computed<{ title: I18nText; body?: I18nText }>(() => {
  switch (props.state) {
    case "not_found":
      return {
        title: t("assistant.shared.notFound.title"),
        body: t("assistant.shared.notFound.body"),
      };
    case "offline":
      return { title: t("assistant.shared.offlineTitle") };
    case "oss":
      return { title: t("assistant.shared.ossTitle") };
    default:
      return { title: t("assistant.shared.loadFailed") };
  }
});

const action = computed<StateAction | null>(() => {
  if (props.state === "not_found") {
    return props.variant === "org" && props.signedIn
      ? { id: "go-to-chats", label: t("assistant.shared.goToChats"), primary: true }
      : { id: "go-to-app", label: t("assistant.shared.goToApp"), primary: true, href: appHome() };
  }
  if (props.state === "oss") {
    return {
      id: "see-plans",
      label: t("assistant.gate.notEntitled.seePlans"),
      primary: true,
      href: PLANS_URL,
      external: true,
    };
  }
  if (props.state === "offline" || props.state === "error") {
    return { id: "retry", label: t("common.retry"), primary: false };
  }
  return null;
});

function onAction(): void {
  const id = action.value?.id;
  if (id === "retry") emit("retry");
  else if (id === "go-to-chats") emit("goToChats");
}

function appHome(): string {
  return shareUrl("/web/");
}
</script>
