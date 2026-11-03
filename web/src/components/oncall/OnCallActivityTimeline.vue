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

<!--
  The on-call detail page's activity feed. A thin wrapper around the shared
  ActivityTimeline — same comment cards, avatars, and inline-textarea/send-
  button composer as the incidents Activity tab, mapped onto
  OnCallResponseEvent's `kind`/`actor`/`body` shape. Fetching and note
  posting stay owned by the parent page (OnCallResponseDetail.vue already
  fetches the whole response, events included, in one call and re-fetches it
  after a note is added) — this component only renders.
-->
<template>
  <ActivityTimeline
    ref="timelineRef"
    :class="pinComposer ? 'h-[min(40rem,70vh)]!' : ''"
    :events="visibleEvents"
    :submitting="submitting"
    :show-scroll-buttons="showScrollButtons"
    v-model:comment-text="commentTextModel"
    :is-comment-event="isCommentEvent"
    :get-user-id="getUserId"
    :get-avatar-color="getAvatarColor"
    :get-timestamp="(event: OnCallResponseEvent) => event.at"
    :format-relative-time="formatRelativeTime"
    :get-event-icon="getEventIcon"
    :get-event-badge-color="getEventBadgeColor"
    :get-event-badge-text="getEventBadgeText"
    :get-event-layout="getEventLayout"
    :get-inline-html="getInlineHtml"
    :get-comment-body="getCommentBody"
    :current-user-id="currentUserId"
    :empty-title="showAll ? t('oncall.timelineEmpty') : t('oncall.timelineNoHumanEvents')"
    :empty-subtitle="raw('')"
    :comment-placeholder="t('oncall.notePlaceholder')"
    :commented-prefix="t('oncall.activityNotedPrefix')"
    :send-tooltip="t('oncall.activitySendNote')"
    :scroll-top-tooltip="t('oncall.activityScrollToTop')"
    :scroll-bottom-tooltip="t('oncall.activityScrollToBottom')"
    data-test-scroll-top="oncall-response-activity-scroll-top"
    data-test-scroll-bottom="oncall-response-activity-scroll-bottom"
    data-test-comment-input="oncall-response-note-input"
    data-test-comment-send="oncall-response-note-submit"
    @submit="$emit('submit')"
  />
</template>

<script lang="ts" setup>
import { computed, nextTick, ref, watch } from "vue";
import DOMPurify from "dompurify";
import { useStore } from "vuex";
import ActivityTimeline from "@/components/shared/ActivityTimeline.vue";
import { useOnCallClock } from "@/composables/useOnCallClock";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import { raw, useI18nTyped } from "@/types/i18n";
import { getActivityAvatarColor } from "@/utils/activityTimeline";
import {
  DEFAULT_ACTIVITY_KINDS,
  mergeTimelineEvents,
  rungStillRetrying,
  timelineSentence,
  timelineStamp,
} from "@/utils/oncall";
import type { OnCallResponseEvent, ResponseEventKind } from "@/ts/interfaces/oncall";

interface Props {
  events: OnCallResponseEvent[];
  commentText: string;
  submitting?: boolean;
  showScrollButtons?: boolean;
  /** Micros the page opened at, for the "+2m" offset beside each clock time. */
  openedAt?: number | null;
  /** Fixes the feed's height so the note box sits at the panel's foot with the newest event above it. */
  pinComposer?: boolean;
  /** The policy step a rung delay belongs to, or null when the policy no longer has it. */
  stepOf?: (rungMicros: number) => number | null;
  teamNameOf?: (teamId: string) => string | null;
}

const props = withDefaults(defineProps<Props>(), {
  submitting: false,
  showScrollButtons: false,
  openedAt: null,
  pinComposer: false,
  stepOf: () => null,
  teamNameOf: () => null,
});

const emit = defineEmits<{
  "update:commentText": [value: string];
  submit: [];
}>();

// Controlled by the parent: the "Hide/Show system activity" link lives
// beside the "Activity" header, not in this card's body, so the on/off
// state has to be lifted there. Defaults to true — system (engine
// bookkeeping) events show alongside human ones unless hidden.
const showAll = defineModel<boolean>("showAll", { default: true });

const { t } = useI18nTyped();
const store = useStore();

const commentTextModel = computed({
  get: () => props.commentText,
  set: (value: string) => emit("update:commentText", value),
});

