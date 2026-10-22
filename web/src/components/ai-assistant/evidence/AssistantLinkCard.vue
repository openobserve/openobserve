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
    role="group"
    :aria-label="groupName"
    class="rounded-surface border-border-default bg-surface-base flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 border p-2"
    :data-kind="redacted ? 'redacted' : (link?.kind ?? 'unsupported')"
    :data-source="source"
    data-test="assistant-link-card"
  >
    <OIcon
      :name="assistantGlyph.link"
      size="sm"
      class="text-text-secondary mt-0.5 shrink-0"
      aria-hidden="true"
    />
    <div class="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
      <OText variant="body-strong" as="p" class="break-words" data-test="assistant-link-card-title">
        {{ title }}
      </OText>
      <OText
        v-if="link?.id"
        variant="meta"
        as="p"
        class="break-all"
        data-test="assistant-link-card-id"
      >
        {{ t("assistant.link.id", { id: raw(link.id) }) }}
      </OText>
      <OTruncatedText
        v-if="details"
        class="text-text-secondary text-xs"
        data-test="assistant-link-card-details"
      >
        {{ details }}
      </OTruncatedText>
      <OText
        v-if="source === 'markdown'"
        variant="meta"
        as="p"
        data-test="assistant-link-card-caption"
      >
        {{ t("assistant.link.fromAnswer") }}
      </OText>
      <OText v-if="opened" variant="meta" as="p" data-test="assistant-link-card-outcome">
        {{ opened }}
      </OText>
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-2 max-md:w-full">
      <template v-if="link && canOpen">
        <OButton
          v-if="showOpen"
          :variant="newTabFirst ? 'secondary' : 'primary'"
          size="sm"
          as="a"
          :href="href"
          :icon-right="opensElsewhere ? assistantGlyph.newTab : undefined"
          :aria-label="openName"
          :class="['max-md:flex-1', TOUCH_TARGET_CLASS]"
          data-test="assistant-link-card-open"
          @click="onOpen"
        >
          {{ t("assistant.link.openAction") }}
          <OTooltip v-if="link.kind === 'explorer'" :content="t('assistant.evidence.openHint')" />
        </OButton>
        <OButton
          v-if="showNewTab"
          :variant="newTabFirst ? 'primary' : 'secondary'"
          size="sm"
          as="a"
          :href="href"
          target="_blank"
          rel="noopener noreferrer"
          :icon-right="assistantGlyph.newTab"
          :aria-label="t('assistant.evidence.opensNewTab', { label: groupName })"
          :class="['max-md:flex-1', TOUCH_TARGET_CLASS]"
          data-test="assistant-link-card-new-tab"
          @click="onNewTab"
        >
          {{ t("assistant.link.newTab") }}
        </OButton>
        <ODropdown v-if="phoneMenu" align="end" privacy="mask">
          <template #trigger>
            <AssistantIconButton
              :label="t('assistant.link.more')"
              :icon="assistantGlyph.more"
              data-test="assistant-link-card-more"
            />
          </template>
          <ODropdownItem
            :icon-left="assistantGlyph.newTab"
            class="min-h-11"
            data-test="assistant-link-card-new-tab"
            @select="openNewTab"
          >
            {{ t("assistant.link.newTab") }}
          </ODropdownItem>
        </ODropdown>
      </template>
      <template v-else-if="!link && !redacted">
        <OButton
          variant="secondary"
          size="sm"
          disabled
          focusable-unavailable
          :class="['max-md:flex-1', TOUCH_TARGET_CLASS]"
          data-test="assistant-link-card-open"
        >
          {{ t("assistant.link.openAction") }}
          <template #unavailable-reason>{{ t("assistant.link.unsupported") }}</template>
          <OTooltip :content="t('assistant.link.unsupported')" />
        </OButton>
        <OButton
          v-if="copyText"
          variant="ghost"
          size="sm"
          :icon-left="assistantGlyph.copy"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-link-card-copy"
          @click="copy"
        >
          {{ t("assistant.query.copy") }}
        </OButton>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useRouter } from "vue-router";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { assistantEvidenceHostKey, type LinkTarget, type Sid } from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { formatOrgTime } from "@/utils/formatters";

import { explorerLabel, rangeText } from "./evidenceText";

const MAX_DETAIL_QUERY = 160;

const props = withDefaults(
  defineProps<{
    /** The typed target; null when the client cannot route it. */
    link: LinkTarget | null;
    source: "navigation" | "tool" | "markdown";
    blockId: string;
    sid?: Sid | null;
    readonly?: boolean;
    /** What Copy offers on an unroutable card. */
    copyText?: string | null;
    /** False on a readonly page with no explorer or app behind it. */
    openable?: boolean;
    /** A redacted reader's copy of a link: it says only that a view was linked. */
    redacted?: boolean;
  }>(),
  { sid: null, readonly: false, copyText: null, openable: true, redacted: false },
);

