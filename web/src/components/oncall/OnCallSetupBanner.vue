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
import { readQuery } from "@/composables/query/readQuery";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import { useOnCallPolicyReviewed } from "@/composables/useOnCallPolicyReviewed";
import { useOnCallSetupDismissed } from "@/composables/useOnCallSetupDismissed";
import {
  coverageGapsQuery,
  oncallTeamsQuery,
  ownershipRulesQuery,
  responsesQuery,
  teamPolicyQuery,
} from "@/services/oncall.queries";
import type { OnCallTeam } from "@/ts/interfaces/oncall";
import { licenseDeniedFeatures } from "@/utils/featureGate";

const props = withDefaults(
  defineProps<{
    /** Declared as a prop so the bar can tell whether the page handles `@create-team` itself. */
    onCreateTeam?: () => void;
  }>(),
  { onCreateTeam: undefined },
);

const emit = defineEmits<{ licenseDenied: [features: string[]] }>();

// Per read: `Promise.all` below surfaces only the first failure, which need not be the denial.
const read: typeof readQuery = (options, force) =>
  readQuery(options, force).catch((err: unknown) => {
    const denied = licenseDeniedFeatures(err);
    if (denied) emit("licenseDenied", denied);
    throw err;
  });

const store = useStore();
const router = useRouter();
const { canConfigure } = useOnCallPermissions();
const { dismissed } = useOnCallSetupDismissed();
const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const teams = ref<OnCallTeam[]>([]);
const facts = ref<{
  hasTeam: boolean;
  hasStaffedRotation: boolean;
  hasPolicy: boolean | null;
  hasRouting: boolean;
}>({
  hasTeam: false,
  hasStaffedRotation: false,
  hasPolicy: false,
  hasRouting: false,
});
const { reviewed: policyReviewed } = useOnCallPolicyReviewed(() => teams.value[0]?.id);
/// Set only once every read answered: a fact that failed to load is not a step left undone.
const known = ref(false);

const unfinished = computed(
  () =>
    known.value &&
    !(
      facts.value.hasTeam &&
      facts.value.hasStaffedRotation &&
      (policyReviewed.value || facts.value.hasPolicy !== false) &&
      facts.value.hasRouting
    ),
);

/// One answering policy is enough, so teams are asked in turn; `null` when a team that might have one could not be read.
async function anyPolicy(
  org: string,
  teamList: OnCallTeam[],
  force: boolean,
): Promise<boolean | null> {
  let unread = false;
  for (const team of teamList) {
    try {
      if (await read(teamPolicyQuery(org, team.id), force)) return true;
    } catch {
      unread = true;
    }
  }
  return unread ? null : false;
}

async function load(force = false) {
  const org = orgId.value;
  // A dismissed bar never shows, so its facts are not worth a request.
  if (!org || dismissed.value) return;
  try {
    const [teamList, gaps, rules, pages] = await Promise.all([
      read(oncallTeamsQuery(org), force),
      read(coverageGapsQuery(org), force),
      read(ownershipRulesQuery(org), force),
      read(responsesQuery(org, { include_resolved: true, limit: 20 }), force),
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
