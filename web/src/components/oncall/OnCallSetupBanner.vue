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

<!-- The setup checklist's one-line bar for pages other than Pages, answered from its own reads. -->
<template>
  <div v-if="unfinished && !dismissed" data-test="oncall-setup-banner-host">
    <OnCallSetupChecklist
      compact
      dismissible
      :has-team="facts.hasTeam"
      :has-staffed-rotation="facts.hasStaffedRotation"
      :has-policy="facts.hasPolicy"
      :has-routing="facts.hasRouting"
      :can-configure="canConfigure"
      :first-team-id="teams[0]?.id ?? null"
      :first-team-name="teams[0]?.name ?? null"
      @create-team="createTeam"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OnCallSetupChecklist from "@/components/oncall/OnCallSetupChecklist.vue";
import { queryClient } from "@/composables/query/queryClient";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import { useOnCallSetupDismissed } from "@/composables/useOnCallSetupDismissed";
import {
  coverageGapsQuery,
  oncallTeamsQuery,
  ownershipRulesQuery,
  responsesQuery,
  teamPolicyQuery,
} from "@/services/oncall.queries";
import type {
  CoverageGaps,
  OnCallPolicy,
  OnCallResponse,
  OnCallTeam,
  OwnershipRule,
} from "@/ts/interfaces/oncall";

const props = withDefaults(
  defineProps<{
    /** Declared as a prop so the bar can tell whether the page handles `@create-team` itself. */
    onCreateTeam?: () => void;
  }>(),
  { onCreateTeam: undefined },
);

const store = useStore();
const router = useRouter();
const { canConfigure } = useOnCallPermissions();
const { dismissed } = useOnCallSetupDismissed();
const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const teams = ref<OnCallTeam[]>([]);
const facts = ref({
  hasTeam: false,
  hasStaffedRotation: false,
  hasPolicy: false,
  hasRouting: false,
});
/// Set only once every read answered: a fact that failed to load is not a step left undone.
const known = ref(false);

const unfinished = computed(
  () =>
    known.value &&
    !(
      facts.value.hasTeam &&
      facts.value.hasStaffedRotation &&
      facts.value.hasPolicy &&
      facts.value.hasRouting
    ),
);

/// Cache-first; a force expires the entry first, so it costs one request, not two.
async function read<T>(
  options: { queryKey: readonly unknown[]; [k: string]: any },
  force: boolean,
): Promise<T> {
  if (force) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
  }
  return queryClient.fetchQuery(options as any) as Promise<T>;
}

/// One answering policy is enough, so teams are asked in turn rather than all at once.
async function anyPolicy(org: string, teamList: OnCallTeam[], force: boolean) {
  for (const team of teamList) {
    const policy = await read<OnCallPolicy | null>(teamPolicyQuery(org, team.id), force).catch(
      () => null,
    );
    if (policy) return true;
  }
  return false;
}

async function load(force = false) {
  const org = orgId.value;
  // A dismissed bar never shows, so its facts are not worth a request.
  if (!org || dismissed.value) return;
  try {
    const [teamList, gaps, rules, pages] = await Promise.all([
      read<OnCallTeam[]>(oncallTeamsQuery(org), force),
      read<CoverageGaps | null>(coverageGapsQuery(org), force),
      read<OwnershipRule[]>(ownershipRulesQuery(org), force),
      read<OnCallResponse[]>(responsesQuery(org, { include_resolved: true, limit: 20 }), force),
    ]);
    const hasPolicy = await anyPolicy(org, teamList, force);
    teams.value = teamList;
    facts.value = {
      hasTeam: teamList.length > 0,
      hasStaffedRotation: teamList.length > 0 && (gaps?.total ?? 0) < teamList.length,
      // The server creates the default ladder on first read, so a policy that answers is one that pages.
      hasPolicy,
      // An alert bound straight to a team counts: it is routing without a rule.
      hasRouting: rules.length > 0 || pages.some((page) => !!page.team_id),
    };
    known.value = true;
  } catch {
    known.value = false;
  }
}

function createTeam() {
  if (props.onCreateTeam) return props.onCreateTeam();
  router.push({ name: "onCallTeams", query: { org_identifier: orgId.value, action: "add" } });
}

defineExpose({ refresh: () => load(true) });

onMounted(() => load());
</script>
