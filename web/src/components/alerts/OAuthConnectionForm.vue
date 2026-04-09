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
  OAuthConnectionForm — Generic OAuth destination form.

  Handles:
  - availability check (falls back to legacy webhook form when OAuth not configured)
  - OAuth popup + polling
  - channel picker (for Slack / Discord)
  - duplicate channel warning
  - reconnect flow (token revoked)
  - test message button
  - emits save-ready data to parent
-->

<template>
  <div class="oauth-connection-form">
    <!-- Revoked / expired warning banner -->
    <q-banner
      v-if="isRevoked"
      class="q-mb-md text-white bg-negative"
      dense
      rounded
    >
      <template #avatar>
        <q-icon name="warning" />
      </template>
      ⚠ This {{ displayName }} connection has been revoked or expired. Click
      <strong>Reconnect</strong> to restore it.
    </q-banner>

    <!-- Connect / Reconnect button -->
    <div v-if="!isConnected" class="q-mb-md">
      <q-btn
        :loading="isConnecting"
        :label="isRevoked ? `Reconnect to ${displayName}` : `Connect to ${displayName}`"
        color="primary"
        icon="link"
        unelevated
        data-test="oauth-connect-btn"
        @click="startOAuthFlow"
      />
      <div v-if="cancelledMsg" class="text-caption text-grey q-mt-xs">
        {{ cancelledMsg }}
      </div>
    </div>

    <!-- Connected state -->
    <div v-else class="q-mb-md">
      <div class="row items-center q-gutter-sm">
        <q-icon name="check_circle" color="positive" size="20px" />
        <span class="text-body2">
          Connected to: <strong>{{ teamName }}</strong>
        </span>
        <q-btn
          flat
          dense
          size="sm"
          color="negative"
          label="Disconnect"
          @click="disconnect"
        />
      </div>
    </div>

    <!-- Channel picker (Slack / Discord) -->
    <div v-if="isConnected && hasChannelPicker" class="q-mb-md">
      <q-select
        v-model="selectedChannel"
        :options="filteredChannels"
        option-value="id"
        option-label="name"
        :label="`Channel *`"
        :hint="truncated ? 'Showing first 10,000 channels' : ''"
        use-input
        input-debounce="300"
        @filter="filterChannels"
        data-test="oauth-channel-select"
        borderless
        dense
        class="showLabelOnTop"
        stack-label
      >
        <template #option="scope">
          <q-item
            v-bind="scope.itemProps"
            :clickable="scope.opt.is_member"
            :class="{ 'text-grey cursor-not-allowed': !scope.opt.is_member }"
            @click="scope.opt.is_member ? scope.itemProps.onClick?.($event) : undefined"
          >
            <q-item-section>
              <q-item-label class="flex items-center q-gutter-xs">
                <q-icon
                  v-if="scope.opt.is_private"
                  name="lock"
                  size="12px"
                />
                <span>#{{ scope.opt.name }}</span>
                <q-chip
                  v-if="!scope.opt.is_member"
                  dense
                  size="xs"
                  color="grey-3"
                  text-color="grey-7"
                  class="q-ml-xs"
                >
                  invite needed
                </q-chip>
              </q-item-label>
            </q-item-section>
            <q-tooltip v-if="!scope.opt.is_member">
              Private channel — run
              <code>/invite @{{ displayName }}</code> in this channel first.
            </q-tooltip>
          </q-item>
        </template>
        <template #no-option>
          <q-item>
            <q-item-section class="text-grey">No channels found</q-item-section>
          </q-item>
        </template>
      </q-select>

      <!-- Duplicate channel warning -->
      <div v-if="duplicateWarning" class="text-caption text-warning q-mt-xs">
        ⚠ Channel #{{ selectedChannel?.name }} is already used by destination
        "{{ duplicateWarning }}". You can still save — multiple destinations can
        share the same channel.
      </div>
    </div>

    <!-- Test button -->
    <div v-if="isConnected" class="q-mt-sm">
      <q-btn
        flat
        dense
        color="primary"
        label="Send Test Message"
        icon="send"
        :loading="isTesting"
        :disable="hasChannelPicker && !selectedChannel"
        data-test="oauth-test-btn"
        @click="sendTest"
      />
      <span v-if="testResult" class="q-ml-sm text-caption" :class="testResult.ok ? 'text-positive' : 'text-negative'">
        {{ testResult.ok ? "Test sent successfully!" : `Test failed: ${testResult.error}` }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import oauthService, {
  type OAuthProvider,
  type ChannelItem,
} from "@/services/oauth_destinations";
import destinationService from "@/services/alert_destination";

// ---------------------------------------------------------------------------
// Props / emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  provider: OAuthProvider;
  /** Existing OAuthConnection data when editing */
  existingConnection?: {
    connection_id: string;
    team_id?: string;
    team_name?: string;
    channel_id?: string;
    channel_name?: string;
    status?: string;
  };
  displayName?: string;
}>();

