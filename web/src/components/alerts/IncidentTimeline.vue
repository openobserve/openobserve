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
  <ActivityTimeline
    ref="activityRef"
    :events="events"
    :loading="loading"
    :submitting="submitting"
    v-model:comment-text="commentText"
    :is-comment-event="isCommentEvent"
    :get-user-id="getUserId"
    :get-avatar-color="getAvatarColor"
    :get-timestamp="(event: any) => event.timestamp"
    :format-relative-time="formatRelativeTime"
    :get-event-icon="getEventIcon"
    :get-event-badge-color="getEventBadgeColor"
    :get-event-badge-text="getEventBadgeText"
    :get-event-layout="getEventLayout"
    :is-ai-labelled="isAiLabelled"
    :ai-sre-badge-text="t('alerts.incidents.aiSreBadge')"
    :get-tooltip="getFailureTooltip"
    :get-inline-html="getSanitizedInlineHtml"
    :get-comment-body="getCommentBody"
    :current-user-id="getCurrentUserId()"
    :empty-title="t('alerts.incidents.noActivityYet')"
    :empty-subtitle="t('alerts.incidents.eventsAndCommentsAppearHere')"
    :comment-placeholder="t('alerts.incidents.commentPlaceholder')"
    :commented-prefix="t('alerts.incidents.commentedPrefix')"
    :send-tooltip="t('alerts.incidents.sendComment')"
    :scroll-top-tooltip="t('alerts.incidents.scrollToTop')"
    :scroll-bottom-tooltip="t('alerts.incidents.scrollToBottom')"
    data-test-scroll-top="incident-timeline-scroll-top"
    data-test-scroll-bottom="incident-timeline-scroll-bottom"
    data-test-comment-input="incident-timeline-comment-input"
    data-test-comment-send="incident-timeline-comment-send"
    @submit="submitComment"
  />
</template>

<script lang="ts" setup>
import { ref, onMounted, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useTheme } from "@/composables/useTheme";
import incidentsService from "@/services/incidents";
import DOMPurify from "dompurify";
import ActivityTimeline from "@/components/shared/ActivityTimeline.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { getActivityAvatarColor } from "@/utils/activityTimeline";
import { formatToDateOnly } from "@/utils/date";

interface Props {
  orgId: string;
  incidentId: string;
  visible: boolean;
  refreshTrigger?: number;
}

const props = defineProps<Props>();

const store = useStore();
const { t } = useI18nTyped();
const { isDark } = useTheme();

const events = ref<any[]>([]);
const loading = ref(false);
const commentText = ref("");
const submitting = ref(false);
const activityRef = ref<InstanceType<typeof ActivityTimeline> | null>(null);

const scrollToBottom = async () => {
  await nextTick();
  activityRef.value?.scrollToBottom();
};

const fetchEvents = async () => {
  if (!props.incidentId) return;
  loading.value = true;
  try {
    const response = await incidentsService.getEvents(props.orgId, props.incidentId);
    events.value = response.data?.events || [];
  } catch (e: any) {
    console.error("[IncidentTimeline] Failed to fetch events:", e);
    events.value = [];
  } finally {
    loading.value = false;
  }
};

const submitComment = async () => {
  const text = commentText.value.trim();
  if (!text || submitting.value) return;

  submitting.value = true;
  try {
    await incidentsService.postComment(props.orgId, props.incidentId, text);
    commentText.value = "";
    await fetchEvents();
    toast({
      variant: "success",
      message: t("toastMessages.alerts.commentPostedSuccessfully"),
    });
  } catch (e: any) {
    toast({
      variant: "error",
      message: t("toastMessages.alerts.failedToPostComment"),
    });
  } finally {
    submitting.value = false;
  }
};

// Determine if event should be displayed as a comment card
const isCommentEvent = (event: any): boolean => {
  return event.type === "Comment";
};

// Get user ID from event. `SYSTEM_USER_ID` is a stable sentinel, never display
// text — the guards below and getAvatarColor() compare against it.
const SYSTEM_USER_ID = "System";

const getUserId = (event: any): string => {
  return event.data?.user_id || SYSTEM_USER_ID;
};

// Get current user ID
const getCurrentUserId = (): string => {
  return store.state.userInfo?.email?.split("@")[0] || "User";
};

const getAvatarColor = getActivityAvatarColor;

// Get event icon
const getEventIcon = (event: any): string => {
  switch (event.type) {
    case "Created":
      return "add-circle";
    case "Alert":
      return "notifications";
    case "SeverityUpgrade":
    case "SeverityOverride":
      return "warning";
    case "Acknowledged":
      return "check-circle";
    case "Resolved":
      return "check";
    case "Reopened":
      return "replay";
    case "DimensionsUpgraded":
      return "arrow-upward";
    case "TitleChanged":
      return "edit";
    case "AssignmentChanged":
      return "person";
    case "ai_analysis_begin":
      return "psychology";
    case "ai_analysis_complete":
      return "check";
    case "ai_analysis_failed":
      return "error-outline";
    case "ai_analysis_cancelled":
      return "cancel";
    default:
      return "circle";
  }
};

