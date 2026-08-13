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

<script setup lang="ts">
//
// Create/edit view for protocol checks (http/tcp/tls/ssh) — single configure
// page, no journey step. Mirrors CreateBrowserTest's data fetching and save
// flow; the per-type request card is slotted into CheckConfigure.
import { computed, onMounted, ref, watch, type Component } from "vue";
import { useRoute, useRouter, onBeforeRouteLeave } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import type {
  AgentSetup,
  BrowserCheck,
  ProtocolCheck,
  ProtocolCheckType,
  SyntheticsFolder,
  SyntheticsLocation,
} from "@/types/synthetics";
import {
  buildCreateProtocolCheckPayload,
  defaultProtocolConfig,
  mapResponseToProtocolCheck,
} from "@/utils/synthetics/buildPayload";
import { getFoldersListByType } from "@/utils/commons";
import { syntheticsListRoute } from "@/utils/synthetics/routes";
import syntheticsService from "@/services/synthetics";
import destinationService from "@/services/alert_destination";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import CheckConfigure from "@/components/synthetics/configure/CheckConfigure.vue";
import AgentSetupDrawer from "@/components/synthetic-monitoring/AgentSetupDrawer.vue";
import CreateBrowserTestSkeleton from "@/components/synthetics/CreateBrowserTestSkeleton.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import CheckHttpConfig from "@/components/synthetics/configure/types/CheckHttpConfig.vue";
import CheckTcpConfig from "@/components/synthetics/configure/types/CheckTcpConfig.vue";
import CheckTlsConfig from "@/components/synthetics/configure/types/CheckTlsConfig.vue";
import CheckSshConfig from "@/components/synthetics/configure/types/CheckSshConfig.vue";

const props = defineProps<{
  checkType: ProtocolCheckType;
  /** Present when editing an existing check. */
  editId?: string;
}>();

const router = useRouter();
const route = useRoute();
const store = useStore();

// Private locations are served by agents deployed inside the customer's network,
// the one enterprise part of synthetics. Gated on its own /config flag so an OSS
// build still offers public, Lambda-served locations.
const privateLocationsEnabled = computed(() =>
  Boolean(store.state.zoConfig?.synthetics_private_locations_enabled),
);
const { t } = useI18nTyped();

const typeConfigCards: Record<ProtocolCheckType, Component> = {
  http: CheckHttpConfig,
  tcp: CheckTcpConfig,
  tls: CheckTlsConfig,
  ssh: CheckSshConfig,
};

function makeDefaultCheck(type: ProtocolCheckType): ProtocolCheck {
  return {
    checkType: type,
    name: "",
    url: "",
    enabled: true,
    folder: "default",
    tags: [],
    journey: [],
    schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
    locations: [],
    retries: 0,
    waitBeforeRetrySecs: 5,
    alertIfFails: 1,
    cooldownMins: 5,
    notifications: { destinations: [] },
    rum: { collect: false, sessionReplay: false },
    capture: { screenshot: "off", trace: "off" },
    variables: [],
    ...defaultProtocolConfig(type),
  };
}

const check = ref<ProtocolCheck>(makeDefaultCheck(props.checkType));
const isLoadingEdit = ref(false);
const isSaving = ref(false);

const headerTitle = computed(() => {
  if (isLoadingEdit.value) return t("synthetics.createBrowserTest.loading");
  if (props.editId)
    return check.value.name || t("synthetics.newCheck.pageTitle", { label: typeLabel.value });
  return t("synthetics.newCheck.pageTitle", { label: typeLabel.value });
});
const typeLabel = computed(() => t(`synthetics.newCheck.${props.checkType}`));

// Server-driven lists, threaded down to CheckConfigure (same as browser flow).
const locations = ref<SyntheticsLocation[]>([]);
const locationsLoading = ref(false);
const destinations = ref<string[]>([]);
const folders = ref<SyntheticsFolder[]>([]);
const foldersLoading = ref(false);
/** Only ever carries `folder` today — the folder select is the one field this
 *  view can invalidate on its own. */
const validationErrors = ref<Record<string, string>>({});

const orgIdentifier = computed<string>(
  () => (store.state as any).selectedOrganization?.identifier ?? "",
);

/**
 * Where every exit from this wizard lands — mirrors CreateBrowserTest.backTo.
 * Tracks `check.folder` so backing out after a folder change returns to the
 * folder the check now lives in, with `org_identifier` stamped from the store.
 */
const backTo = computed(() =>
  syntheticsListRoute({ orgIdentifier: orgIdentifier.value, folderId: check.value.folder }),
);

/** Resolves once orgIdentifier is populated — on a hard reload or browser
 *  back-navigation onto this route the store is not hydrated synchronously yet.
 *  Mirrors waitForOrgIdentifier in SyntheticMonitoring.vue. */
function waitForOrgIdentifier(): Promise<void> {
  if (orgIdentifier.value) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const stop = watch(orgIdentifier, (val) => {
      if (val) {
        stop();
        resolve();
      }
    });
  });
}

