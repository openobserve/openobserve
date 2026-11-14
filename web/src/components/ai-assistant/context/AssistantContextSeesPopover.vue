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
  <OPopover
    v-model:open="open"
    privacy="mask"
    side="top"
    align="end"
    :aria-label="title"
    :collision-padding="inset"
    :content-class="`${widthClass} max-h-[min(32rem,70vh)] overflow-y-auto p-3`"
  >
    <template #trigger>
      <AssistantIconButton
        :label="title"
        :icon="assistantGlyph.info"
        data-test="assistant-context-sees"
      />
    </template>

    <section
      data-test="assistant-context-sees-popover"
      data-dd-privacy="mask"
      :aria-labelledby="headingId"
      class="flex flex-col gap-2"
    >
      <div class="flex flex-col gap-0.5">
        <OText
          :id="headingId"
          ref="heading"
          variant="card-title"
          as="h2"
          tabindex="-1"
          class="outline-none"
        >
          {{ title }}
        </OText>
        <OText variant="meta" as="p" data-test="assistant-context-sees-intro">{{ intro }}</OText>
      </div>

      <OText v-if="isEmpty" variant="meta" as="p" data-test="assistant-context-sees-empty">
        {{ t("assistant.context.seesEmpty") }}
      </OText>
      <div v-if="lines.length > 0" :class="CARD" data-test="assistant-context-sees-page">
        <div
          v-for="line in lines"
          :key="line.id"
          :class="[ROW, line.secondary ? 'items-start' : 'items-center']"
          data-test="assistant-context-sees-row"
          :data-field="line.id"
        >
          <OIcon
            :name="line.glyph"
            size="xs"
            :class="ICON"
            aria-hidden="true"
            data-test="assistant-context-sees-row-icon"
          />
          <span class="text-text-secondary shrink-0 text-xs">{{ line.label }}</span>
          <div class="flex min-w-0 flex-1 flex-col items-end">
            <OTruncatedText class="text-text-body max-w-full text-sm">{{
              line.value
            }}</OTruncatedText>
            <OTruncatedText
              v-if="line.secondary"
              class="text-text-secondary max-w-full text-xs leading-tight"
              :data-test="line.secondaryTest"
              >{{ line.secondary }}</OTruncatedText
            >
          </div>
          <AssistantIconButton
            v-if="line.help"
            :label="t('assistant.context.notReadHint')"
            :icon="assistantGlyph.notReadHelp"
            data-test="assistant-context-sees-not-read-hint"
          >
            <template #tooltip>
              <span
                class="flex flex-col gap-0.5"
                data-test="assistant-context-sees-not-read-reason"
              >
                <span>{{ t("assistant.context.seesGroup.notReadReason", { product }) }}</span>
                <span v-for="item in notRead" :key="item.id"
                  >{{ item.label }}: {{ item.value }}</span
                >
              </span>
            </template>
          </AssistantIconButton>
        </div>
      </div>
      <div
        v-if="added.length > 0"
        class="flex flex-col gap-1"
        data-test="assistant-context-sees-added"
      >
        <OText variant="label" as="h3" data-test="assistant-context-sees-heading">{{
          t("assistant.context.seesGroup.added")
        }}</OText>
        <div :class="CARD">
          <div
            v-for="row in added"
            :key="row.id"
            :class="[ROW, 'items-center']"
            data-test="assistant-context-sees-row"
            :data-field="row.id"
          >
            <OIcon
              :name="rowGlyph(row)"
              size="xs"
              :class="ICON"
              aria-hidden="true"
              data-test="assistant-context-sees-row-icon"
            />
            <span class="text-text-secondary shrink-0 text-xs">{{ row.label }}</span>
            <OTruncatedText class="text-text-body min-w-0 flex-1 text-end text-sm">{{
              row.value
            }}</OTruncatedText>
          </div>
        </div>
      </div>

      <slot name="detail" />
      <div class="text-text-secondary flex flex-col gap-1 text-xs">
        <div class="flex items-center gap-1.5">
          <OIcon :name="assistantGlyph.locked" size="xs" class="shrink-0" aria-hidden="true" />
          <OText variant="meta" as="p" data-test="assistant-context-sees-disclosure">{{
            disclosure
          }}</OText>
        </div>
        <div v-if="voice.sentence.value" class="flex items-center gap-1.5">
          <OIcon :name="assistantGlyph.dictate" size="xs" class="shrink-0" aria-hidden="true" />
          <OText variant="meta" as="p" data-test="assistant-context-sees-voice">
            {{ t("assistant.voice.seesLine") }}
          </OText>
        </div>
      </div>
    </section>
  </OPopover>
</template>

<script lang="ts">
import { fieldRowOf, type ContextDraft, type SeesRow, type Sid } from "@/composables/assistant";
import type { IconName } from "@/lib/core/Icon/OIcon.types";

export interface AssistantContextSeesPopoverProps {
  sid: Sid | null;
  /** A box with no chat yet says what it holds; a chat's composer is read from its session. */
  draft?: ContextDraft | null;
  /** Home names no streams: it has no page to read them from. */
  hideStreams?: boolean;
}

interface SeesLine {
  id: string;
  label: string;
  value: string;
  glyph: IconName;
  secondary?: string;
  secondaryTest?: string;
  help?: boolean;
}

const STREAMS_ROW = "selectedStreams";

const ATTACHMENTS_ROW = "attachments";

const PANEL_GAP_PX = 8;

const CARD =
  "rounded-default border-border-subtle bg-surface-subtle divide-border-subtle flex flex-col divide-y border";

const ROW = "flex min-h-8 min-w-0 gap-2 px-2.5 py-1.5";

const ICON = "text-text-secondary mt-0.5 shrink-0";