// Event badge color — resolves to a design token (var()) per event type.
// Semantic reuse: error/warning/success/info map to status primitives; AI +
// dimension events use the shared AI accent; the rest use categorical hues.
const getEventBadgeColor = (event: any): string => {
  switch (event.type) {
    case "Created":
      return "var(--color-indigo-500)";
    case "Alert":
      return "var(--color-amber-500)";
    case "SeverityUpgrade":
    case "SeverityOverride":
      return "var(--color-error-500)";
    case "Acknowledged":
      return "var(--color-blue-500)";
    case "Resolved":
      return "var(--color-success-600)";
    case "Reopened":
      return "var(--color-orange-500)";
    case "DimensionsUpgraded":
      return "var(--color-ai-accent)";
    case "TitleChanged":
      return "var(--color-indigo-500)";
    case "AssignmentChanged":
      return "var(--color-cyan-500)";
    case "ai_analysis_begin":
    case "ai_analysis_complete":
      return "var(--color-ai-accent)";
    case "ai_analysis_failed":
      return "var(--color-error-500)";
    case "ai_analysis_cancelled":
      return "var(--color-grey-500)";
    default:
      return "var(--color-grey-500)";
  }
};

// Get event badge text
const getEventBadgeText = (event: any): string => {
  switch (event.type) {
    case "Created":
      return t("alerts.incidents.timeline.badgeCreated");
    case "Alert":
      return t("alerts.incidents.timeline.badgeAlert");
    case "SeverityUpgrade":
      return t("alerts.incidents.timeline.badgeSeverityUpgraded");
    case "SeverityOverride":
      return t("alerts.incidents.timeline.badgeSeverityChanged");
    case "Acknowledged":
      return t("alerts.incidents.timeline.badgeAcknowledged");
    case "Resolved":
      return t("alerts.incidents.timeline.badgeResolved");
    case "Reopened":
      return t("alerts.incidents.timeline.badgeReopened");
    case "DimensionsUpgraded":
      return t("alerts.incidents.timeline.badgeDimensionsUpgraded");
    case "TitleChanged":
      return t("alerts.incidents.timeline.badgeTitleChanged");
    case "AssignmentChanged":
      return t("alerts.incidents.timeline.badgeAssignment");
    case "ai_analysis_begin":
      return t("alerts.incidents.timeline.badgeAiAnalysis");
    case "ai_analysis_complete":
      return t("alerts.incidents.timeline.badgeAiComplete");
    case "ai_analysis_failed":
      return t("alerts.incidents.timeline.badgeAiFailed");
    case "ai_analysis_cancelled":
      return t("alerts.incidents.timeline.badgeAiCancelled");
    default:
      // An event type the UI does not know yet — echo the server token verbatim.
      return raw(event.type);
  }
};

const AI_TYPES = [
  "ai_analysis_begin",
  "ai_analysis_complete",
  "ai_analysis_failed",
  "ai_analysis_cancelled",
];
const SEVERITY_TYPES = ["SeverityUpgrade", "SeverityOverride"];

// True only for the fixed "AI SRE" badge treatment: a system-authored AI
// event. A user-cancelled AI event goes through the normal badge instead.
const isAiLabelled = (event: any): boolean => {
  return getUserId(event) === "System" && AI_TYPES.includes(event.type);
};

// Where the badge sits relative to the inline text, mirroring the previous
// inline template branches: severity changes render their own chips inline
// and carry no separate badge; AI/Alert system events lead with the badge;
// every other system event trails it; user-authored events always lead.
const getEventLayout = (event: any): "no-badge" | "before" | "after" => {
  if (SEVERITY_TYPES.includes(event.type)) return "no-badge";
  const isSystemEvent = getUserId(event) === "System";
  if (!isSystemEvent) return "before";
  if (isAiLabelled(event) || event.type === "Alert") return "before";
  return "after";
};

// Get severity color based on priority level
const getSeverityColor = (severity: string): string => {
  switch (severity) {
    case "P1":
      return "var(--color-error-500)"; // red
    case "P2":
      return "var(--color-orange-500)"; // orange
    case "P3":
      return "var(--color-amber-500)"; // amber
    case "P4":
      return "var(--color-blue-500)"; // blue
    case "P5":
      return "var(--color-grey-500)"; // gray
    default:
      return "var(--color-grey-500)"; // gray
  }
};

