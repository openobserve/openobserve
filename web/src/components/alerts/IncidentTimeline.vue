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
import { getActivityAvatarColor, formatActivityRelativeTime } from "@/utils/activityTimeline";

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

// Get user ID from event
const getUserId = (event: any): string => {
  return event.data?.user_id || "System";
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
      return "Created";
    case "Alert":
      return "Alert";
    case "SeverityUpgrade":
      return "Severity Upgraded";
    case "SeverityOverride":
      return "Severity Changed";
    case "Acknowledged":
      return "Acknowledged";
    case "Resolved":
      return "Resolved";
    case "Reopened":
      return "Reopened";
    case "DimensionsUpgraded":
      return "Dimensions Upgraded";
    case "TitleChanged":
      return "Title Changed";
    case "AssignmentChanged":
      return "Assignment";
    case "ai_analysis_begin":
      return "AI Analysis";
    case "ai_analysis_complete":
      return "AI Complete";
    case "ai_analysis_failed":
      return "AI Failed";
    case "ai_analysis_cancelled":
      return "AI Cancelled";
    default:
      return event.type;
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
    `<span style="display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px; font-size: var(--text-2xs); font-weight: 600; background-color: color-mix(in srgb, ${getSeverityColor(severity)} ${isDark.value ? "31%" : "25%"}, transparent); color: ${isDark.value ? "var(--color-grey-0)" : getSeverityColor(severity)}; border: 1px solid color-mix(in srgb, ${getSeverityColor(severity)} ${isDark.value ? "38%" : "25%"}, transparent);">${esc(severity)}</span>`;
  const isSystemEvent = getUserId(event) === "System";

  switch (event.type) {
    case "Created":
      return isSystemEvent ? `Incident was` : `the incident`;

    case "Alert":
      return data.count === 1
        ? `${bold(data.alert_name || "alert")} triggered`
        : `${bold(data.alert_name || "alert")} triggered ${data.count} times`;

    case "Acknowledged":
      return isSystemEvent ? `Incident was` : `the incident`;

    case "Resolved":
      return isSystemEvent ? `Incident was` : `the incident`;

    case "Reopened":
      return isSystemEvent ? `Incident was` : `the incident`;

    case "SeverityUpgrade":
      return isSystemEvent
        ? `Severity upgraded from ${severityBadge(data.from)} to ${severityBadge(data.to)}` +
            (data.reason ? ` - ${esc(data.reason)}` : "")
        : `changed the severity from ${severityBadge(data.from)} to ${severityBadge(data.to)}` +
            (data.reason ? ` - ${esc(data.reason)}` : "");

    case "SeverityOverride":
      return isSystemEvent
        ? `Severity changed from ${severityBadge(data.from)} to ${severityBadge(data.to)}`
        : `changed the severity from ${severityBadge(data.from)} to ${severityBadge(data.to)}`;

    case "TitleChanged":
      return `renamed from ${bold(data.from)} to ${bold(data.to)}`;

    case "AssignmentChanged":
      return data.to ? `Assigned to ${bold(data.to)}` : "Assignment removed";

    case "DimensionsUpgraded":
      return "Correlation key was upgraded";

    case "ai_analysis_begin":
      return "Started analyzing the incident";

    case "ai_analysis_complete":
      return "Finished the analysis";

    case "ai_analysis_failed":
      return bold(data.reason || "Analysis failed");

    // A user-cancelled event carries user_id, so it renders through the user-event
    // branch which already prefixes the username — don't repeat it here.
    case "ai_analysis_cancelled":
      return data.user_id ? "cancelled the analysis" : "Analysis cancelled";

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

const formatRelativeTime = formatActivityRelativeTime;

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