const nowMicros = useOnCallClock();
const { nameOf } = useOrgUserNames();

const currentUserId = computed(() => nameOf(String(store.state.userInfo?.email ?? "")) || "User");

const HUMAN_KINDS: ResponseEventKind[] = ["ack", "handoff", "note"];

const visibleEvents = computed(() => {
  const merged = mergeTimelineEvents(props.events);
  return showAll.value ? merged : merged.filter((e) => DEFAULT_ACTIVITY_KINDS.includes(e.kind));
});

const isCommentEvent = (event: OnCallResponseEvent): boolean => event.kind === "note";

const getUserId = (event: OnCallResponseEvent): string =>
  HUMAN_KINDS.includes(event.kind) ? nameOf(event.actor) : "System";

const getAvatarColor = getActivityAvatarColor;
const formatRelativeTime = (at: number): string =>
  timelineStamp(at, props.openedAt, nowMicros.value, store.state.timezone);

const timelineRef = ref<{ scrollToBottom: () => void } | null>(null);

// Chat order: the newest line sits just above the note box, so a pinned feed opens scrolled to it.
watch(
  () => visibleEvents.value.length,
  async () => {
    if (!props.pinComposer) return;
    await nextTick();
    timelineRef.value?.scrollToBottom();
  },
  { immediate: true },
);

const getEventIcon = (event: OnCallResponseEvent): string => {
  switch (event.kind) {
    case "page":
      return "notifications";
    case "ack":
      return "check-circle";
    case "rca":
    case "ai_verdict":
      return "psychology";
    case "handoff":
      return "swap-horiz";
    case "recovery":
      return "check";
    case "state":
      return "sync";
    case "exhausted":
      return "error-outline";
    case "severity_promoted":
      return "warning";
    case "flapped":
      return "replay";
    default:
      return "circle";
  }
};

const getEventBadgeColor = (event: OnCallResponseEvent): string => {
  switch (event.kind) {
    case "page":
    case "severity_promoted":
      return "var(--color-error-500)";
    case "ack":
      return "var(--color-blue-500)";
    case "recovery":
    case "state":
      return "var(--color-success-500)";
    case "rca":
    case "ai_verdict":
    case "flapped":
      return "var(--color-amber-500)";
    case "handoff":
      return "var(--color-orange-500)";
    default:
      return "var(--color-grey-500)";
  }
};

const getEventBadgeText = (event: OnCallResponseEvent): string =>
  t(`oncall.eventKind_${event.kind}` as any);

// The icon's colour already says the kind, so a "System" or "Page" tag on every line was noise.
const getEventLayout = (): "no-badge" | "before" | "after" => "no-badge";

const esc = (s: string) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Names can repeat across an org, so each one carries its email on hover; tokens survive escaping where markup would not.
const PERSON_TOKEN = /\uE000(\d+)\uE000/g;

function sentenceWithPeople(event: OnCallResponseEvent): string {
  const people: string[] = [];
  const tokenFor = (email: string) => {
    people.push(email);
    return `\uE000${people.length - 1}\uE000`;
  };
  const sentence = esc(
    timelineSentence(event, { nameOf: tokenFor, teamNameOf: props.teamNameOf }, t),
  );
  return sentence.replace(PERSON_TOKEN, (_, index: string) => {
    const email = people[Number(index)];
    const name = nameOf(email);
    if (name === email) return esc(name);
    return `<span class="underline decoration-dotted underline-offset-2" title="${esc(`${name} · ${email}`)}">${esc(name)}</span>`;
  });
}

const getInlineHtml = (event: OnCallResponseEvent): string => {
  let html = sentenceWithPeople(event);

  // Without the policy the delay is the only clue, and beside the clock offset it reads as a second, different time.
  const step =
    event.rung_micros === null || event.rung_micros === undefined
      ? null
      : props.stepOf(event.rung_micros);
  if (step !== null) {
    html += ` <span class="text-text-secondary">(${esc(t("oncall.tlStep", { n: step }))})</span>`;
  }
  if (rungStillRetrying(event, props.events)) {
    html += ` <span style="font-weight: 600; color: var(--color-error-500);">— ${esc(
      t("oncall.rungReachedNobodyRetrying"),
    )}</span>`;
  }
  return DOMPurify.sanitize(html);
};

const getCommentBody = (event: OnCallResponseEvent): string => event.body;
</script>
