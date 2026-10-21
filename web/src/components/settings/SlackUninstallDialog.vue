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
import { computed, ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { bulkDeleteDestinationsMutation } from "@/services/alert_destination.queries";
import {
  disconnectInstallationMutation,
  uninstallInstallationMutation,
} from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { isSlackUrl } from "@/utils/slackLink";
import type {
  InstallationView,
  SlackDestinationRef,
  SlackDisconnectResponse,
  SlackUninstallResponse,
} from "@/types/slack";

type Result =
  | { kind: "disconnect"; data: SlackDisconnectResponse }
  | { kind: "uninstall"; data: SlackUninstallResponse };

const props = defineProps<{
  open: boolean;
  mode: "disconnect" | "uninstall";
  installation: InstallationView;
}>();

const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const team = computed(() => props.installation.team_name);

const disconnect = useMutation(() => disconnectInstallationMutation(org.value));
const uninstall = useMutation(() => uninstallInstallationMutation(org.value));
const removeDestinations = useMutation(() => bulkDeleteDestinationsMutation(org.value));

const result = ref<Result | null>(null);
const affected = ref<SlackDestinationRef[]>([]);
const selectedIds = ref<string[]>([]);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    result.value = null;
    affected.value = [];
    selectedIds.value = [];
  },
);

const busy = computed(() => disconnect.isPending.value || uninstall.isPending.value);

const title = computed(() => {
  if (result.value?.kind === "disconnect") {
    return t("slackApp.uninstall.disconnectedTitle", { team: team.value });
  }
  if (result.value?.kind === "uninstall") {
    return t("slackApp.uninstall.uninstalledTitle", { team: team.value });
  }
  return props.mode === "disconnect"
    ? t("slackApp.uninstall.disconnectTitle", { team: team.value })
    : t("slackApp.uninstall.uninstallTitle", { team: team.value });
});

const primaryLabel = computed(() => {
  if (result.value) return t("slackApp.uninstall.done");
  return props.mode === "disconnect"
    ? t("slackApp.card.disconnectThisOrg")
    : t("slackApp.card.uninstall");
});

const destinationCount = computed(() => props.installation.this_org.destination_count);
const otherOrgs = computed(() => props.installation.other_connected_orgs);

// `affected.orgs` counts every connected org, this one included.
const otherOrgsAfter = computed(() =>
  result.value?.kind === "uninstall" ? Math.max(0, result.value.data.affected.orgs - 1) : 0,
);

const deleteAppUrl = computed(() => {
  const url = result.value?.kind === "uninstall" ? result.value.data.delete_app_url : null;
  return isSlackUrl(url, "api.slack.com") ? url : null;
});

const isThisOrg = (d: SlackDestinationRef): boolean => d.org_id === org.value;
const removable = computed(() => affected.value.filter(isThisOrg));
const hasOtherOrgRows = computed(() => affected.value.some((d) => !isThisOrg(d)));

const columns = computed<OTableColumnDef<SlackDestinationRef>[]>(() => {
  const name: OTableColumnDef<SlackDestinationRef> = {
    id: "name",
    header: hasOtherOrgRows.value
      ? t("slackApp.uninstall.affectedDestinationsAllOrgs", { team: team.value })
      : t("slackApp.uninstall.affectedDestinations", { team: team.value }),
    accessorKey: "name",
    meta: { flex: true },
  };
  if (!hasOtherOrgRows.value) return [name];
  return [name, { id: "org_id", header: t("slackApp.uninstall.orgColumn"), accessorKey: "org_id" }];
});

const confirm = async (): Promise<void> => {
  if (result.value) {
    emit("update:open", false);
    return;
  }
  const id = props.installation.id;
  try {
    if (props.mode === "disconnect") {
      result.value = { kind: "disconnect", data: await disconnect.mutateAsync(id) };
      return;
    }
    const data = await uninstall.mutateAsync(id);
    affected.value = data.affected.destinations;
    result.value = { kind: "uninstall", data };
  } catch {
    /* the mutation toasted the refusal; the dialog stays on its confirm step */
  }
};

const removeSelected = async (): Promise<void> => {
  const names = removable.value.filter((d) => selectedIds.value.includes(d.id)).map((d) => d.name);
  if (!names.length) return;
  try {
    const response = await removeDestinations.mutateAsync(names);
    const removed = new Set<string>(
      (response.data?.successful ?? []).map((entry: { name?: string } | string) =>
        typeof entry === "string" ? entry : (entry.name ?? ""),
      ),
    );
    affected.value = affected.value.filter((d) => !(isThisOrg(d) && removed.has(d.name)));
    selectedIds.value = [];
    toast({
      variant: removed.size === names.length ? "success" : "warning",
      message:
        removed.size === names.length
          ? t("slackApp.uninstall.removed", { count: removed.size }, removed.size)
          : t("slackApp.uninstall.removeFailed"),
    });
  } catch {
    toast({ variant: "error", message: t("slackApp.uninstall.removeFailed") });
  }
};
</script>

