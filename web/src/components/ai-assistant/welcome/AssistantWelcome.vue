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
    data-test="assistant-welcome"
    :data-variant="variant"
    :data-fresh="fresh ? '' : undefined"
    :aria-labelledby="capabilityId"
    :class="[
      'flex flex-col p-4',
      variant === 'roomy' ? 'mx-auto w-full max-w-3xl gap-4 py-8' : 'gap-3',
    ]"
  >
    <h2
      :id="capabilityId"
      data-test="assistant-welcome-capability"
      :class="['text-text-body font-normal', variant === 'roomy' ? 'text-base' : 'text-sm']"
    >
      {{ capability }}
    </h2>
    <p
      v-if="variant === 'roomy'"
      class="text-text-secondary text-xs"
      data-test="assistant-welcome-beta"
    >
      {{ t("assistant.beta") }}
    </p>

    <div v-if="loading" class="flex flex-col gap-2" data-test="assistant-welcome-loading">
      <OSkeleton type="text" class="h-6 w-2/3" />
      <OSkeleton v-for="row in 3" :key="row" type="rect" class="h-9 w-full max-md:h-11" />
    </div>

    <template v-else>
      <AssistantContextSeesPopover v-model:open="seesOpen" :sid="sid" align="start">
        <template #anchor>
          <p class="flex flex-wrap items-center gap-1.5" data-test="assistant-welcome-scope">
            <span class="text-text-secondary text-xs">{{ t("assistant.welcome.scope") }}</span>
            <AssistantContextChip
              v-for="tag in tags"
              :key="tag.id"
              :chip="tag"
              readonly
              :expanded="seesOpen && openedBy === tag.id"
              :data-test="`assistant-welcome-scope-${tag.id}`"
              @open="openSees(tag.id)"
            />
            <span
              class="text-text-secondary text-xs"
              data-test="assistant-welcome-sent-with-first"
              >{{ t("assistant.welcome.sentWithFirst") }}</span
            >
          </p>
        </template>
      </AssistantContextSeesPopover>

      <h3 class="sr-only">{{ t("assistant.welcome.suggestions") }}</h3>
      <ul :class="variant === 'roomy' ? 'grid gap-3 xl:grid-cols-3' : 'flex flex-col gap-2'">
        <li v-for="(starter, index) in starters" :key="starter.id">
          <OCard v-if="variant === 'roomy'" variant="outlined" class="h-full">
            <OButton
              variant="ghost"
              block
              class="h-full! min-h-11 justify-start! py-3 text-start whitespace-normal!"
              :data-test="starter.dataTest"
              @click="select(starter, index)"
            >
              {{ starter.label }}
            </OButton>
          </OCard>
          <OButton
            v-else
            variant="secondary"
            size="sm"
            block
            class="h-auto! min-h-8 justify-start! py-1.5 text-start whitespace-normal! max-md:min-h-11 pointer-coarse:min-h-11"
            :data-test="starter.dataTest"
            @click="select(starter, index)"
          >
            {{ starter.label }}
          </OButton>
        </li>
      </ul>
    </template>
  </section>
</template>

<script lang="ts">
import type { AssistantScope, Container, ContextChip, Sid, Starter } from "@/composables/assistant";

export interface AssistantWelcomeProps {
  variant: "compact" | "roomy";
  scope: AssistantScope;
  starters: Starter[];
  loading: boolean;
  /** The first starter, which the composer renders as its ghost (WP-05); the welcome only decides it. */
  ghost?: Starter | null;
  /** The telemetry container this welcome renders in. */
  container?: Container;
  /** The session whose "What the assistant sees" the scope chips open. */
  sid?: Sid | null;
}

export interface AssistantWelcomeEmits {
  (e: "select-starter", starter: Starter): void;
  (e: "open-chat", target: { sid: Sid } | { chatId: number }): void;
}

// Once per page session per container, however often the welcome re-renders.
const shown = new Set<string>();

/** Lets a spec start from a fresh session; never called by app code. */
export function resetWelcomeTelemetryForTests(): void {
  shown.clear();
}
</script>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";

import AssistantContextChip from "@/components/ai-assistant/context/AssistantContextChip.vue";
import AssistantContextSeesPopover from "@/components/ai-assistant/context/AssistantContextSeesPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantWelcomeProps>(), {
  ghost: null,
  container: "sidebar",
  sid: null,
});

const emit = defineEmits<AssistantWelcomeEmits>();

const { t } = useI18nTyped();
const capabilityId = `assistant-welcome-${useId()}`;
const seesOpen = ref(false);
// Only the tag that opened the shared popover reports it as expanded (V7).
const openedBy = ref<string | null>(null);

const fresh = computed(() => props.scope.streamCount === 0);

const capability = computed(() =>
  props.scope.canWrite === "no"
    ? t("assistant.welcome.capability.readOnly")
    : t("assistant.welcome.capability.readWrite"),
);

// The scope tags are read-only tray chips that open "What the assistant sees" (`70` §8).
const tags = computed<ContextChip[]>(() => {
  const { org, streamCount, timeRange, pageObject } = props.scope;
  const tag = (id: string, kind: ContextChip["kind"], label: I18nText): ContextChip => ({
    id,
    kind,
    label,
    sizeBytes: 0,
    provenance: "page",
    sent: "whitelist",
  });
  const list: ContextChip[] = [];
  const editor = props.scope.editor;
  if (editor) {
    list.push(tag("object", "query", t(`assistant.welcome.scopeObject.${editor.language}`)));
    if (editor.stream)
      list.push(
        tag("stream", "stream", t("assistant.welcome.scopeStream", { stream: raw(editor.stream) })),
      );
    if (timeRange) list.push(tag("time", "time", timeRange));
    return list;
  }
  if (pageObject?.kind === "dashboard")
    list.push(
      tag(
        "object",
        "panel",
        t("assistant.welcome.scopeObject.dashboard", { name: raw(pageObject.name) }),
      ),
    );
  if (org) list.push(tag("org", "field", t("assistant.welcome.scopeOrg", { org: raw(org) })));
  if (streamCount !== null)
    list.push(
      tag("streams", "stream", t("assistant.welcome.streams", { count: streamCount }, streamCount)),
    );
  if (timeRange) list.push(tag("time", "time", timeRange));
  return list;
});

function openSees(id: string): void {
  openedBy.value = id;
  seesOpen.value = true;
}

function select(starter: Starter, index: number): void {
  trackAssistant("ai_welcome_starter", { starter_kind: starter.kind, index, via: "click" });
  if (starter.kind === "recent" && starter.sid) return emit("open-chat", { sid: starter.sid });
  if (starter.kind === "recent" && starter.chatId !== undefined)
    return emit("open-chat", { chatId: starter.chatId });
  emit("select-starter", starter);
}

watch(
  () => props.loading,
  (loading) => {
    if (loading || shown.has(props.container)) return;
    shown.add(props.container);
    trackAssistant("ai_welcome_shown", {
      fresh_org: fresh.value,
      starter_kinds: props.starters.map((s) => s.kind),
    });
  },
  { immediate: true },
);
</script>
