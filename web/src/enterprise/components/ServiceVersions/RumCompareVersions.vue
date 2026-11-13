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
  <OButton
    v-if="scope"
    variant="outline"
    size="sm"
    icon-left="compare-arrows"
    data-test="svcver-rum-compare-versions"
    @click="compare"
    >{{ t("serviceVersions.rum.compareVersions") }}</OButton
  >
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import { servicesQuery } from "@/services/service_versions.queries";
import { scopesInEnv } from "@/services/service_versions.envs";
import { useVersionCompareDrawer } from "@/enterprise/composables/useVersionCompareDrawer";
import { useLicenseLock } from "@/composables/useFeatureLock";
const props = defineProps<{ app?: string; env?: string; version?: string }>();
const { t } = useI18nTyped();
const store = useStore();
const drawer = useVersionCompareDrawer();
const org = computed(() => store.state.selectedOrganization?.identifier || "");
const user = computed(() => store.state.userInfo?.email || "");
const tracesLock = useLicenseLock("traces");
const services = useQuery(
  computed(() => ({
    ...servicesQuery(org.value, user.value, { signal: "rum", service: props.app }),
    enabled: Boolean(org.value && user.value && props.app && !tracesLock.locked.value),
  })),
);
// The env variable picks the scope; without one the newest-deployed scope is the default.
const scope = computed(() => {
  const rows = (services.data.value?.services || [])
    .filter((row) => row.service === props.app && row.newest_version)
    .sort((a, b) => (b.newest_first_seen ?? 0) - (a.newest_first_seen ?? 0));
  return props.env ? scopesInEnv(rows, props.env)[0] : rows[0];
});
function compare() {
  const row = scope.value;
  const version = props.version || row?.newest_version;
  if (!row || !version) return;
  void drawer.open({ service: row.service, where: row.where_key, a: version });
}
</script>
