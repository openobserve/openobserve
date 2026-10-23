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
  <OBanner v-if="items.length" variant="warning" data-test="fleet-token-expiry-banner">
    <p class="font-medium">
      {{ t("fleet.tokenExpiry.title", { count: items.length }, items.length) }}
    </p>
    <ul class="mt-1 flex flex-col gap-1">
      <li
        v-for="item in items"
        :key="item.token.id"
        class="flex flex-wrap items-center gap-x-2 gap-y-1"
        :data-test="`fleet-token-expiry-${item.token.id}`"
      >
        <span class="font-medium">{{ item.token.name }}</span>
        <span v-if="item.token.fleetName" class="text-text-secondary">{{
          item.token.fleetName
        }}</span>
        <span>{{ when(item) }}</span>
        <span>{{
          t("fleet.tokenExpiry.usedBy", { count: item.collectors.length }, item.collectors.length)
        }}</span>
        <OButton
          v-for="c in item.collectors.slice(0, MAX_NAMES)"
          :key="c.id"
          variant="ghost-primary"
          size="xs"
          :data-test="`fleet-token-expiry-collector-${c.id}`"
          @click="emit('open-collector', c)"
        >
          {{ c.name }}
        </OButton>
        <span v-if="item.collectors.length > MAX_NAMES" class="text-text-secondary">
          {{ t("fleet.tokenExpiry.more", { count: item.collectors.length - MAX_NAMES }) }}
        </span>
      </li>
    </ul>
    <template #actions>
      <OButton
        variant="outline"
        size="sm"
        data-test="fleet-token-expiry-manage"
        @click="emit('open-tokens', items[0].token.fleetId)"
      >
        {{ t("fleet.tokenExpiry.manage") }}
      </OButton>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import {
  tokenExpiresSoon,
  tokenState,
  useFleetCollectors,
  useFleetTokens,
  type CollectorRow,
  type TokenRow,
} from "./useFleetApi";

const emit = defineEmits<{
  "open-collector": [collector: CollectorRow];
  "open-tokens": [fleetId: string];
}>();

const DAY_MS = 86_400_000;
const MAX_NAMES = 8;

interface ExpiringToken {
  token: TokenRow;
  collectors: CollectorRow[];
  daysLeft: number;
}

const { t } = useI18nTyped();
const tokens = useFleetTokens();
const collectors = useFleetCollectors();

// A collector keeps its last token, so an expiring token with collectors still on it is a coming outage.
const items = computed<ExpiringToken[]>(() => {
  const now = Date.now();
  const byToken = new Map<string, CollectorRow[]>();
  for (const c of collectors.rows.value) {
    if (c.tokenId) byToken.set(c.tokenId, [...(byToken.get(c.tokenId) ?? []), c]);
  }
  return tokens.rows.value
    .filter((tok) => tokenExpiresSoon(tok, now) || tokenState(tok, now) === "expired")
    .map((token) => ({
      token,
      collectors: byToken.get(token.id) ?? [],
      daysLeft: Math.ceil(((token.expiresAt as number) - now) / DAY_MS),
    }))
    .filter((item) => item.collectors.length > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);
});

function when(item: ExpiringToken): string {
  if (item.daysLeft <= 0) return t("fleet.tokenExpiry.expired");
  return t("fleet.tokenExpiry.expiresIn", { count: item.daysLeft }, item.daysLeft);
}
</script>
