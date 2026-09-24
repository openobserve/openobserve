<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- The record drawer every SIEM page opens: half the screen and non-modal, so the list
     beside it stays live; j/k step through that list without closing. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { SeverityTone } from "@/utils/security/severity";

export interface RecordFact {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}

export interface RecordTab {
  name: string;
  label: string;
  icon?: IconName;
  count?: number | null;
}

type DrawerTone = SeverityTone | "primary" | "neutral" | "success";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** What kind of record this is — "Detection", "Case", "Event". */
    eyebrow?: string;
    subtitle?: string;
    icon?: IconName;
    tone?: DrawerTone;
    facts?: RecordFact[];
    tabs?: RecordTab[];
    tab?: string;
    /** 0-based position in the list the drawer was opened from. */
    index?: number | null;
    total?: number | null;
    shareUrl?: string;
    loading?: boolean;
    dataTest?: string;
  }>(),
  {
    tone: "primary",
    facts: () => [],
    tabs: () => [],
    index: null,
    total: null,
    loading: false,
    dataTest: "security-record-drawer",
  },
);

const emit = defineEmits<{
  "update:open": [open: boolean];
  "update:tab": [tab: string];
  close: [];
  prev: [];
  next: [];
}>();

const { t } = useI18n();

const TONE_CHIP: Record<DrawerTone, string> = {
  critical: "bg-icon-chip-error-bg text-icon-chip-error-text",
  high: "bg-icon-chip-orange-bg text-icon-chip-orange-text",
  medium: "bg-icon-chip-warning-bg text-icon-chip-warning-text",
  low: "bg-badge-blue-soft-bg text-badge-blue-soft-text",
  info: "bg-surface-subtle text-text-secondary",
  unknown: "bg-surface-subtle text-text-secondary",
  neutral: "bg-surface-subtle text-text-secondary",
  primary: "bg-icon-chip-primary-bg text-icon-chip-primary-text",
  success: "bg-icon-chip-success-bg text-icon-chip-success-text",
};
const TONE_BAR: Record<DrawerTone, string> = {
  critical: "bg-badge-error-solid-bg",
  high: "bg-badge-orange-solid-bg",
  medium: "bg-badge-amber-solid-bg",
  low: "bg-badge-blue-solid-bg",
  info: "bg-border-default",
  unknown: "bg-border-default",
  neutral: "bg-border-default",
  primary: "bg-accent",
  success: "bg-status-positive",
};

const hasPrev = computed(() => props.index !== null && props.index > 0);
const hasNext = computed(
  () => props.index !== null && props.total !== null && props.index < props.total - 1,
);

function close() {
  emit("update:open", false);
  emit("close");
}

const linkCopied = ref(false);
function copyLink() {
  if (!props.shareUrl) return;
  // navigator.clipboard is undefined on plain-HTTP deployments.
  if (!navigator.clipboard) {
    toast({ variant: "error", message: t("siem.record.copyFailed") });
    return;
  }
  navigator.clipboard.writeText(props.shareUrl).then(
    () => {
      linkCopied.value = true;
      setTimeout(() => (linkCopied.value = false), 1600);
    },
    () => toast({ variant: "error", message: t("siem.record.copyFailed") }),
  );
}

const activeTab = computed({
  get: () => props.tab ?? props.tabs[0]?.name ?? "",
  set: (value: string) => emit("update:tab", value),
});

// Pages mount this drawer with v-if, so j/k exist only while a record is open.
useShortcuts([
  { id: "securityRecordNext", handler: () => props.open && hasNext.value && emit("next") },
  { id: "securityRecordPrev", handler: () => props.open && hasPrev.value && emit("prev") },
]);

// Non-modal dialogs don't restore focus; hand it back to what opened the drawer.
let opener: HTMLElement | null = null;
watch(
  () => props.open,
  (open) => {
    if (typeof document === "undefined") return;
    if (open) {
      const el = document.activeElement as HTMLElement | null;
      opener = el && el !== document.body ? el : null;
    } else if (opener) {
      const el = opener;
      opener = null;
      void nextTick(() => el.isConnected && el.focus());
    }
  },
  { immediate: true },
);

const shownFacts = computed(() =>
  props.facts.filter((f) => f.value !== null && f.value !== undefined && f.value !== ""),
);
</script>

