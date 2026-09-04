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
import { computed } from "vue";
import DOMPurify from "dompurify";
import { useStore } from "vuex";
import ActivityTimeline from "@/components/shared/ActivityTimeline.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import { getActivityAvatarColor, formatActivityRelativeTime } from "@/utils/activityTimeline";
import { DEFAULT_ACTIVITY_KINDS } from "@/utils/oncall";
import type { OnCallResponseEvent, ResponseEventKind } from "@/ts/interfaces/oncall";

interface Props {
  events: OnCallResponseEvent[];
  commentText: string;
  submitting?: boolean;
  showScrollButtons?: boolean;
}

const props = withDefaults(defineProps<Props>(), { submitting: false, showScrollButtons: true });

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

const currentUserId = computed(
  () => store.state.userInfo?.email?.split("@")[0] || "User",
);

const HUMAN_KINDS: ResponseEventKind[] = ["ack", "handoff", "note"];

const visibleEvents = computed(() =>
  showAll.value
    ? props.events
    : props.events.filter((e) => DEFAULT_ACTIVITY_KINDS.includes(e.kind)),
);

const isCommentEvent = (event: OnCallResponseEvent): boolean => event.kind === "note";

const getUserId = (event: OnCallResponseEvent): string =>
  HUMAN_KINDS.includes(event.kind) ? event.actor : "System";

const getAvatarColor = getActivityAvatarColor;
const formatRelativeTime = formatActivityRelativeTime;

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

// Pages and promotions lead with the badge, like an incident's Alert badge;
// everything else trails it.
const getEventLayout = (event: OnCallResponseEvent): "no-badge" | "before" | "after" =>
  ["page", "severity_promoted", "ack", "handoff"].includes(event.kind) ? "before" : "after";

const esc = (s: string) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getInlineHtml = (event: OnCallResponseEvent): string => {
  const color = getEventBadgeColor(event);
  const isHuman = HUMAN_KINDS.includes(event.kind);
  let html = isHuman
    ? esc(event.body)
    : `<span style="font-weight: 600; color: ${color};">${esc(event.actor)}</span> ${esc(event.body)}`;

  if (event.rung_micros !== null && event.rung_micros !== undefined) {
    html += ` <span class="text-text-secondary">(${esc(
      t("oncall.atRung", { delay: formatMicrosDuration(event.rung_micros) }),
    )})</span>`;
  }
  if (event.kind === "page" && event.delivered === false) {
    html += ` <span style="font-weight: 600; color: var(--color-error-500);">— ${esc(
      t("oncall.rungReachedNobodyRetrying"),
    )}</span>`;
  }
  return DOMPurify.sanitize(html);
};

const getCommentBody = (event: OnCallResponseEvent): string => event.body;
</script>