// Get inline event text for status/label changes
const getInlineEventText = (event: any): string => {
  const data = event.data;
  const eventColor = getEventBadgeColor(event);
  // Escape user-controlled strings before embedding in HTML (XSS prevention)
  const esc = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const bold = (text: string) =>
    `<span style="font-weight: 600; color: ${eventColor};">${esc(text)}</span>`;
  const severityBadge = (severity: string) =>
    // eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel rule must not scale with text or it smears at fractional zoom
    `<span style="display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-size: var(--text-2xs); font-weight: 600; background-color: color-mix(in srgb, ${getSeverityColor(severity)} ${isDark.value ? "31%" : "25%"}, transparent); color: ${isDark.value ? "var(--color-grey-0)" : getSeverityColor(severity)}; border: 1px solid color-mix(in srgb, ${getSeverityColor(severity)} ${isDark.value ? "38%" : "25%"}, transparent);">${esc(severity)}</span>`;
  const isSystemEvent = getUserId(event) === SYSTEM_USER_ID;

  // The badge sits next to this text (before it for system events, after the
  // username for user events), so several branches are deliberately sentence
  // fragments — "Incident was" + [Resolved], "alice" + [Resolved] + "the incident".
  switch (event.type) {
    case "Created":
    case "Acknowledged":
    case "Resolved":
    case "Reopened":
      return isSystemEvent
        ? t("alerts.incidents.timeline.incidentWas")
        : t("alerts.incidents.timeline.theIncident");

    case "Alert": {
      const alertName = bold(data.alert_name || t("alerts.incidents.timeline.unnamedAlert"));
      const count = Number(data.count ?? 0);
      return t("alerts.incidents.timeline.alertTriggered", { alert: alertName, count }, count);
    }

    case "SeverityUpgrade": {
      const from = severityBadge(data.from);
      const to = severityBadge(data.to);
      if (isSystemEvent) {
        return data.reason
          ? t("alerts.incidents.timeline.severityUpgradedWithReason", {
              from,
              to,
              reason: esc(data.reason),
            })
          : t("alerts.incidents.timeline.severityUpgraded", { from, to });
      }
      return data.reason
        ? t("alerts.incidents.timeline.userChangedSeverityWithReason", {
            from,
            to,
            reason: esc(data.reason),
          })
        : t("alerts.incidents.timeline.userChangedSeverity", { from, to });
    }

    case "SeverityOverride": {
      const from = severityBadge(data.from);
      const to = severityBadge(data.to);
      return isSystemEvent
        ? t("alerts.incidents.timeline.severityChanged", { from, to })
        : t("alerts.incidents.timeline.userChangedSeverity", { from, to });
    }

    case "TitleChanged":
      return t("alerts.incidents.timeline.renamedFromTo", {
        from: bold(data.from),
        to: bold(data.to),
      });

    case "AssignmentChanged":
      return data.to
        ? t("alerts.incidents.timeline.assignedTo", { user: bold(data.to) })
        : t("alerts.incidents.timeline.assignmentRemoved");

    case "DimensionsUpgraded":
      return t("alerts.incidents.timeline.correlationKeyUpgraded");

    case "ai_analysis_begin":
      return t("alerts.incidents.timeline.aiStarted");

    case "ai_analysis_complete":
      return t("alerts.incidents.timeline.aiFinished");

    case "ai_analysis_failed":
      return bold(data.reason || t("alerts.incidents.timeline.analysisFailed"));

    // A user-cancelled event carries user_id, so it renders through the user-event
    // branch which already prefixes the username — don't repeat it here.
    case "ai_analysis_cancelled":
      return data.user_id
        ? t("alerts.incidents.timeline.userCancelledAnalysis")
        : t("alerts.incidents.timeline.analysisCancelled");

    default:
      return "";
  }
};

const getSanitizedInlineHtml = (event: any): string => DOMPurify.sanitize(getInlineEventText(event));

const getCommentBody = (event: any): string => event.data?.comment || "";

// Get tooltip text for AI analysis failure events
const getFailureTooltip = (event: any): I18nText | undefined => {
  return event.data?.error_details ? raw(event.data.error_details) : undefined;
};

// Format relative time
const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp / 1000; // Convert microseconds to milliseconds

  if (diff < 60000) return t("alerts.incidents.timeline.justNow");

  const minutes = Math.floor(diff / 60000);
  if (diff < 3600000) return t("alerts.incidents.timeline.minuteAgo", { count: minutes });

  const hours = Math.floor(diff / 3600000);
  if (diff < 86400000) return t("alerts.incidents.timeline.hourAgo", { count: hours });

  const days = Math.floor(diff / 86400000);
  if (diff < 604800000) return t("alerts.incidents.timeline.dayAgo", { count: days });

  return formatToDateOnly(timestamp);
};

watch(
  () => props.visible,
  async (visible) => {
    if (visible && props.incidentId) {
      await fetchEvents();
      await scrollToBottom();
    }
  },
);

// Watch for refresh trigger from parent component
watch(
  () => props.refreshTrigger,
  async (newVal, oldVal) => {
    if (newVal !== oldVal && props.visible && props.incidentId) {
      await fetchEvents();
      await scrollToBottom();
    }
  },
);

onMounted(async () => {
  if (props.visible && props.incidentId) {
    await fetchEvents();
    await scrollToBottom();
  }
});

// Expose fetchEvents method so parent component can call it
defineExpose({
  fetchEvents,
});
</script>
