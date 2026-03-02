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
  <div class="incident-timeline tw:flex tw:flex-col tw:h-full">

    <!-- Loading -->
    <div v-if="loading" class="tw:flex tw:justify-center tw:items-center tw:py-12">
      <q-spinner-dots size="40px" color="primary" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="events.length === 0"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:py-16 tw:text-gray-500"
    >
      <q-icon name="forum" size="56px" class="tw:mb-3 tw:opacity-40" />
      <div class="tw:text-base tw:font-medium tw:mb-1">No activity yet</div>
      <div class="tw:text-sm tw:text-gray-400">Events and comments will appear here</div>
    </div>

    <!-- Activity Feed with Timeline -->
    <div v-else class="tw:flex-1 tw:flex tw:flex-col tw:min-h-0 tw:relative">
      <!-- Scroll buttons -->
      <div class="tw:absolute tw:top-2 tw:right-3 tw:flex tw:flex-col tw:gap-1 tw:z-10">
        <q-btn
          round
          unelevated
          dense
          size="xs"
          icon="keyboard_arrow_up"
          color="grey-6"
          @click="scrollToTop"
          data-test="incident-timeline-scroll-top"
        >
          <q-tooltip>Scroll to top</q-tooltip>
        </q-btn>
        <q-btn
          round
          unelevated
          dense
          size="xs"
          icon="keyboard_arrow_down"
          color="grey-6"
          @click="scrollToBottom"
          data-test="incident-timeline-scroll-bottom"
        >
          <q-tooltip>Scroll to bottom</q-tooltip>
        </q-btn>
      </div>

      <div ref="timelineContainer" class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:px-3 tw:pt-2 tw:pb-4">
        <div class="tw:relative">
        <!-- Vertical Timeline Line -->
        <div
          class="tw:absolute tw:left-3 tw:top-0 tw:bottom-0 tw:w-0.5"
          :style="{
            backgroundColor: store.state.theme === 'dark' ? '#2d333b' : '#e5e7eb',
            marginTop: '12px',
            marginBottom: '12px'
          }"
        ></div>

        <!-- Events -->
        <div class="tw:relative tw:space-y-4">
          <div
            v-for="(event, index) in events"
            :key="index"
            class="tw:relative"
          >
            <!-- INLINE EVENTS (Status/Label Changes) -->
            <template v-if="!isCommentEvent(event)">
              <div class="tw:flex tw:items-center tw:gap-3">
                <!-- Avatar for user events or Icon for system events -->
                <div class="tw:flex-shrink-0">
                  <!-- User Avatar -->
                  <div
                    v-if="getUserId(event) !== 'System'"
                    class="tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:z-10 tw:relative"
                    :style="{
                      backgroundColor: store.state.theme === 'dark' ? '#181a1b' : '#ffffff',
                      border: store.state.theme === 'dark' ? '1px solid #444c56' : '1px solid #d0d7de'
                    }"
                  >
                    <q-icon
                      name="person"
                      size="12px"
                      :style="{ color: getAvatarColor(getUserId(event)) }"
                    />
                  </div>
                  <!-- System Event Icon -->
                  <div
                    v-else
                    class="tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:z-10 tw:relative"
                    :style="{
                      backgroundColor: store.state.theme === 'dark' ? '#2d333b' : '#f6f8fa',
                      border: store.state.theme === 'dark' ? '1px solid #444c56' : '1px solid #d0d7de'
                    }"
                  >
                    <q-icon
                      :name="getEventIcon(event)"
                      size="14px"
                      :style="{ color: getEventBadgeColor(event) }"
                    />
                  </div>
                </div>

                <!-- Event Description -->
                <div class="tw:flex-1">
                  <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                    <!-- For User Events: username, badge, text -->
                    <template v-if="getUserId(event) !== 'System'">
                      <span
                        class="tw:font-semibold tw:text-sm"
                        :class="store.state.theme === 'dark' ? 'tw:text-gray-100' : 'tw:text-gray-900'"
                      >
                        {{ getUserId(event) }}
                      </span>
                      <span
                        v-if="event.type !== 'SeverityUpgrade' && event.type !== 'SeverityOverride'"
                        class="tw:inline-flex tw:items-center tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold"
                        :style="{
                          backgroundColor: store.state.theme === 'dark' ? getEventBadgeColor(event) + '30' : getEventBadgeColor(event) + '15',
                          border: `1px solid ${getEventBadgeColor(event)}${store.state.theme === 'dark' ? '50' : '30'}`,
                          color: store.state.theme === 'dark' ? '#ffffff' : getEventBadgeColor(event)
                        }"
                      >
                        {{ getEventBadgeText(event) }}
                      </span>
                      <span class="tw:text-sm"
                        :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'"
                        v-html="getInlineEventText(event)"
                      ></span>
                    </template>
                    <!-- For System Events: text, badge -->
                    <template v-else>
                      <!-- For Alert events, show badge first -->
                      <span
                        v-if="event.type === 'Alert'"
                        class="tw:inline-flex tw:items-center tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold"
                        :style="{
                          backgroundColor: store.state.theme === 'dark' ? getEventBadgeColor(event) + '30' : getEventBadgeColor(event) + '15',
                          border: `1px solid ${getEventBadgeColor(event)}${store.state.theme === 'dark' ? '50' : '30'}`,
                          color: store.state.theme === 'dark' ? '#ffffff' : getEventBadgeColor(event)
                        }"
                      >
                        {{ getEventBadgeText(event) }}
                      </span>
                      <span class="tw:text-sm"
                        :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'"
                        v-html="getInlineEventText(event)"
                      ></span>
                      <!-- For other system events (except Severity changes and Alert), show badge after text -->
                      <span
                        v-if="event.type !== 'SeverityUpgrade' && event.type !== 'SeverityOverride' && event.type !== 'Alert'"
                        class="tw:inline-flex tw:items-center tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold"
                        :style="{
                          backgroundColor: store.state.theme === 'dark' ? getEventBadgeColor(event) + '30' : getEventBadgeColor(event) + '15',
                          border: `1px solid ${getEventBadgeColor(event)}${store.state.theme === 'dark' ? '50' : '30'}`,
                          color: store.state.theme === 'dark' ? '#ffffff' : getEventBadgeColor(event)
                        }"
                      >
                        {{ getEventBadgeText(event) }}
                      </span>
                    </template>
                    <span class="tw:text-xs"
                      :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                    >
                      {{ formatRelativeTime(event.timestamp) }}
                    </span>
                  </div>
                </div>
              </div>
            </template>

            <!-- COMMENT EVENTS (Card Style) -->
            <template v-else>
              <div class="tw:flex tw:gap-3">
                <!-- Avatar -->
                <div class="tw:flex-shrink-0">
                  <div
                    class="tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:z-10 tw:relative"
                    :style="{
                      backgroundColor: store.state.theme === 'dark' ? '#181a1b' : '#ffffff',
                      border: store.state.theme === 'dark' ? '1px solid #444c56' : '1px solid #d0d7de'
                    }"
                  >
                    <q-icon
                      name="person"
                      size="12px"
                      :style="{ color: getAvatarColor(getUserId(event)) }"
                    />
                  </div>
                </div>

                <!-- Comment Card -->
                <div class="tw:flex-1 tw:min-w-0">
                  <!-- Comment Box -->
                  <div
                    class="tw:rounded-lg tw:overflow-hidden tw:shadow-sm hover:tw:shadow-md tw:transition-shadow"
                    :style="store.state.theme === 'dark'
                      ? { backgroundColor: '#181a1b', border: '1px solid #3f4447' }
                      : { backgroundColor: '#ffffff', border: '1px solid #d1d5db' }"
                  >
                    <!-- Header -->
                    <div
                      class="tw:px-4 tw:py-2 tw:flex tw:items-center tw:gap-2 tw:border-b"
                      :style="store.state.theme === 'dark'
                        ? { backgroundColor: '#0f1011', borderBottomColor: '#3f4447' }
                        : { backgroundColor: '#f9fafb', borderBottomColor: '#e5e7eb' }"
                    >
                      <span class="tw:font-semibold tw:text-sm"
                        :class="store.state.theme === 'dark' ? 'tw:text-gray-100' : 'tw:text-gray-900'"
                      >
                        {{ getUserId(event) }}
                      </span>
                      <span class="tw:text-xs"
                        :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                      >
                        commented {{ formatRelativeTime(event.timestamp) }}
                      </span>
                    </div>

                    <!-- Comment Body -->
                    <div class="tw:px-4 tw:py-3">
                      <div class="tw:text-sm tw:whitespace-pre-wrap tw:break-words tw:leading-relaxed"
                        :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-800'"
                      >
                        {{ event.data?.comment || '' }}
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
    <div class="tw:p-4">
      <div class="tw:flex tw:gap-3">
        <!-- Current User Avatar -->
        <div class="tw:flex-shrink-0 tw:pt-1">
          <div
            class="tw:w-6 tw:h-6 tw:rounded-full tw:flex tw:items-center tw:justify-center"
            :style="{
              backgroundColor: store.state.theme === 'dark' ? '#181a1b' : '#ffffff',
              border: store.state.theme === 'dark' ? '1px solid #444c56' : '1px solid #d0d7de'
            }"
          >
            <q-icon
              name="person"
              size="12px"
              :style="{ color: getAvatarColor(getCurrentUserId()) }"
            />
          </div>
        </div>

        <!-- Input Area -->
        <div class="tw:flex-1 tw:relative">
          <q-input
            v-model="commentText"
            type="textarea"
            outlined
            placeholder="Write a comment..."
            :rows="3"
            class="comment-input"
            @keydown.ctrl.enter.prevent="submitComment"
            @keydown.meta.enter.prevent="submitComment"
            data-test="incident-timeline-comment-input"
          />

          <!-- Send button inside textarea -->
          <div class="tw:absolute tw:bottom-3 tw:right-3">
            <q-btn
              icon="send"
              round
              unelevated
              color="primary"
              size="sm"
              :disable="!commentText.trim() || submitting"
              :loading="submitting"
              @click="submitComment"
              class="tw:shadow-sm"
              data-test="incident-timeline-comment-send"
            >
              <q-tooltip>Send comment</q-tooltip>
            </q-btn>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { date } from "quasar";
