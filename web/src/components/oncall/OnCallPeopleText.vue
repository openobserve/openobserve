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

<!-- A server sentence with every email in it read as the person's display name. -->
<template>
  <template v-for="(part, index) in parts" :key="index">
    <OnCallPersonName v-if="part.email" :email="part.email" data-test="oncall-people-text-person" />
    <template v-else>{{ part.text }}</template>
  </template>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OnCallPersonName from "./OnCallPersonName.vue";
import type { I18nText } from "@/types/i18n";
import { raw } from "@/types/i18n";

const props = defineProps<{ text: I18nText | string }>();

/// Deliberately loose: anything shaped like an address is a person on these sentences.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

const parts = computed<{ text: I18nText; email?: string }[]>(() => {
  const text = String(props.text);
  const out: { text: I18nText; email?: string }[] = [];
  let from = 0;
  for (const match of text.matchAll(EMAIL)) {
    const at = match.index ?? 0;
    if (at > from) out.push({ text: raw(text.slice(from, at)) });
    out.push({ text: raw(match[0]), email: match[0] });
    from = at + match[0].length;
  }
  if (from < text.length) out.push({ text: raw(text.slice(from)) });
  return out;
});
</script>
