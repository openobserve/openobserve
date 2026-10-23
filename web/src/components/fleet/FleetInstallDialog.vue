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
  <ODialog
    :open="open"
    size="xl"
    :title="t('fleet.addCollector')"
    :sub-title="t('fleet.install.subtitle')"
    :primary-button-label="t('fleet.common.done')"
    data-test="fleet-install-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <div
        v-if="tokensLoading"
        class="flex justify-center py-6"
        data-test="fleet-install-dialog-tokens-loading"
      >
        <OSpinner />
      </div>
      <div v-else-if="tokensForbidden" data-test="fleet-install-dialog-tokens-forbidden">
        <OEmptyState size="block" preset="no-access" />
      </div>
      <div v-else-if="tokensFailed" data-test="fleet-install-dialog-tokens-error">
        <OEmptyState size="block" preset="load-error" @action="retryTokens" />
      </div>
      <div
        v-else-if="pendingTokenId && !selectedId"
        class="flex justify-center py-6"
        data-test="fleet-install-dialog-token-pending"
      >
        <OSpinner />
      </div>
      <div
        v-else-if="!activeTokens.length"
        class="flex flex-col gap-4"
        data-test="fleet-install-dialog-no-token"
      >
        <OBanner variant="info" dense>
          <span class="font-medium">{{ t("fleet.install.noTokenTitle") }}</span>
          {{ t("fleet.install.noTokenBody") }}
        </OBanner>
        <OText variant="meta" data-test="fleet-install-dialog-security-note"
          >{{ t("fleet.enrollment.securityNote") }}
          {{ t("fleet.install.envRefNote", { ref: ENV_REF }) }}</OText
        >
        <FleetTokenForm :fleet-id="fleetId" @created="onTokenCreated" />
      </div>
      <template v-else>
        <OSelect
          v-model="selectedId"
          :label="t('fleet.install.token')"
          :options="tokenOptions"
          data-test="fleet-install-dialog-token"
        />
        <OText v-if="joinsText" variant="meta" data-test="fleet-install-dialog-fleet">{{
          joinsText
        }}</OText>
        <OBanner
          v-if="createdHere"
          variant="warning"
          dense
          :content="t('fleet.enrollment.copyOnce')"
          data-test="fleet-install-dialog-copy-once"
        />
        <OBanner
          v-if="!secret"
          variant="warning"
          dense
          :content="
            t('fleet.install.placeholderHint', {
              name: raw(selectedTokenName),
              placeholder: TOKEN_PLACEHOLDER,
            })
          "
          data-test="fleet-install-dialog-placeholder-hint"
        >
          <template #actions>
            <OButton
              variant="outline"
              size="sm"
              data-test="fleet-install-dialog-new-token"
              @click="creatingHere = !creatingHere"
            >
              {{ t("fleet.enrollment.newToken") }}
            </OButton>
          </template>
        </OBanner>
        <FleetTokenForm
          v-if="!secret && creatingHere"
          :fleet-id="fleetId"
          data-test="fleet-install-dialog-inline-token-form"
          @created="onTokenCreated"
        />
        <FleetInstallCommand :token="secret ?? TOKEN_PLACEHOLDER" />
        <OText variant="meta" data-test="fleet-install-dialog-security-note"
          >{{ t("fleet.enrollment.securityNote") }}
          {{ t("fleet.install.envRefNote", { ref: ENV_REF }) }}</OText
        >
        <div aria-live="polite" data-test="fleet-install-dialog-status">
          <OEmptyState
            v-if="collectorsForbidden"
            size="inline"
            preset="no-access"
            data-test="fleet-install-dialog-collectors-forbidden"
          />
          <OEmptyState
            v-else-if="collectors.error.value"
            size="inline"
            preset="load-error"
            data-test="fleet-install-dialog-collectors-error"
            @action="retryCollectors"
          />
          <OBanner
            v-else-if="connected"
            variant="success"
            dense
            data-test="fleet-install-dialog-connected"
          >
            {{ t("fleet.install.connected", { name: raw(connected.name) }) }}
            <template #actions>
              <OButton
                variant="outline"
                size="sm"
                data-test="fleet-install-dialog-view-collectors"
                @click="viewCollectors"
              >
                {{ t("fleet.install.viewCollectors") }}
              </OButton>
            </template>
          </OBanner>
          <OBanner
            v-else-if="baseline"
            variant="info"
            dense
            data-test="fleet-install-dialog-waiting"
          >
            <span class="inline-flex items-center gap-2">
              <OSpinner size="xs" />
              {{ t("fleet.install.waiting") }}
            </span>
          </OBanner>
        </div>
      </template>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import { fleetCollectorsQuery } from "@/services/fleet.queries";
import { fleetKeys } from "@/services/fleet.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import type { FleetCollector } from "@/services/fleet";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import FleetInstallCommand from "./FleetInstallCommand.vue";
import FleetTokenForm from "./FleetTokenForm.vue";
import { fleetLocation } from "./fleetRoute";
import { heldTokenSecret, newestHeldToken } from "./fleetTokenSecrets";
import { isForbidden, toCollectorRow, tokenState, useFleets, useFleetTokens } from "./useFleetApi";

const props = defineProps<{ open: boolean; fleetId: string }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const TOKEN_PLACEHOLDER = raw("<TOKEN>");
const ENV_REF = raw("${env:VAR}");
const POLL_MS = 5000;

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();