<template>
  <ODrawer
    :open="open"
    side="right"
    :width="50"
    seamless
    :modal="false"
    :aria-label="eyebrow ? `${eyebrow}: ${title}` : title"
    bleed
    :show-close="false"
    :data-test="dataTest"
    @update:open="(v: boolean) => !v && close()"
  >
    <div class="bg-surface-base flex h-full min-h-0 flex-col">
      <!-- Severity accent: the first thing the eye reads -->
      <div class="h-1 shrink-0" :class="TONE_BAR[tone]" />

      <header
        class="border-border-default px-page-edge flex shrink-0 flex-col gap-3 border-b pt-4 pb-3"
      >
        <div class="flex items-start gap-3">
          <span
            v-if="icon"
            class="rounded-default inline-flex size-10 shrink-0 items-center justify-center"
            :class="TONE_CHIP[tone]"
          >
            <OIcon :name="icon" size="md" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              v-if="eyebrow"
              class="text-text-secondary text-2xs font-semibold tracking-wide uppercase"
              >{{ eyebrow }}</span
            >
            <OSkeleton v-if="loading && !title" type="text" class="h-6 w-2/3" />
            <h2
              v-else
              class="text-text-heading line-clamp-2 text-xl leading-snug font-semibold"
              :data-test="`${dataTest}-title`"
            >
              {{ title }}
            </h2>
            <span v-if="subtitle" class="text-text-secondary truncate text-xs">{{ subtitle }}</span>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <slot name="actions" />
            <div
              v-if="index !== null && total"
              class="border-border-default rounded-default ml-1 flex items-center border"
            >
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="keyboard-arrow-up"
                :disabled="!hasPrev"
                :data-test="`${dataTest}-prev`"
                @click="emit('prev')"
              >
                <OTooltip :content="t('siem.record.prev')" shortcut-id="securityRecordPrev" />
              </OButton>
              <span class="text-text-secondary text-2xs px-1 tabular-nums">
                {{ t("siem.record.position", { n: index + 1, total }) }}
              </span>
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="keyboard-arrow-down"
                :disabled="!hasNext"
                :data-test="`${dataTest}-next`"
                @click="emit('next')"
              >
                <OTooltip :content="t('siem.record.next')" shortcut-id="securityRecordNext" />
              </OButton>
            </div>
            <OButton
              v-if="shareUrl"
              variant="ghost"
              size="icon-sm"
              :icon-left="linkCopied ? 'check' : 'link'"
              :data-test="`${dataTest}-share`"
              @click="copyLink"
            >
              <OTooltip
                :content="linkCopied ? t('siem.record.linkCopied') : t('siem.record.copyLink')"
              />
            </OButton>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="close"
              :data-test="`${dataTest}-close`"
              @click="close"
            >
              <OTooltip :content="t('siem.common.close')" />
            </OButton>
          </div>
        </div>
        <div v-if="$slots.chips" class="flex flex-wrap items-center gap-1.5">
          <slot name="chips" />
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <!-- Key facts: the answers to the first three questions, no click needed -->
        <div
          v-if="shownFacts.length"
          class="px-page-edge grid grid-cols-2 gap-2 pt-4 lg:grid-cols-4"
          :data-test="`${dataTest}-facts`"
        >
          <div
            v-for="fact in shownFacts"
            :key="fact.label"
            class="bg-surface-subtle rounded-surface flex min-w-0 flex-col gap-1 px-3 py-2.5"
          >
            <span class="text-text-secondary text-2xs font-medium tracking-wide uppercase">{{
              fact.label
            }}</span>
            <span
              class="text-text-heading truncate text-sm font-semibold"
              :class="{ 'font-mono': fact.mono }"
              >{{ fact.value }}<OTooltip :content="String(fact.value)"
            /></span>
          </div>
        </div>

        <div v-if="$slots.summary" class="px-page-edge pt-4">
          <slot name="summary" />
        </div>

        <template v-if="tabs.length">
          <OTabs
            v-model="activeTab"
            class="border-border-default bg-surface-base sticky top-0 z-10 mt-3 border-b"
            :data-test="`${dataTest}-tabs`"
          >
            <OTab
              v-for="tb in tabs"
              :key="tb.name"
              :name="tb.name"
              :data-test="`${dataTest}-tab-${tb.name}`"
            >
              <span class="flex items-center gap-1.5">
                <OIcon v-if="tb.icon" :name="tb.icon" size="sm" />
                {{ tb.label }}
                <span
                  v-if="tb.count"
                  class="bg-surface-subtle text-text-secondary text-2xs rounded-full px-1.5 font-semibold tabular-nums"
                  >{{ tb.count }}</span
                >
              </span>
            </OTab>
          </OTabs>
          <div class="px-page-edge flex flex-col gap-4 py-4">
            <slot :name="`tab-${activeTab}`" />
          </div>
        </template>
        <div v-else class="px-page-edge flex flex-col gap-4 py-4">
          <slot />
        </div>
      </div>

      <footer
        v-if="$slots.footer"
        class="border-border-default bg-surface-base px-page-edge flex shrink-0 items-center justify-end gap-2 border-t py-3"
      >
        <slot name="footer" />
      </footer>
    </div>
  </ODrawer>
</template>