const { t } = useI18nTyped();
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);
const router = useRouter();
const { mdUp } = useBreakpoint();

const live = computed(() => !props.readonly && !!evidence && !!props.sid);
// Docked or dirty, Open itself goes to a new tab, so a second new-tab button would repeat it.
const opensElsewhere = computed(() => live.value && evidence?.prefersNewTab() === true);
const newTabFirst = computed(() => !live.value);
// A chat of another org would open its targets in this one, so it offers no Open at all.
const otherOrg = computed(() => {
  const org = props.sid && evidence ? evidence.session(props.sid)?.org : null;
  const current = evidence?.currentOrg();
  return !!org && !!current && org !== current;
});
const canOpen = computed(() => props.openable && !otherOrg.value);
const showOpen = computed(() => live.value);
const showNewTab = computed(() => !live.value || (mdUp.value && !opensElsewhere.value));
const phoneMenu = computed(() => live.value && !mdUp.value && !opensElsewhere.value);

const href = computed(() => {
  if (!props.link || !router) return undefined;
  const query = { ...(props.link.route.query ?? {}) };
  if (props.sid && evidence)
    query.org_identifier = evidence.session(props.sid)?.org ?? query.org_identifier;
  return router.resolve({
    name: props.link.route.name,
    params: props.link.route.params ?? {},
    query,
  }).href;
});

const title = computed<I18nText>(() => {
  const link = props.link;
  if (props.redacted) return t("assistant.link.redacted");
  if (!link) return t("assistant.link.cantOpen");
  const name = raw(link.name ?? "");
  switch (link.kind) {
    case "explorer":
      return t("assistant.link.openIn", { explorer: explorerLabel(link.explorer ?? "logs", t) });
    case "dashboard":
      return t("assistant.link.open.dashboard", { name });
    case "alert":
      return t("assistant.link.open.alert", { name });
    case "incident":
      return t("assistant.link.open.incident", { name });
    case "trace":
      return t("assistant.link.open.trace", { id: name });
    default:
      return t(`assistant.link.open.${link.kind}`);
  }
});

// The stream and range name the target; the query text is shown but kept out of accessible names.
const where = computed(() => {
  const query = props.link?.query;
  if (!query) return [];
  const range =
    query.from && query.to ? String(rangeText({ from: query.from, to: query.to })) : null;
  return [query.stream, range].filter((part): part is string => !!part);
});

const details = computed<I18nText | null>(() => {
  const text = props.link?.query?.text?.replace(/\s+/g, " ").slice(0, MAX_DETAIL_QUERY);
  const parts = text ? [...where.value, text] : where.value;
  return parts.length ? raw(parts.join(" · ")) : null;
});

const groupName = computed(() =>
  where.value.length
    ? t("assistant.link.groupName", { title: title.value, details: raw(where.value.join(", ")) })
    : title.value,
);

const openName = computed<I18nText>(() =>
  opensElsewhere.value
    ? t("assistant.evidence.opensNewTab", { label: groupName.value })
    : groupName.value,
);

const opened = computed<I18nText | null>(() => {
  const session = props.sid && evidence ? evidence.session(props.sid) : null;
  const at = session?.annotations[props.blockId]?.linkOutcome?.openedAt;
  return at
    ? t("assistant.link.opened", { time: raw(formatOrgTime(at, { showZone: true })) })
    : null;
});

// Ctrl/⌘, Shift and middle clicks keep the browser's own new-tab behaviour.
function onOpen(event: MouseEvent): void {
  if (!live.value || !props.link) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) return;
  event.preventDefault();
  void navigate(false);
}

function onNewTab(event: MouseEvent): void {
  if (!live.value) return;
  event.preventDefault();
  void navigate(true);
}

function openNewTab(): void {
  void navigate(true);
}

async function navigate(newTab: boolean): Promise<void> {
  if (!props.link || !props.sid || !evidence) return;
  const result = await evidence.dispatch(props.sid, {
    kind: "navigate",
    target: props.link.route,
    newTab,
    label: title.value,
  });
  if (result.ok) evidence.markOpened(props.sid, props.blockId);
  else if (result.reason === "other_org") {
    const org = raw(evidence.session(props.sid)?.org ?? "");
    evidence.announce(props.sid, t("assistant.evidence.otherOrg", { org }));
  }
}

async function copy(): Promise<void> {
  if (!props.copyText) return;
  if (props.sid && evidence) {
    const result = await evidence.dispatch(props.sid, {
      kind: "copy",
      text: props.copyText,
      what: "query",
    });
    evidence.announce(
      props.sid,
      result.ok ? t("assistant.evidence.copied") : t("assistant.client.copyManually"),
    );
    return;
  }
  await copyToClipboard(props.copyText, t, { successMessage: t("assistant.evidence.copied") });
}
</script>