import incidentsService from "@/services/incidents";

interface Props {
  orgId: string;
  incidentId: string;
  visible: boolean;
  refreshTrigger?: number;
}

const props = defineProps<Props>();

const store = useStore();
const q = useQuasar();

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
    q.notify({
      type: "positive",
      message: "Comment posted successfully",
      timeout: 2000,
    });
  } catch (e: any) {
    q.notify({
      type: "negative",
      message: "Failed to post comment",
      timeout: 2000,
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

// Get initials from username
const getInitials = (username: string): string => {
  if (!username || username === "System") return "S";

  // Handle email addresses
  if (username.includes("@")) {
    username = username.split("@")[0];
  }

  const parts = username.split(/[\s_.-]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return username.substring(0, 2).toUpperCase();
};

// Get current user initials
const getCurrentUserInitials = (): string => {
  return getInitials(getCurrentUserId());
};

// Get avatar color based on username
const getAvatarColor = (username: string): string => {
  const colors = [
    "#EF4444", // red
    "#F59E0B", // amber
        "#8B5CF6", // purple

    "#3B82F6", // blue
        "#10B981", // green
    "#EC4899", // pink
    "#06B6D4", // cyan
    "#F97316", // orange
    "#14B8A6", // teal
    "#6366F1", // indigo
  ];

  const firstChar = username.charAt(0).toUpperCase();
  const charCode = firstChar.charCodeAt(0);
  const colorIndex = charCode % colors.length;
  return colors[colorIndex];
};

// Get event icon
const getEventIcon = (event: any): string => {
  switch (event.type) {
    case "Created": return "add_circle";
    case "Alert": return "notifications";
    case "SeverityUpgrade":
    case "SeverityOverride": return "warning";
    case "Acknowledged": return "check_circle";
    case "Resolved": return "check";
    case "Reopened": return "replay";
    case "DimensionsUpgraded": return "upgrade";
    case "TitleChanged": return "edit";
    case "AssignmentChanged": return "person_add";
    case "ai_analysis_begin": return "psychology";
    case "ai_analysis_complete": return "check";
    default: return "circle";
  }
};

// Get event badge color
const getEventBadgeColor = (event: any): string => {
  switch (event.type) {
    case "Created": return "#6366F1"; // indigo
    case "Alert": return "#F59E0B"; // amber
    case "SeverityUpgrade":
    case "SeverityOverride": return "#EF4444"; // red
    case "Acknowledged": return "#3B82F6"; // blue
    case "Resolved": return "#059669"; // darker green
    case "Reopened": return "#F97316"; // orange
    case "DimensionsUpgraded": return "#8B5CF6"; // purple
    case "TitleChanged": return "#6366F1"; // indigo
    case "AssignmentChanged": return "#06B6D4"; // cyan
    case "ai_analysis_begin":
    case "ai_analysis_complete": return "#8B5CF6"; // purple
    default: return "#6B7280"; // gray
  }
};

// Get event badge text
const getEventBadgeText = (event: any): string => {
  switch (event.type) {
    case "Created": return "Created";
    case "Alert": return "Alert";
    case "SeverityUpgrade": return "Severity Upgraded";
    case "SeverityOverride": return "Severity Changed";
    case "Acknowledged": return "Acknowledged";
    case "Resolved": return "Resolved";
    case "Reopened": return "Reopened";
    case "DimensionsUpgraded": return "Dimensions Upgraded";
    case "TitleChanged": return "Title Changed";
    case "AssignmentChanged": return "Assignment";
    case "ai_analysis_begin": return "AI Analysis";
    case "ai_analysis_complete": return "AI Complete";
    default: return event.type;
  }
};

// Get severity color based on priority level
const getSeverityColor = (severity: string): string => {
  switch (severity) {
    case "P1": return "#EF4444"; // red
    case "P2": return "#F97316"; // orange
    case "P3": return "#F59E0B"; // amber
    case "P4": return "#3B82F6"; // blue
    case "P5": return "#6B7280"; // gray
    default: return "#6B7280"; // gray
  }
};

// Get inline event text for status/label changes
const getInlineEventText = (event: any): string => {
  const data = event.data;
  const eventColor = getEventBadgeColor(event);
  const isDark = store.state.theme === 'dark';
  const opacity = isDark ? '50' : '40';
  const bold = (text: string) => `<span style="font-weight: 600; color: ${eventColor};">${text}</span>`;
  const severityBadge = (severity: string) => `<span style="display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background-color: ${getSeverityColor(severity)}${opacity}; color: ${isDark ? '#ffffff' : getSeverityColor(severity)}; border: 1px solid ${getSeverityColor(severity)}${isDark ? '60' : '40'};">${severity}</span>`;
  const isSystemEvent = getUserId(event) === 'System';

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
        ? `Severity upgraded from ${severityBadge(data.from)} to ${severityBadge(data.to)}` + (data.reason ? ` - ${data.reason}` : '')
        : `changed the severity from ${severityBadge(data.from)} to ${severityBadge(data.to)}` + (data.reason ? ` - ${data.reason}` : '');

    case "SeverityOverride":
      return isSystemEvent
        ? `Severity changed from ${severityBadge(data.from)} to ${severityBadge(data.to)}`
        : `changed the severity from ${severityBadge(data.from)} to ${severityBadge(data.to)}`;

    case "TitleChanged":
      return `renamed from ${bold(data.from)} to ${bold(data.to)}`;

    case "AssignmentChanged":
      return data.to
        ? `Assigned to ${bold(data.to)}`
        : "Assignment removed";

    case "DimensionsUpgraded":
      return "Correlation key was upgraded";

    case "ai_analysis_begin":
      return "AI analysis started";

    case "ai_analysis_complete":
      return "AI analysis completed";

    default:
      return "";
  }
};

// Format relative time
const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp / 1000; // Convert microseconds to milliseconds

  if (diff < 60000) return "just now";

  const minutes = Math.floor(diff / 60000);
  if (diff < 3600000) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(diff / 3600000);
  if (diff < 86400000) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(diff / 86400000);
  if (diff < 604800000) return `${days} day${days === 1 ? '' : 's'} ago`;

  return date.formatDate(timestamp / 1000, "MMM D, YYYY");
};

watch(() => props.visible, async (visible) => {
  if (visible && props.incidentId) {
    await fetchEvents();
    await nextTick();
    scrollToBottom();
  }
});

// Watch for refresh trigger from parent component
watch(() => props.refreshTrigger, async (newVal, oldVal) => {
  if (newVal !== oldVal && props.visible && props.incidentId) {
    await fetchEvents();
    await nextTick();
    scrollToBottom();
  }
});

onMounted(async () => {
  if (props.visible && props.incidentId) {
    await fetchEvents();
    await nextTick();
    scrollToBottom();
  }
});

// Expose fetchEvents method so parent component can call it
defineExpose({
  fetchEvents
});
</script>

<style scoped lang="scss">
.incident-timeline {
  min-height: 400px;
}

.comment-input {
  :deep(.q-field__control) {
    border-radius: 6px;
  }

  :deep(textarea) {
    font-size: 14px;
    line-height: 1.5;
    padding-right: 50px !important;
    resize: none;
  }
}
</style>