const tokens = useFleetTokens(() => props.open);
const fleets = useFleets(() => props.open);
const tokensLoading = computed(() => tokens.loading.value && !tokens.error.value);
const tokensForbidden = computed(() => isForbidden(tokens.error.value));
const retryTokens = () => tokens.refetch();
const retryCollectors = () => collectors.refetch();
const activeTokens = computed(() =>
  tokens.rows.value.filter(
    (tok) => tok.fleetId === props.fleetId && tokenState(tok, Date.now()) === "active",
  ),
);
// Judged on this fleet's tokens: other fleets' cached rows must not hide a failed read.
const tokensFailed = computed(() => !!tokens.error.value && !activeTokens.value.length);
const pendingTokenId = ref<string | null>(null);
// The token a collector presented last is the one it uses, so the count comes from the collector list.
const tokenOptions = computed(() =>
  activeTokens.value.map((tok) => {
    const count = (collectors.data.value ?? []).filter((c) => c.token_id === tok.id).length;
    return {
      label: t("fleet.install.tokenOption", { name: raw(tok.name), count }, count),
      value: tok.id,
    };
  }),
);

const chosenId = ref<string | null>(null);
const selectedId = computed<string | null>({
  get: () => {
    const ids = activeTokens.value.map((tok) => tok.id);
    if (chosenId.value && ids.includes(chosenId.value)) return chosenId.value;
    return newestHeldToken(orgId.value, ids) ?? ids[0] ?? null;
  },
  set: (id) => (chosenId.value = id),
});
const creatingHere = ref(false);
// A create response outranks the stored value only in being fresher; both are the same token.
const secret = computed(() => {
  if (!selectedId.value) return null;
  const stored = activeTokens.value.find((tok) => tok.id === selectedId.value)?.token ?? null;
  return heldTokenSecret(orgId.value, selectedId.value) ?? stored;
});
const createdHere = computed(
  () => !!pendingTokenId.value && selectedId.value === pendingTokenId.value && !!secret.value,
);

const selectedTokenName = computed(
  () => activeTokens.value.find((tok) => tok.id === selectedId.value)?.name ?? "",
);

// A new collector lands in its token's fleet and takes that fleet's stable version.
const joinsText = computed<I18nText | null>(() => {
  const id = activeTokens.value.find((tok) => tok.id === selectedId.value)?.fleetId;
  const fleet = fleets.rows.value.find((f) => f.id === id);
  if (!fleet?.readable) return null;
  return fleet.stable
    ? t("fleet.install.joinsFleet", {
        fleet: raw(fleet.name),
        config: raw(fleet.stable.config),
        version: fleet.stable.version,
      })
    : t("fleet.install.joinsFleetNoConfig", { fleet: raw(fleet.name) });
});

const collectors = useQuery(() =>
  Object.assign(fleetCollectorsQuery(orgId.value), {
    enabled: !!orgId.value && props.open,
    refetchInterval: (query: { state: { data?: FleetCollector[]; error: unknown } }) =>
      props.open && selectedId.value && !query.state.error && !findConnected(query.state.data)
        ? POLL_MS
        : false,
  }),
);
const collectorsForbidden = computed(() => isForbidden(collectors.error.value));

watch(
  () => props.fleetId,
  () => {
    chosenId.value = null;
    pendingTokenId.value = null;
  },
);

// The baseline must come from a read made after opening: a cached list can miss collectors that are already bound.
const openedAt = ref(0);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    chosenId.value = null;
    pendingTokenId.value = null;
    openedAt.value = Date.now();
    void collectors.refetch({ cancelRefetch: false });
  },
  { immediate: true },
);

// enrolled_at is set once and the browser clock is not the server's, so a new binding is found by diffing ids.
const baseline = ref<{ token: string; ids: Set<string> } | null>(null);
watch(
  [() => props.open, selectedId, collectors.dataUpdatedAt],
  ([open, token, updatedAt]) => {
    const items = collectors.data.value;
    if (!open || !token) baseline.value = null;
    else if (items && updatedAt >= openedAt.value && baseline.value?.token !== token)
      baseline.value = { token, ids: new Set(boundTo(items, token).map((c) => c.id)) };
  },
  { immediate: true },
);

const connected = computed(() => {
  const hit = findConnected(collectors.data.value);
  return hit ? toCollectorRow(hit) : null;
});

// The first row after enrollment can be the admission stub, so the list and summary are re-read on connect and again on close.
const sawConnect = ref(false);
function refreshFleetReads() {
  void queryClient.invalidateQueries({ queryKey: fleetKeys.collectors(orgId.value) });
  void queryClient.invalidateQueries({ queryKey: fleetKeys.summary(orgId.value) });
}
watch(
  () => connected.value?.id,
  (id) => {
    if (!id) return;
    sawConnect.value = true;
    refreshFleetReads();
  },
);
watch(
  () => props.open,
  (open) => {
    if (open || !sawConnect.value) return;
    sawConnect.value = false;
    refreshFleetReads();
  },
);

function boundTo(items: FleetCollector[], token: string) {
  return items.filter((c) => c.token_id === token);
}

function findConnected(items: FleetCollector[] | undefined) {
  const base = baseline.value;
  if (!props.open || !items || !base || base.token !== selectedId.value) return undefined;
  return boundTo(items, base.token).find((c) => !base.ids.has(c.id));
}

function onTokenCreated(token: { id: string }) {
  if (!props.open) return;
  pendingTokenId.value = token.id;
  chosenId.value = token.id;
  creatingHere.value = false;
}

function viewCollectors() {
  emit("update:open", false);
  router.push(
    fleetLocation(
      "fleets",
      { fleet: props.fleetId, collector: connected.value?.id ?? "" },
      route.query,
    ),
  );
}
</script>
