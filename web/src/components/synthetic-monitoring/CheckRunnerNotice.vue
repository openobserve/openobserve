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

<!-- The runs page's old-runner banner (U6): agents on this check's private locations only. -->
<template>
  <AgentRunnerNotice
    :agents="agents"
    :min-runner-version="setup.data.value?.min_runner_version"
    :lease-deadline-us="setup.data.value?.lease_deadline_us"
    class="mx-page-edge mt-3"
  />
  <OBanner
    v-if="
      setup.data.value?.min_runner_version &&
      setup.data.value.public_locations_leased === false &&
      hasPublicLocation
    "
    variant="warning"
    icon="update"
    :content="
      t(
        setup.data.value.lease_deadline_us === undefined
          ? 'synthetics.secretRunner.publicNotice'
          : 'synthetics.secretRunner.publicNoticeWithDeadline',
        {
          version: setup.data.value.min_runner_version,
          deadline:
            setup.data.value.lease_deadline_us === undefined
              ? ''
              : formatToDateOnly(setup.data.value.lease_deadline_us),
        },
      )
    "
    class="mx-page-edge mt-3"
    data-test="synthetics-public-runner-notice"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQueries, useQuery } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query/useOrgId";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import {
  agentSetupQuery,
  syntheticsLocationQuery,
  syntheticsLocationsQuery,
} from "@/services/synthetics.queries";
import type { SyntheticLocationAgent } from "@/types/synthetics";
import { useI18nTyped } from "@/types/i18n";
import { formatToDateOnly } from "@/utils/date";
import AgentRunnerNotice from "./AgentRunnerNotice.vue";

const props = defineProps<{ locationIds: string[] }>();
const orgId = useOrgId();
const { t } = useI18nTyped();

const locations = useQuery(() =>
  Object.assign(syntheticsLocationsQuery(orgId.value), {
    enabled: !!orgId.value && props.locationIds.length > 0,
  }),
);
const privateIds = computed(() =>
  (locations.data.value ?? [])
    .filter((loc) => loc.kind === "private" && props.locationIds.includes(loc.id))
    .map((loc) => loc.id),
);
const hasPublicLocation = computed(() =>
  (locations.data.value ?? []).some(
    (loc) => loc.kind === "public" && props.locationIds.includes(loc.id),
  ),
);
const details = useQueries({
  queries: computed(() => privateIds.value.map((id) => syntheticsLocationQuery(orgId.value, id))),
});
const agents = computed<SyntheticLocationAgent[]>(() =>
  details.value.flatMap((q) => q.data?.agents ?? []),
);
const setup = useQuery(() =>
  Object.assign(agentSetupQuery(orgId.value), {
    enabled: !!orgId.value && props.locationIds.length > 0,
  }),
);
</script>