async function fetchFolders() {
  foldersLoading.value = true;
  try {
    // Without this wait a reload of /synthetics/add?folder=… fires the request
    // against an empty org, and the single catch below would pin the list to []
    // for the rest of the session — leaving the folder select unable to resolve
    // the preselected id and rendering it raw.
    await waitForOrgIdentifier();
    const res = await getFoldersListByType(store, "synthetics");
    folders.value = (res ?? []) as SyntheticsFolder[];
  } catch (err) {
    console.error("[synthetics] failed to load folders", err);
    folders.value = [];
  } finally {
    foldersLoading.value = false;
  }
}

/**
 * Reconcile the selected folder against the folders this org actually has.
 * Same hazard as the browser flow: `?folder=` and stored checks are unvalidated,
 * and an unresolvable id is rendered raw and then sent back as `?folder=`, which
 * the server treats as authoritative for the destination folder and the RBAC
 * gate. Skipped while the list is empty — that means the fetch has not landed.
 */
watch(
  [folders, () => check.value.folder],
  () => {
    if (!folders.value.length) return;
    const folderId = check.value.folder;
    if (!folderId || folders.value.some((f) => f.folderId === folderId)) return;
    check.value = { ...check.value, folder: "default" };
    validationErrors.value = {
      ...validationErrors.value,
      folder: t("synthetics.validation.folderUnavailable", { folder: folderId }),
    };
  },
  { immediate: true },
);

async function fetchLocations() {
  locationsLoading.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.getLocations(org);
    // Protocol checks run from public locations and protocol-capable private
    // agents. Hide disabled locations, and hide private locations whose live
    // agents are browser-only (a browser agent can't run an HTTP/TCP/… check) —
    // `types` reflects live agents' capabilities, so a private location shows
    // only when it currently has an agent advertising a non-browser type.
    // Mirror of the browser page, which requires `types` to include 'browser'.
    locations.value = (((res.data ?? {}).locations ?? []) as SyntheticsLocation[]).filter(
      (l) =>
        l.enabled !== false &&
        (l.kind !== "private" || (l.types ?? []).some((t) => t !== "browser")),
    );
  } catch (err: any) {
    // A 403 means the endpoint isn't available on this build; fall back to
    // empty silently for those, and only surface real failures.
    locations.value = [];
    if (err?.response?.status !== 403) {
      toast({ variant: "error", message: t("synthetics.locations.fetchFailed") });
    }
  } finally {
    locationsLoading.value = false;
  }
}

// ── Private agent setup (drawer opened from the locations card) ──────────
const showAgentSetup = ref(false);
const agentSetup = ref<AgentSetup | null>(null);
const agentSetupLocationId = ref<string | null>(null);
const agentSetupLocationName = ref<string | null>(null);

async function openAgentSetup(locationId?: string) {
  agentSetupLocationId.value = locationId ?? null;
  agentSetupLocationName.value = locationId
    ? (locations.value.find((l) => l.id === locationId)?.label ?? null)
    : null;
  showAgentSetup.value = true;
  if (agentSetup.value) return;
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.getAgentSetup(org);
    agentSetup.value = (res.data ?? null) as AgentSetup | null;
  } catch {
    agentSetup.value = null;
  }
}

async function fetchDestinations() {
  try {
    const res = await destinationService.list({
      org_identifier: store.state.selectedOrganization.identifier,
      page_num: 1,
      page_size: 1000,
      sort_by: "name",
      desc: false,
    });
    destinations.value = (res.data ?? []).map((d: any) => d.name as string);
  } catch {
    destinations.value = [];
  }
}

async function loadForEdit(id: string) {
  isLoadingEdit.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.get(org, id, String(route.query.folder ?? ""));
    check.value = mapResponseToProtocolCheck(res.data as Record<string, unknown>);
  } catch (err: any) {
    // If the check doesn't exist in this org (e.g. user switched orgs while editing),
    // redirect to the synthetics list with a message.
    if (err?.response?.status === 404) {
      forceLeave = true;
      router.push(backTo.value);
      toast({ variant: "warning", message: t("synthetics.newCheck.notFoundInOrg") });
      isLoadingEdit.value = false;
      return;
    }
    // Surface it — a silent catch here leaves a blank form that saves a
    // fresh check over the existing one.
    console.error("[synthetics] failed to load check for edit", err);
    toast({ variant: "error", message: t("synthetics.newCheck.loadEditFailed") });
  } finally {
    isLoadingEdit.value = false;
  }
}

onMounted(() => {
  fetchFolders();
  fetchLocations();
  fetchDestinations();

  if (props.editId) {
    loadForEdit(props.editId).catch(console.error);
  } else {
    const folderQuery = route.query.folder;
    if (typeof folderQuery === "string" && folderQuery) {
      check.value = { ...check.value, folder: folderQuery };
    }
  }
});

// ── Unsaved changes guard (same pattern as CreateBrowserTest) ────────────────
const isDirty = ref(false);
const showUnsavedDialog = ref(false);
let pendingLeavePath: string | null = null;
let forceLeave = false;

