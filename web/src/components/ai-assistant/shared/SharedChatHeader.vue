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
  <header class="flex flex-col gap-3" data-test="assistant-shared-header" :data-variant="variant">
    <div
      v-if="variant === 'public'"
      class="border-border-default flex min-w-0 items-center gap-3 border-b pb-3"
      data-test="assistant-shared-brand"
    >
      <a
        :href="homeUrl"
        class="rounded-default inline-flex shrink-0 items-center focus-visible:ring-2 focus-visible:outline-none"
        :aria-label="t('assistant.shared.brandHome')"
        data-test="assistant-shared-brand-home"
      >
        <img :src="logoLight" alt="" class="h-6 w-auto dark:hidden" />
        <img :src="logoDark" alt="" class="hidden h-6 w-auto dark:block" />
      </a>
      <OText variant="meta" class="min-w-0">{{ t("assistant.shared.brand") }}</OText>
    </div>

    <div
      class="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-3 max-md:flex-col max-md:items-stretch"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <h1
          ref="heading"
          tabindex="-1"
          class="text-text-heading min-w-0 text-xl font-semibold outline-none"
          :aria-describedby="descriptionId"
          data-test="assistant-shared-title"
        >
          <OTruncatedText>{{ title }}</OTruncatedText>
        </h1>
        <div
          :id="descriptionId"
          class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
        >
          <span v-if="chat.owner_name" data-test="assistant-shared-by">{{
            t("assistant.shared.by", { name: chat.owner_name })
          }}</span>
          <OTag
            type="assistantShare"
            value="mode"
            :label="
              share.mode === 'live' ? t('assistant.share.liveMode') : t('assistant.share.snapshot')
            "
            data-test="assistant-shared-mode"
          />
          <span data-test="assistant-shared-asof">{{ freshness }}</span>
          <span v-if="polling.status === 'backoff'" data-test="assistant-shared-backoff">{{
            t("assistant.shared.backoff")
          }}</span>
        </div>
      </div>

      <div
        class="flex shrink-0 flex-wrap items-center gap-2 max-md:w-full"
        data-test="assistant-shared-actions"
      >
        <template v-if="viewer === 'checking'" />
        <OButton
          v-else-if="viewer === 'owner'"
          variant="primary"
          size="sm"
          class="max-md:min-h-11 max-md:w-full"
          data-test="assistant-shared-open-mine"
          @click="emit('openMine')"
          >{{ t("assistant.shared.openMine") }}</OButton
        >
        <OButton
          v-else-if="viewer === 'signedOut'"
          as="a"
          variant="primary"
          size="sm"
          class="max-md:min-h-11 max-md:w-full"
          :href="signInUrl"
          data-test="assistant-shared-signin"
          @click="rememberReturn"
          >{{ t("assistant.shared.signIn") }}</OButton
        >
        <OButton
          v-else-if="variant === 'public' && !chat.org_identifier"
          as="a"
          variant="primary"
          size="sm"
          class="max-md:min-h-11 max-md:w-full"
          :href="homeUrl"
          data-test="assistant-shared-open-app"
          >{{ t("assistant.shared.openApp") }}</OButton
        >
        <div
          v-else-if="!canContinue"
          class="flex flex-wrap items-center gap-2 max-md:w-full"
          data-test="assistant-shared-continue-locked"
        >
          <OText variant="meta">{{ t("assistant.shared.continueLocked") }}</OText>
          <slot name="ask-admin" />
        </div>
        <slot v-else name="continue" />
        <ODropdown align="end">
          <template #trigger>
            <AssistantIconButton
              :label="t('assistant.shared.more')"
              :icon="assistantGlyph.more"
              data-test="assistant-shared-menu"
            />
          </template>
          <ODropdownItem
            :icon-left="assistantGlyph.markdown"
            data-test="assistant-shared-copy-md"
            @select="emit('copyMarkdown')"
            >{{ t("assistant.shared.copyMarkdown") }}</ODropdownItem
          >
        </ODropdown>
      </div>
    </div>
  </header>
</template>

<script lang="ts">
import type { SharedChat } from "@/services/ai_chat_share";

import type { PollState } from "./usePollShared";

export interface SharedChatHeaderProps {
  variant: "org" | "public";
  chat: SharedChat;
  share: { mode: "snapshot" | "live"; visibility: "org" | "public" };
  /** `checking` holds every sign-in-dependent action until the session probe settles. */
  viewer: "owner" | "member" | "signedOut" | "checking";
  polling: PollState;
  /** The viewer holds `ai` PUT; without it Continue is a locked line, never a 403 after a click. */
  canContinue?: boolean;
  /** IANA zone every time on the page renders in; empty is the org zone. */
  timezone?: string;
  now?: number;
}

export interface SharedChatHeaderEmits {
  (e: "openMine"): void;
  (e: "copyMarkdown"): void;
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";

import logoDark from "@/assets/images/common/openobserve_latest_dark_2.svg";
import logoLight from "@/assets/images/common/openobserve_latest_light_2.svg";
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { shareUrl } from "@/components/ai-assistant/share/chatShare";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatOrgTime, formatRelative } from "@/utils/formatters";

const props = withDefaults(defineProps<SharedChatHeaderProps>(), {
  canContinue: true,
  timezone: "",
  now: undefined,
});

const emit = defineEmits<SharedChatHeaderEmits>();

const { t } = useI18nTyped();
const descriptionId = useId();
const heading = ref<HTMLElement | null>(null);

const title = computed(() => raw(props.chat.title) || t("assistant.thread.newChatTitle"));
const homeUrl = computed(() => shareUrl("/web/"));
const signInUrl = computed(() => shareUrl("/web/login"));

const freshness = computed(() => {
  const zone = { timeZone: props.timezone || undefined, showZone: true };
  const polling = props.polling;
  if (props.share.mode === "snapshot") {
    return t("assistant.shared.snapshot", {
      time: formatOrgTime(props.chat.shared_at / 1000, zone),
    });
  }
  if (polling.status === "running" || props.chat.active_turn) {
    const since = polling.runningSince ?? props.now ?? Date.now();
    return t("assistant.shared.running", { ago: formatRelative(since, props.now ?? Date.now()) });
  }
  const last = polling.lastChangeAt ?? props.chat.created_at / 1000;
  return t("assistant.shared.live", { time: formatOrgTime(last, zone) });
});

// Login returns to `redirectURI`; a query string would put the share token in the login page's telemetry.
function rememberReturn(): void {
  try {
    window.sessionStorage.setItem("redirectURI", window.location.href);
  } catch {
    // Without storage the reader signs in and lands on Home.
  }
}

// Focus starts on the page's heading, so the primary action is the next stop.
onMounted(() => heading.value?.focus({ preventScroll: true }));
</script>
