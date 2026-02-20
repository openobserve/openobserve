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
    <!-- Header with refresh -->
    <div class="tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-2 tw:border-b tw:border-gray-200 dark:tw:border-gray-700 tw:flex-shrink-0">
      <span class="tw:text-sm tw:text-gray-500">{{ events.length }} events</span>
      <q-btn
        icon="refresh"
        flat
        dense
        size="sm"
        :loading="loading"
        @click="fetchEvents"
        data-test="incident-timeline-refresh"
      >
        <q-tooltip>Refresh</q-tooltip>
      </q-btn>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="tw:flex tw:justify-center tw:items-center tw:py-8">
      <q-spinner-dots size="40px" color="primary" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="events.length === 0"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:py-8 tw:text-gray-500"
    >
      <q-icon name="history" size="48px" class="tw:mb-2 tw:opacity-50" />
      <div>No activity recorded yet</div>
    </div>

    <!-- Timeline -->
    <div v-else class="tw:flex-1 tw:overflow-y-auto tw:px-4 tw:py-2">
      <q-timeline color="primary">
        <q-timeline-entry
          v-for="(event, index) in events"
          :key="index"
          :icon="getEventIcon(event)"
          :color="getEventColor(event)"
          :subtitle="formatTimestamp(event.timestamp)"
        >
          <template #title>
            <span class="tw:text-sm tw:font-medium">{{ getEventTitle(event) }}</span>
          </template>
          <div v-if="getEventBody(event)" class="tw:text-sm tw:text-gray-600 dark:tw:text-gray-400">
            {{ getEventBody(event) }}
          </div>
        </q-timeline-entry>
      </q-timeline>
    </div>

    <!-- Comment input -->
    <div class="tw:flex tw:gap-2 tw:p-4 tw:border-t tw:border-gray-200 dark:tw:border-gray-700 tw:flex-shrink-0">
      <q-input
        v-model="commentText"
        dense
        borderless
        placeholder="Add a comment..."
        class="tw:flex-1"
        @keyup.enter="submitComment"
        data-test="incident-timeline-comment-input"
      />
      <q-btn
        icon="send"
        flat
        dense
        color="primary"
        :disable="!commentText.trim() || submitting"
        :loading="submitting"
        @click="submitComment"
        data-test="incident-timeline-comment-send"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { date } from "quasar";
import incidentsService from "@/services/incidents";

interface Props {
  orgId: string;
  incidentId: string;
  visible: boolean;
}

const props = defineProps<Props>();

const store = useStore();
const q = useQuasar();

const events = ref<any[]>([]);
const loading = ref(false);
const commentText = ref("");
const submitting = ref(false);

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

const getEventIcon = (event: any): string => {
  switch (event.type) {
    case "Created": return "add_circle";
    case "Alert": return "notifications";
    case "SeverityUpgrade": return "arrow_upward";
    case "SeverityOverride": return "edit";
    case "Acknowledged": return "check_circle";
    case "Resolved": return "done_all";
    case "Reopened": return "replay";
    case "DimensionsUpgraded": return "upgrade";
    case "AssignmentChanged": return "person";
    case "Comment": return "chat";
    case "ai_analysis_begin": return "psychology";
    case "ai_analysis_complete": return "psychology";
    default: return "circle";
  }
};

const getEventColor = (event: any): string => {
  switch (event.type) {
    case "Created": return "grey";
    case "Alert": return "orange";
    case "SeverityUpgrade": return "red";
    case "SeverityOverride": return "blue";
    case "Acknowledged": return "blue";
    case "Resolved": return "green";
    case "Reopened": return "orange";
    case "DimensionsUpgraded": return "purple";
    case "AssignmentChanged": return "blue";
    case "Comment": return "grey";
    case "ai_analysis_begin": return "purple";
    case "ai_analysis_complete": return "green";
    default: return "grey";
  }
};

const getEventTitle = (event: any): string => {
  const data = event.data;
  switch (event.type) {
    case "Created":
      return "Incident created";
    case "Alert":
      return data.count === 1
        ? `${data.alert_name || "Alert"} fired`
        : `${data.alert_name || "Alert"} fired ${data.count} times`;
    case "SeverityUpgrade":
      return `Severity ${data.from} \u2192 ${data.to}`;
    case "SeverityOverride":
      return `${data.user_id || "User"} changed severity ${data.from} \u2192 ${data.to}`;
    case "Acknowledged":
      return `Acknowledged by ${data.user_id || "user"}`;
    case "Resolved":
      return data.user_id ? `Resolved by ${data.user_id}` : "Auto-resolved";
    case "Reopened":
      return `Reopened by ${data.user_id || "user"}`;
    case "DimensionsUpgraded":
      return "Correlation upgraded";
    case "AssignmentChanged":
      return data.to ? `Assigned to ${data.to}` : "Unassigned";
    case "Comment":
      return data.user_id || "User";
    case "ai_analysis_begin":
      return "AI analysis started";
    case "ai_analysis_complete":
      return "AI analysis completed";
    default:
      return event.type;
  }
};

const getEventBody = (event: any): string | null => {
  const data = event.data;
  switch (event.type) {
    case "Alert":
      if (data.count > 1) {
        return `Between ${formatTimestamp(data.first_at)} and ${formatTimestamp(data.last_at)}`;
      }
      return null;
    case "SeverityUpgrade":
      return data.reason;
    case "Reopened":
      return data.reason;
    case "Comment":
      return data.comment;
    default:
      return null;
  }
};

const formatTimestamp = (micros: number): string => {
  if (!micros) return "";
  return date.formatDate(new Date(micros / 1000), "MMM D, HH:mm:ss");
};

watch(() => props.visible, (visible) => {
  if (visible && props.incidentId) {
    fetchEvents();
  }
});

onMounted(() => {
  if (props.visible && props.incidentId) {
    fetchEvents();
  }
});
</script>

<style scoped lang="scss">
.incident-timeline {
  min-height: 200px;
}
</style>
