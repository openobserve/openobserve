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
  <section
    v-if="source"
    :aria-label="t('assistant.fork.regionName', { title: source.title })"
    class="border-border-default flex shrink-0 flex-col gap-2 border-b px-3 py-2"
    data-dd-privacy="mask"
    data-test="assistant-fork-source"
    :data-state="state"
  >
    <OBanner
      v-if="lost && !acknowledged"
      variant="warning"
      dense
      :content="t('assistant.fork.seedLost')"
      data-test="assistant-fork-source-seed-lost"
    >
      <template #actions>
        <OButton
          variant="primary"
          size="sm"
          class="max-md:min-h-11"
          data-test="assistant-fork-source-send-anyway"
          @click="sendAnyway"
          >{{ t("assistant.fork.sendAnyway") }}</OButton
        >
        <OButton
          variant="outline"
          size="sm"
          class="max-md:min-h-11"
          data-test="assistant-fork-source-cancel"
          @click="lost = false"
          >{{ t("common.cancel") }}</OButton
        >
      </template>
    </OBanner>
    <OCollapsible v-model="open" trigger-class="min-h-8 max-md:min-h-11 pointer-coarse:min-h-11">
      <template #trigger>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5 text-start">
          <OText variant="body-strong" class="min-w-0" data-test="assistant-fork-source-heading"
            >{{ heading }}
            <span v-if="acknowledged" data-test="assistant-fork-source-gone">{{
              t("assistant.fork.sourceGone")
            }}</span></OText
          >
          <OText
            v-if="!open && seedTurns > 0"
            variant="meta"
            data-test="assistant-fork-source-show"
            >{{ t("assistant.fork.showTurns", { count: seedTurns }, seedTurns) }}</OText
          >
          <OText
            v-if="state === 'missing'"
            variant="meta"
            data-test="assistant-fork-source-missing"
            >{{ t("assistant.fork.seedMissing") }}</OText
          >
        </span>
      </template>
      <div
        v-if="state !== 'missing'"
        class="flex h-[min(50vh,24rem)] min-h-0 flex-col"
        data-test="assistant-fork-source-transcript"
      >
        <AssistantTranscript
          readonly
          :messages="messages"
          :openable="false"
          density="compact"
          :label="t('assistant.fork.regionName', { title: source.title })"
        />
      </div>
    </OCollapsible>
    <div class="flex items-center gap-2" role="separator" data-test="assistant-fork-source-divider">
      <span class="border-border-default flex-1 border-t" />
      <OText variant="meta">{{ t("assistant.fork.divider") }}</OText>
      <span class="border-border-default flex-1 border-t" />
    </div>
    <OText variant="meta" data-test="assistant-fork-source-note">{{
      t("assistant.fork.contextNote")
    }}</OText>
  </section>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantForkSourceProps {
  sid: Sid;
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";

import { statusOfError } from "@/components/ai-assistant/share/chatShare";
import { forkSeedOf } from "@/components/ai-assistant/shared/forkMemory";
import { projectSharedRecord } from "@/components/ai-assistant/shared/sharedRecord";
import AssistantTranscript from "@/components/ai-assistant/transcript/AssistantTranscript.vue";
import { useAssistantSession, type ForkSeed } from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { StoredTurn } from "@/components/O2AIChat.history";
import { sharedChatQuery } from "@/services/ai_chat_share.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

const props = defineProps<AssistantForkSourceProps>();

const { t } = useI18nTyped();
const view = useAssistantSession(() => props.sid);
const queryClient = useQueryClient();
const { mdUp } = useBreakpoint();

const lost = ref(false);
const acknowledged = ref(false);

const seed = computed<ForkSeed | undefined>(
  () => view.session.value?.record.seed ?? forkSeedOf(props.sid),
);
const hasTurns = computed(() => view.messages.value.length > 0);
const open = ref(mdUp.value && !hasTurns.value);

const source = computed(() => {
  if (seed.value)
    return { title: seed.value.title, ownerName: seed.value.ownerName, asOf: seed.value.asOf };
  const token = view.session.value?.record.forkedFromShare;
  if (!token) return null;
  return { title: String(view.session.value?.title ?? ""), ownerName: "", asOf: 0 };
});
const state = computed(() => (seed.value ? (acknowledged.value ? "gone" : "seeded") : "missing"));
const turns = computed(() => (seed.value?.turns ?? []) as StoredTurn[]);
const seedTurns = computed(() => turns.value.length);
const messages = computed(() =>
  projectSharedRecord(turns.value, "viewer", {
    scrubModels: true,
    timezone: "",
    redacted: seed.value?.redacted,
    hidden: seed.value?.hidden,
    author: seed.value?.ownerName || String(t("assistant.shared.owner")),
  }),
);

const heading = computed(() => {
  const s = source.value;
  if (!s) return raw("");
  const text = t("assistant.fork.sourceHeading", {
    title: s.title,
    owner: s.ownerName || "—",
    time: s.asOf ? formatOrgTime(s.asOf, { showZone: true }) : "—",
  });
  return text;
});

// The first turn folds the source away, so the conversation leads.
watch(hasTurns, (now, before) => {
  if (now && !before) open.value = false;
});

// Without a server-held seed, the source is checked before the first message relies on it.
onMounted(async () => {
  const token = seed.value?.token;
  const org = view.session.value?.org;
  if (!token || !org || hasTurns.value) return;
  try {
    await queryClient.fetchQuery({ ...sharedChatQuery(org, token), staleTime: 0 });
  } catch (err) {
    if (statusOfError(err) === 404) lost.value = true;
  }
});

function sendAnyway(): void {
  acknowledged.value = true;
  lost.value = false;
}
</script>