<template>
  <ODialog
    :open="open"
    size="md"
    :title="title"
    :primary-button-label="primaryLabel"
    :primary-button-variant="result ? 'primary' : 'destructive'"
    :primary-button-loading="busy"
    :secondary-button-label="result ? undefined : t('common.cancel')"
    initial-focus="secondary"
    @update:open="emit('update:open', $event)"
    @click:primary="confirm"
    @click:secondary="emit('update:open', false)"
  >
    <div v-if="!result" class="flex flex-col gap-3 text-sm" data-test="slack-dialog-confirm">
      <template v-if="mode === 'disconnect'">
        <p class="m-0">{{ t("slackApp.uninstall.disconnectMessage", { org }) }}</p>
        <p class="m-0 font-medium">
          {{
            t(
              "slackApp.uninstall.disconnectDestinations",
              { count: destinationCount, team },
              destinationCount,
            )
          }}
        </p>
      </template>
      <template v-else>
        <p class="m-0">{{ t("slackApp.uninstall.uninstallMessage") }}</p>
        <p class="m-0 font-medium">
          {{ t("slackApp.uninstall.otherOrgsBefore", { count: otherOrgs }, otherOrgs) }}
        </p>
      </template>
    </div>

    <div v-else class="flex flex-col gap-3 text-sm" data-test="slack-dialog-result">
      <template v-if="result.kind === 'disconnect'">
        <template v-if="result.data.stopped_destinations.length">
          <p class="m-0">{{ t("slackApp.uninstall.stoppedDestinations") }}</p>
          <ul class="m-0 flex list-disc flex-col gap-1 ps-5">
            <li v-for="d in result.data.stopped_destinations" :key="d.id">{{ raw(d.name) }}</li>
          </ul>
        </template>
        <p v-else class="m-0">{{ t("slackApp.uninstall.noneStopped", { team }) }}</p>
      </template>
      <template v-else>
        <p class="m-0">
          {{ t("slackApp.uninstall.otherOrgsAfter", { count: otherOrgsAfter }, otherOrgsAfter) }}
          {{
            t(
              "slackApp.uninstall.linksRevoked",
              { count: result.data.affected.links_revoked },
              result.data.affected.links_revoked,
            )
          }}
        </p>
        <OTable
          v-if="affected.length"
          :data="affected"
          :columns="columns"
          row-key="id"
          selection="multiple"
          :is-row-selectable="isThisOrg"
          :selected-ids="selectedIds"
          pagination="none"
          :show-global-filter="false"
          dense
          @update:selected-ids="selectedIds = $event"
        >
          <!-- OTable draws #selection-actions only in its pager, which pagination="none" turns off. -->
          <template v-if="selectedIds.length" #pagination-bar>
            <div
              class="border-border-default flex items-center gap-3 border-t px-3 py-1"
              data-test="slack-remove-bar"
            >
              <span
                class="text-text-heading text-xs font-medium"
                role="status"
                data-test="slack-selected-count"
              >
                {{
                  t("components.table.selectedOfTotal", {
                    selected: selectedIds.length,
                    total: removable.length,
                  })
                }}
              </span>
              <OButton
                variant="destructive"
                size="sm"
                :loading="removeDestinations.isPending.value"
                data-test="slack-remove-destinations"
                @click="removeSelected"
              >
                {{ t("slackApp.uninstall.remove") }}
              </OButton>
            </div>
          </template>
        </OTable>
        <p v-else class="text-text-secondary m-0">
          {{ t("slackApp.uninstall.affectedEmpty", { team }) }}
        </p>
        <p v-if="hasOtherOrgRows" class="text-text-secondary m-0" data-test="slack-other-org-note">
          {{ t("slackApp.uninstall.otherOrgDestinationsNote") }}
        </p>
        <OButton
          v-if="deleteAppUrl"
          as="a"
          :href="deleteAppUrl"
          target="_blank"
          rel="noopener noreferrer"
          variant="ghost-primary"
          size="sm"
          icon-right="open-in-new"
          class="w-fit"
          data-test="slack-delete-app"
        >
          {{ t("slackApp.uninstall.deleteApp") }}
        </OButton>
      </template>
    </div>
  </ODialog>
</template>