const emit = defineEmits<{
  /** Emitted whenever the connection state changes; parent uses this to build the save payload */
  (
    e: "update",
    payload: {
      state?: string;
      connection_id: string;
      team_id?: string;
      team_name?: string;
      channel_id?: string;
      channel_name?: string;
      status: string;
      ready: boolean;
    }
  ): void;
}>();

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const store = useStore();
const orgId = computed(() => store.state.selectedOrganization.identifier);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const displayName = computed(() => props.displayName ?? props.provider);

// Connection state
const isConnected = ref(false);
const isConnecting = ref(false);
const teamName = ref<string>("");
const teamId = ref<string>("");
const currentState = ref<string>("");
const currentConnectionId = ref<string>("");
const cancelledMsg = ref<string>("");

// Revoked / expired
const isRevoked = computed(
  () =>
    props.existingConnection?.status === "revoked" ||
    props.existingConnection?.status === "token_expired"
);

// Channels
const hasChannelPicker = ref(false);
const channels = ref<ChannelItem[]>([]);
const channelFilter = ref("");
const filteredChannels = computed(() => {
  const q = channelFilter.value.toLowerCase();
  if (!q) return channels.value;
  return channels.value.filter((c) => c.name.toLowerCase().includes(q));
});
const selectedChannel = ref<ChannelItem | null>(null);
const truncated = ref(false);

// Duplicate warning
const duplicateWarning = ref<string>("");

// Test
const isTesting = ref(false);
const testResult = ref<{ ok: boolean; error?: string } | null>(null);

// Polling / popup
let pollInterval: ReturnType<typeof setInterval> | null = null;
let popupCheckInterval: ReturnType<typeof setInterval> | null = null;
let popupRef: Window | null = null;

// ---------------------------------------------------------------------------
// Init from existing connection (edit mode)
// ---------------------------------------------------------------------------

if (props.existingConnection && !isRevoked.value) {
  isConnected.value = true;
  teamName.value = props.existingConnection.team_name ?? "";
  teamId.value = props.existingConnection.team_id ?? "";
  currentConnectionId.value = props.existingConnection.connection_id;

  // Load channels for edit flow
  loadChannelsForEdit();

  if (props.existingConnection.channel_id) {
    selectedChannel.value = {
      id: props.existingConnection.channel_id,
      name: props.existingConnection.channel_name ?? "",
      is_private: false,
    };
  }
}

