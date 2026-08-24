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
  <div class="flex h-full min-h-100 flex-col">
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <OSpinner variant="dots" size="md" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="events.length === 0"
      class="text-text-muted flex flex-col items-center justify-center py-16"
    >
      <OIcon name="forum" class="mb-3 size-14! opacity-40" />
      <div class="mb-1 text-base font-medium">{{ t("alerts.incidents.noActivityYet") }}</div>
      <div class="text-text-muted text-sm">
        {{ t("alerts.incidents.eventsAndCommentsAppearHere") }}
      </div>
    </div>

    <!-- Activity Feed with Timeline -->
    <div v-else class="relative flex min-h-0 flex-1 flex-col">
      <!-- Scroll buttons -->
      <div class="absolute top-2 right-3 z-10 flex flex-col gap-1">
        <OButton
          variant="ghost-muted"
          size="icon-circle-sm"
          @click="scrollToTop"
          data-test="incident-timeline-scroll-top"
          ><OIcon name="keyboard-arrow-up" size="sm" /><OTooltip
            :content="t('alerts.incidents.scrollToTop')"
        /></OButton>
        <OButton
          variant="ghost-muted"
          size="icon-circle-sm"
          @click="scrollToBottom"
          data-test="incident-timeline-scroll-bottom"
          ><OIcon name="keyboard-arrow-down" size="sm" /><OTooltip
            :content="t('alerts.incidents.scrollToBottom')"
        /></OButton>
      </div>

      <div ref="timelineContainer" class="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-4">
        <div class="relative">
          <!-- Vertical Timeline Line -->
          <div class="bg-border-default absolute top-0 bottom-0 left-3 my-3 w-0.5"></div>

          <!-- Events -->
          <div class="relative space-y-4">
            <div v-for="(event, index) in events" :key="index" class="relative">
              <!-- INLINE EVENTS (Status/Label Changes) -->
              <template v-if="!isCommentEvent(event)">
                <div class="flex items-center gap-3">
                  <!-- Avatar for user events or Icon for system events -->
                  <div class="flex-shrink-0">
                    <!-- User Avatar -->
                    <div
                      v-if="getUserId(event) !== 'System'"
                      class="bg-surface-base border-border-default relative z-10 flex h-6 w-6 items-center justify-center rounded-full border"
                    >
                      <OIcon
                        name="person"
                        size="xs"
                        :style="{ color: getAvatarColor(getUserId(event)) }"
                      />
                    </div>
                    <!-- System Event Icon -->
                    <div
                      v-else
                      class="bg-surface-subtle border-border-default relative z-10 flex h-6 w-6 items-center justify-center rounded-full border"
                    >
                      <OIcon
                        :name="getEventIcon(event)"
                        size="sm"
                        :style="{ color: getEventBadgeColor(event) }"
                      />
                    </div>
                  </div>

                  <!-- Event Description -->
                  <div class="flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <!-- For User Events: username, badge, text -->
                      <template v-if="getUserId(event) !== 'System'">
                        <span class="text-sm font-semibold" :class="'text-text-body'">
                          {{ getUserId(event) }}
                        </span>
                        <span
                          v-if="
                            event.type !== 'SeverityUpgrade' && event.type !== 'SeverityOverride'
                          "
                          class="rounded-default inline-flex items-center px-2 py-0.5 text-xs font-semibold"
                          :style="badgeStyle(getEventBadgeColor(event))"
                        >
                          {{ getEventBadgeText(event) }}
                        </span>
                        <span
                          class="text-sm"
                          :class="'text-text-body'"
                          v-html="DOMPurify.sanitize(getInlineEventText(event))"
                        ></span>
                      </template>
                      <!-- For System Events: text, badge -->
                      <template v-else>
                        <!-- AI events: "AI SRE" badge first, then message text -->
                        <template
                          v-if="
                            event.type === 'ai_analysis_begin' ||
                            event.type === 'ai_analysis_complete' ||
                            event.type === 'ai_analysis_failed' ||
                            event.type === 'ai_analysis_cancelled'
                          "
                        >
                          <span
                            class="rounded-default inline-flex items-center px-2 py-0.5 text-xs font-semibold"
                            :style="badgeStyle(getEventBadgeColor(event))"
                          >
                            {{ t("alerts.incidents.aiSreBadge") }}
                            <OTooltip
                              v-if="event.type === 'ai_analysis_failed' && getFailureTooltip(event)"
                              :delay="300"
                              side="bottom"
                              align="start"
                              :max-width="'24rem'"
                              :content="raw(getFailureTooltip(event))"
                            />
                          </span>
                          <span
                            class="text-sm"
                            :class="'text-text-body'"
                            v-html="DOMPurify.sanitize(getInlineEventText(event))"
                          ></span>
                        </template>
                        <!-- For Alert events, show badge first -->
                        <template v-else-if="event.type === 'Alert'">
                          <span
                            class="rounded-default inline-flex items-center px-2 py-0.5 text-xs font-semibold"
                            :style="badgeStyle(getEventBadgeColor(event))"
                          >
                            {{ getEventBadgeText(event) }}
                          </span>
                          <span
                            class="text-sm"
                            :class="'text-text-body'"
                            v-html="DOMPurify.sanitize(getInlineEventText(event))"
                          ></span>
                        </template>
                        <!-- All other system events: text then badge (except severity changes) -->
                        <template v-else>
                          <span
                            class="text-sm"
                            :class="'text-text-body'"
                            v-html="DOMPurify.sanitize(getInlineEventText(event))"
                          ></span>
                          <span
                            v-if="
                              event.type !== 'SeverityUpgrade' && event.type !== 'SeverityOverride'
                            "
                            class="rounded-default inline-flex items-center px-2 py-0.5 text-xs font-semibold"
                            :style="badgeStyle(getEventBadgeColor(event))"
                          >
                            {{ getEventBadgeText(event) }}
                          </span>
                        </template>
                      </template>
                      <span class="text-xs" :class="'text-text-secondary'">
                        {{ formatRelativeTime(event.timestamp) }}
                      </span>
                    </div>
                  </div>
                </div>
              </template>

              <!-- COMMENT EVENTS (Card Style) -->
              <template v-else>
                <div class="flex gap-3">
                  <!-- Avatar -->
                  <div class="flex-shrink-0">
                    <div
                      class="bg-surface-base border-border-default relative z-10 flex h-6 w-6 items-center justify-center rounded-full border"
                    >
                      <OIcon
                        name="person"
                        size="xs"
                        :style="{ color: getAvatarColor(getUserId(event)) }"
                      />
                    </div>
                  </div>

                  <!-- Comment Card -->
                  <div class="min-w-0 flex-1">
                    <!-- Comment Box -->
                    <div
                      class="rounded-default bg-surface-base border-border-default overflow-hidden border transition-shadow hover:shadow-md"
                    >
                      <!-- Header -->
                      <div
                        class="bg-surface-subtle border-b-border-default flex items-center gap-2 border-b px-4 py-2"
                      >
                        <span class="text-sm font-semibold" :class="'text-text-body'">
                          {{ getUserDisplayName(event) }}
                        </span>
                        <span class="text-xs" :class="'text-text-secondary'">
                          {{ t("alerts.incidents.commentedPrefix") }}
                          {{ formatRelativeTime(event.timestamp) }}
                        </span>
                      </div>

                      <!-- Comment Body -->
                      <div class="px-4 py-3">
                        <div
                          class="text-sm leading-relaxed break-words whitespace-pre-wrap"
                          :class="'text-text-body'"
                        >
                          {{ event.data?.comment || "" }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Comment Input -->
    <div class="p-4">
      <div class="flex gap-3">
        <!-- Current User Avatar -->
        <div class="flex-shrink-0 pt-1">
          <div
            class="bg-surface-base border-border-default flex h-6 w-6 items-center justify-center rounded-full border"
          >
            <OIcon name="person" size="xs" :style="{ color: getAvatarColor(getCurrentUserId()) }" />
          </div>
        </div>

        <!-- Input Area -->
        <div class="relative flex-1">
          <OInput
            v-model="commentText"
            type="textarea"
            :placeholder="t('alerts.incidents.commentPlaceholder')"
            :rows="3"
            @keydown.ctrl.enter.prevent="submitComment"
            @keydown.meta.enter.prevent="submitComment"
            data-test="incident-timeline-comment-input"
          />

          <!-- Send button inside textarea -->
          <div class="absolute right-3 bottom-3">
            <OButton
              variant="primary"
              size="icon-circle-sm"
              :disabled="!commentText.trim() || submitting"
              :loading="submitting"
              @click="submitComment"
              data-test="incident-timeline-comment-send"
              ><OIcon name="send" size="sm" /><OTooltip
                :content="t('alerts.incidents.sendComment')"
            /></OButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useTheme } from "@/composables/useTheme";