function onConfigureUpdate(val: BrowserCheck) {
  check.value = val as ProtocolCheck;
  isDirty.value = true;
}

onBeforeRouteLeave((to, _from, next) => {
  if (forceLeave || !isDirty.value) {
    forceLeave = false;
    next();
    return;
  }
  next(false);
  pendingLeavePath = to.fullPath;
  showUnsavedDialog.value = true;
});

function onConfirmLeave() {
  showUnsavedDialog.value = false;
  forceLeave = true;
  if (pendingLeavePath) {
    router.push(pendingLeavePath);
    pendingLeavePath = null;
  }
}

async function saveCheck() {
  isSaving.value = true;
  const dismiss = toast({
    variant: "loading",
    message: t("synthetics.newCheck.saving"),
    timeout: 0,
  });
  try {
    const org = store.state.selectedOrganization.identifier;
    const payload = buildCreateProtocolCheckPayload(check.value);
    if (props.editId) {
      await syntheticsService.update(org, props.editId, payload, check.value.folder);
      dismiss();
      toast({ variant: "success", message: t("synthetics.newCheck.updated") });
    } else {
      await syntheticsService.create(org, payload, check.value.folder);
      dismiss();
      toast({ variant: "success", message: t("synthetics.newCheck.saved") });
    }
    isDirty.value = false;
    router.push(backTo.value);
  } catch (err: any) {
    dismiss();
    if (err?.response?.status === 404) {
      forceLeave = true;
      router.push(backTo.value);
      toast({ variant: "warning", message: t("synthetics.newCheck.notFoundInOrg") });
      isSaving.value = false;
      return;
    }
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        t("synthetics.newCheck.saveFailed"),
    });
    console.error("[synthetics] save failed", err);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <OPageLayout
    :back="{
      label: t('synthetics.newCheck.back'),
      to: backTo,
      dataTest: 'synthetics-create-back-btn',
    }"
    bleed
  >
    <template #title>
      <span class="inline-flex min-w-0 items-center gap-2">
        <span class="truncate">{{ headerTitle }}</span>
        <BetaBadge />
      </span>
    </template>
    <CreateBrowserTestSkeleton v-if="isLoadingEdit" :rows="10" />
    <template v-else>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <CheckConfigure
          :check="check"
          :check-type="checkType"
          :locations="locations"
          :loading-locations="locationsLoading"
          :destinations="destinations"
          :folders="folders"
          :folders-loading="foldersLoading"
          :validation-errors="validationErrors"
          :allow-private-locations="privateLocationsEnabled"
          class="w-full!"
          @refresh:destinations="fetchDestinations"
          @update:check="onConfigureUpdate"
          @new-location="openAgentSetup()"
          @add-agent="(id: string) => openAgentSetup(id)"
          @refresh-locations="fetchLocations"
        >
          <template #type-config>
            <component
              :is="typeConfigCards[checkType]"
              :check="check"
              @update:check="onConfigureUpdate"
            />
          </template>
        </CheckConfigure>
      </div>

      <!-- Sticky footer -->
      <div
        class="border-border-default bg-surface-base flex shrink-0 items-center gap-2 border-t px-3 py-2.5"
      >
        <span class="flex-1" aria-hidden="true" />
        <OButton
          variant="ghost"
          size="sm"
          data-test="synthetics-create-cancel-btn"
          @click="router.push(backTo)"
        >
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm"
          :loading="isSaving"
          data-test="synthetics-create-save-btn"
          @click="saveCheck"
        >
          {{ t("synthetics.newCheck.saveAndExit") }}
        </OButton>
      </div>

      <!-- Private agent setup drawer; a freshly registered location appears via
           the locations card's Refresh button. -->
      <AgentSetupDrawer
        v-if="privateLocationsEnabled"
        v-model:open="showAgentSetup"
        :token="agentSetup?.token"
        :org="agentSetup?.org"
        :o2-url="agentSetup?.o2_url"
        :script-url="agentSetup?.script_url"
        :install="agentSetup?.install"
        :location-id="agentSetupLocationId"
        :location-name="agentSetupLocationName"
        @update:open="
          (open: boolean) => {
            if (!open) {
              agentSetupLocationId = null;
              agentSetupLocationName = null;
            }
          }
        "
      />

      <!-- Unsaved changes dialog -->
      <ODialog
        v-model:open="showUnsavedDialog"
        size="sm"
        :title="t('synthetics.newCheck.unsavedTitle')"
        :primary-button-label="t('synthetics.newCheck.leave')"
        :secondary-button-label="t('synthetics.newCheck.stay')"
        data-test="synthetics-create-unsaved-dialog"
        @click:primary="onConfirmLeave"
        @click:secondary="showUnsavedDialog = false"
      >
        <p class="py-2">{{ t("synthetics.newCheck.unsavedBody") }}</p>
      </ODialog>
    </template>
  </OPageLayout>
</template>