const ROW_GLYPHS: Readonly<Record<string, IconName>> = {
  org_id: assistantGlyph.seesOrg,
  currentPage: assistantGlyph.seesPage,
  timeRange: assistantGlyph.chipTime,
  user_timezone: assistantGlyph.seesZone,
  attachments: assistantGlyph.seesAttachment,
};

function rowGlyph(row: SeesRow): IconName {
  const chip = fieldRowOf(row.id)?.chip;
  return ROW_GLYPHS[row.id] ?? (chip ? chipGlyph[chip] : assistantGlyph.seesPage);
}

// Only this popover capitalises the range, so the shared formatter stays untouched.
function rangeText(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// A field the user's @ mention fills is theirs, so it reads under You Added, not This Page.
function isAdded(row: SeesRow, mentioned: ReadonlySet<string>): boolean {
  const kind = fieldRowOf(row.id)?.chip;
  return row.id === ATTACHMENTS_ROW || (!!kind && mentioned.has(kind));
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph, chipGlyph } from "@/components/ai-assistant/common/glyphs";
import { useComposerLayout } from "@/components/ai-assistant/composer/composerUi";
import { useVoiceAvailability } from "@/components/ai-assistant/composer/useAssistantVoice";
import { useAssistantContext, useAssistantName, useAssistantStore } from "@/composables/assistant";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantContextSeesPopoverProps>(), {
  draft: null,
  hideStreams: false,
});

defineSlots<{ detail?: () => unknown }>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const context = useAssistantContext(() => props.sid, { store, draft: () => props.draft });
const voice = useVoiceAvailability();
const layout = useComposerLayout();
const headingId = `assistant-sees-${useId()}`;
const heading = ref<InstanceType<typeof OText> | null>(null);
const open = ref(false);
const inset = ref<{ left: number; right: number } | undefined>(undefined);

const title = computed(() => t("assistant.context.seesTitle", { product }));
const disclosure = computed(() =>
  store.state.sessions[props.sid ?? ""]?.share
    ? context.disclosure.value
    : t("assistant.context.seesDisclosure"),
);
const widthClass = computed(() =>
  layout.value.tight
    ? "w-max max-w-[calc(20rem-0.375rem)]"
    : "w-max max-w-[min(26rem,calc(100vw-1.5rem))]",
);

const split = computed(() => {
  const mentioned = new Set<string>(
    context.chips.value.filter((chip) => chip.provenance === "mention").map((chip) => chip.kind),
  );
  const rows = context.sees.value.filter((row) => !(props.hideStreams && row.id === STREAMS_ROW));
  const added: SeesRow[] = [];
  const notRead: SeesRow[] = [];
  const base: SeesRow[] = [];
  for (const row of rows) {
    if (row.group === "not_read") notRead.push(row);
    else if (isAdded(row, mentioned)) added.push(row);
    else if (row.id !== "request_timestamp") base.push(row);
  }
  return { added, notRead, base };
});
const added = computed(() => split.value.added);
const notRead = computed(() => split.value.notRead);

const lines = computed<SeesLine[]>(() => {
  const { base } = split.value;
  const byId = (id: string) => base.find((row) => row.id === id);
  const org = byId("org_id");
  const page = byId("currentPage");
  const range = byId("timeRange");
  const zone = byId("user_timezone");
  const out: SeesLine[] = [];
  const plain = (row: SeesRow): SeesLine => ({
    id: row.id,
    label: row.label,
    value: row.id === "timeRange" ? rangeText(row.value) : row.value,
    glyph: rowGlyph(row),
  });
  if (page)
    out.push({
      ...plain(page),
      secondary: org ? t("assistant.context.orgLine", { org: org.value }) : undefined,
      secondaryTest: "assistant-context-sees-org",
    });
  else if (org) out.push(plain(org));
  for (const row of base)
    if (!["org_id", "currentPage", "timeRange", "user_timezone"].includes(row.id))
      out.push(plain(row));
  if (range)
    out.push({
      ...plain(range),
      secondary: zone?.value,
      secondaryTest: "assistant-context-sees-timezone",
    });
  else if (zone) out.push(plain(zone));
  if (notRead.value.length > 0)
    out.push({
      id: "not_read",
      label: t("assistant.context.notSent"),
      value: notRead.value.map((row) => row.label).join(", "),
      glyph: assistantGlyph.withheld,
      help: true,
    });
  return out;
});
const isEmpty = computed(() => lines.value.length === 0 && added.value.length === 0);
// Only what the user added has a chip to remove, so only then does the line say how.
const intro = computed(() =>
  added.value.length > 0
    ? t("assistant.context.seesIntroRemove")
    : t("assistant.context.seesIntro"),
);

function measureInset(): void {
  const content = (heading.value?.$el as HTMLElement | undefined)?.closest<HTMLElement>(
    "[data-o-popover-content]",
  );
  const id = content?.id;
  const trigger = id
    ? [...document.querySelectorAll<HTMLElement>("[aria-controls]")].find(
        (el) => el.getAttribute("aria-controls") === id,
      )
    : null;
  const box = trigger?.closest<HTMLElement>("[data-assistant-surface]")?.getBoundingClientRect();
  inset.value = box
    ? {
        left: Math.max(0, box.left + PANEL_GAP_PX),
        right: Math.max(0, window.innerWidth - box.right + PANEL_GAP_PX),
      }
    : undefined;
}

// Focus lands on the heading, after the popover's own first-control focus (CT-04 AC 6).
watch(open, async (shown) => {
  if (!shown) return;
  trackAssistant("ai_context_inspected", { target: "sees" });
  voice.probe();
  await nextTick();
  measureInset();
  (heading.value?.$el as HTMLElement | undefined)?.focus();
});
</script>