async function loadChannelsForEdit() {
  try {
    const resp = await oauthService.channels(orgId.value, props.provider, {
      connectionId: currentConnectionId.value,
    });
    hasChannelPicker.value = true;
    channels.value = resp.data.channels;
    truncated.value = resp.data.truncated;
  } catch (err: any) {
    if (err?.response?.data?.error === "token_revoked") {
      // The backend returned 422 — treat as revoked
      isConnected.value = false;
    }
  }
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

async function startOAuthFlow() {
  cancelledMsg.value = "";
  isConnecting.value = true;
  testResult.value = null;

  try {
    const startResp = await oauthService.start(
      orgId.value,
      props.provider,
      isRevoked.value ? props.existingConnection?.connection_id : undefined
    );

    const { oauth_url, state, connection_id } = startResp.data;
    currentState.value = state;
    currentConnectionId.value = connection_id;

    // Open popup
    popupRef = window.open(
      oauth_url,
      "_blank",
      "popup,width=620,height=720"
    );

    // Monitor popup closure — when popup closes, give the status poll
    // up to 6 more seconds to detect completion before treating it as cancelled.
    popupCheckInterval = setInterval(() => {
      if (popupRef?.closed) {
        clearInterval(popupCheckInterval!);
        popupCheckInterval = null;
        if (!isConnected.value) {
          // Don't cancel immediately — the /oauth-success page closes the popup
          // and the next status poll (every 2s) needs time to fire.
          setTimeout(() => {
            if (!isConnected.value) {
              isConnecting.value = false;
              cancelledMsg.value =
                "Authorization cancelled. Click Connect to try again.";
              clearPollInterval();
            }
          }, 6000);
        }
      }
    }, 500);

    // Poll status endpoint
    startPolling(state);
  } catch (err) {
    isConnecting.value = false;
    console.error("OAuth start error:", err);
  }
}

function startPolling(state: string) {
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  const started = Date.now();

  pollInterval = setInterval(async () => {
    if (Date.now() - started > TIMEOUT_MS) {
      clearPollInterval();
      isConnecting.value = false;
      cancelledMsg.value = "Authorization timed out. Click Connect to try again.";
      return;
    }

    try {
      const resp = await oauthService.status(
        orgId.value,
        props.provider,
        state
      );
      const { status, team_name, team_id, has_channel_picker } = resp.data;
      console.log(`[OAuth] poll → status=${status}`);

      if (status === "complete") {
        clearPollInterval();
        isConnecting.value = false;
        isConnected.value = true;
        teamName.value = team_name ?? "";
        teamId.value = team_id ?? "";
        hasChannelPicker.value = has_channel_picker;
        console.log(`[OAuth] status=complete, has_channel_picker=${has_channel_picker}, team=${team_name}`);

        if (has_channel_picker) {
          await loadChannels(state);
        }

        emitUpdate();
      } else if (status === "error") {
        clearPollInterval();
        isConnecting.value = false;
        cancelledMsg.value =
          resp.data.error_reason ?? "Authorization failed. Try again.";
      }
    } catch (err: any) {
      console.warn("[OAuth] poll error:", err?.response?.status, err?.response?.data ?? err?.message);
    }
  }, 2000);
}

async function loadChannels(state: string) {
  try {
    const resp = await oauthService.channels(orgId.value, props.provider, {
      state,
    });
    channels.value = resp.data.channels;
    truncated.value = resp.data.truncated;
    console.log(`[OAuth] Loaded ${channels.value.length} channels | isConnected=${isConnected.value} | hasChannelPicker=${hasChannelPicker.value}`);
  } catch (err: any) {
    console.error("[OAuth] Failed to load channels:", err?.response?.data ?? err);
  }
}

function filterChannels(val: string, update: (fn: () => void) => void) {
  channelFilter.value = val;
  update(() => {});
}

function disconnect() {
  isConnected.value = false;
  selectedChannel.value = null;
  channels.value = [];
  channelFilter.value = "";
  teamName.value = "";
  teamId.value = "";
  currentState.value = "";
  duplicateWarning.value = "";
  emitUpdate();
}

// ---------------------------------------------------------------------------
// Duplicate check
// ---------------------------------------------------------------------------

watch(selectedChannel, async (ch) => {
  duplicateWarning.value = "";
  if (!ch) return;
  // Guard: if a non-member channel somehow gets selected, clear it
  if (!ch.is_member) {
    selectedChannel.value = null;
    return;
  }

  try {
    const resp = await destinationService.list({
      org_identifier: orgId.value,
      module: "alert",
      page_num: 1,
      page_size: 1000,
      sort_by: "name",
      desc: false,
    });
    const list: any[] = resp.data?.list ?? [];
    const existing = list.find(
      (d) =>
        d.module?.destination_type?.type === "oauth" &&
        d.module?.destination_type?.provider === props.provider &&
        d.module?.destination_type?.channel_id === ch.id &&
        d.module?.destination_type?.connection_id !== currentConnectionId.value
    );
    if (existing) {
      duplicateWarning.value = existing.name;
    }
  } catch (_) {}

  emitUpdate();
});

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

async function sendTest() {
  isTesting.value = true;
  testResult.value = null;
  try {
    const params = currentState.value
      ? { state: currentState.value }
      : { connectionId: currentConnectionId.value };
    const resp = await oauthService.test(
      orgId.value,
      props.provider,
      params,
      selectedChannel.value?.id
    );
    testResult.value = { ok: resp.data.ok, error: resp.data.error };
  } catch (err: any) {
    testResult.value = { ok: false, error: err?.message ?? "Unknown error" };
  } finally {
    isTesting.value = false;
  }
}

// ---------------------------------------------------------------------------
// Emit helper
// ---------------------------------------------------------------------------

function emitUpdate() {
  emit("update", {
    state: currentState.value || undefined,
    connection_id: currentConnectionId.value,
    team_id: teamId.value || undefined,
    team_name: teamName.value || undefined,
    channel_id: selectedChannel.value?.id,
    channel_name: selectedChannel.value?.name,
    status: "valid",
    ready:
      isConnected.value &&
      (!hasChannelPicker.value || selectedChannel.value !== null),
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function clearPollInterval() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

onBeforeUnmount(() => {
  clearPollInterval();
  if (popupCheckInterval) {
    clearInterval(popupCheckInterval);
    popupCheckInterval = null;
  }
});
</script>

<style scoped>
.oauth-connection-form {
  width: 100%;
}
</style>