import { formatToDateOnly } from "@/utils/date";
import incidentsService from "@/services/incidents";
import DOMPurify from "dompurify";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

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
const timelineContainer = ref<HTMLElement | null>(null);

const scrollToTop = () => {
  if (timelineContainer.value) timelineContainer.value.scrollTop = 0;
};

const scrollToBottom = () => {
  if (timelineContainer.value)
    timelineContainer.value.scrollTop = timelineContainer.value.scrollHeight;
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

// Display name for the event author: a real user id renders verbatim, the
// system sentinel renders translated.
const getUserDisplayName = (event: any): I18nText => {
  const userId = getUserId(event);
  return userId === SYSTEM_USER_ID ? t("alerts.incidents.systemUser") : raw(userId);
};

// Get current user ID
const getCurrentUserId = (): string => {
  return store.state.userInfo?.email?.split("@")[0] || "User";
};

// Get avatar color based on username
const getAvatarColor = (username: string): string => {
  const colors = [
    "var(--color-error-500)", // red
    "var(--color-amber-500)", // amber
    "var(--color-ai-accent)", // purple

    "var(--color-blue-500)", // blue
    "var(--color-success-500)", // green
    "var(--color-purple-500)", // pink
    "var(--color-cyan-500)", // cyan
    "var(--color-orange-500)", // orange
    "var(--color-teal-500)", // teal
    "var(--color-indigo-500)", // indigo
  ];

  const firstChar = username.charAt(0).toUpperCase();
  const charCode = firstChar.charCodeAt(0);
  const colorIndex = charCode % colors.length;
  return colors[colorIndex];
};

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

// Build the badge inline style from an event color token. Tint strengths are
// theme-conditional (denser bg/border + white text in dark) via color-mix, so
// the token stays the single color source. (Theme read migrates in the D19/D20 sweep.)
const badgeStyle = (c: string) => {
  return {
    backgroundColor: `color-mix(in srgb, ${c} ${isDark.value ? "19%" : "8%"}, transparent)`,
    // eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel rule must not scale with text or it smears at fractional zoom
    border: `1px solid color-mix(in srgb, ${c} ${isDark.value ? "31%" : "19%"}, transparent)`,
    color: isDark.value ? "var(--color-grey-0)" : c,
  };
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

// Get tooltip text for AI analysis failure events
const getFailureTooltip = (event: any): string => {
  return event.data?.error_details || "";
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
      await nextTick();
      scrollToBottom();
    }
  },
);

// Watch for refresh trigger from parent component
watch(
  () => props.refreshTrigger,
  async (newVal, oldVal) => {
    if (newVal !== oldVal && props.visible && props.incidentId) {
      await fetchEvents();
      await nextTick();
      scrollToBottom();
    }
  },
);

onMounted(async () => {
  if (props.visible && props.incidentId) {
    await fetchEvents();
    await nextTick();
    scrollToBottom();
  }
});

// Expose fetchEvents method so parent component can call it
defineExpose({
  fetchEvents,
});
</script>
