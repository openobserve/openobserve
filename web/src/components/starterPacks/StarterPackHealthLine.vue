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
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { readQuery } from "@/composables/query/readQuery";
import { KUBERNETES_PACK } from "@/composables/starterPacks/kubernetesPack";
import { usePackHealth } from "@/composables/starterPacks/usePackHealth";
import { alertsByTagsQuery } from "@/services/alerts.queries";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{ org: string }>();

const { t } = useI18nTyped();
const router = useRouter();
const pack = KUBERNETES_PACK;
const health = usePackHealth(props.org);
const ready = ref(false);

onMounted(async () => {
  const alerts = await readQuery(alertsByTagsQuery(props.org, [`pack:${pack.id}`])).catch(() => []);
  if (alerts.length) await health.check(alerts.map((alert) => alert.stream_name));
  ready.value = true;
});

const since = computed(() => {
  const at = health.staleSince.value;
  return at ? new Date(at / 1000).toLocaleString() : "";
});
const collector = () =>
  router
    .push({ name: "ingestFromKubernetes", query: { org_identifier: props.org } })
    .catch(() => {});
</script>

<template>
  <OBanner
    v-if="ready && since"
    variant="warning"
    dense
    inline-actions
    data-test="starter-pack-page-health"
  >
    {{ t("starterPacks.health.line", { title: t(pack.titleKey), since: raw(since) }) }}
    <template #actions>
      <OButton
        variant="ghost-primary"
        size="sm-action"
        data-test="starter-pack-page-check-collector-link"
        @click="collector"
      >
        {{ t("starterPacks.health.checkCollector") }}
      </OButton>
    </template>
  </OBanner>
</template>
