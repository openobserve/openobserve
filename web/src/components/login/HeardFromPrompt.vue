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
  <!-- Clearly optional and one click: an answer sends at once, Skip hides it for good. -->
  <div
    v-if="visible"
    class="flex flex-wrap items-center gap-x-2 gap-y-2"
    data-test="heard-from-prompt"
  >
    <span class="text-text-secondary text-compact">{{ t("login.heardFrom.quickQuestion") }}</span>
    <OButton
      v-for="o in options"
      :key="o.value"
      variant="outline"
      size="xs"
      :disabled="sending"
      :data-test="`heard-from-prompt-option-${o.value}`"
      @click="answer(o.value)"
    >
      {{ o.label }}
    </OButton>
    <OButton
      variant="ghost-muted"
      size="xs"
      :disabled="sending"
      data-test="heard-from-prompt-dismiss-btn"
      @click="dismiss"
    >
      {{ t("login.heardFrom.skip") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import billings from "@/services/billings";
import analytics from "@/services/product_analytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { readFirstSource } from "./firstSourceOptions";
import {
  HEARD_FROM_VALUES,
  clearHeardFromPending,
  useHeardFromPending,
  useHeardFromSending,
  type HeardFromValue,
} from "./heardFrom";

const props = defineProps<{ org: string }>();

const { t } = useI18nTyped();
const store = useStore();
const email = (): string | undefined => store.state.userInfo?.email;

const visible = useHeardFromPending(email);
const sending = useHeardFromSending(email);

const labels = computed<Record<HeardFromValue, I18nText>>(() => ({
  search_engine: t("login.heardFrom.searchEngine"),
  friend_or_colleague: t("login.heardFrom.friendOrColleague"),
  ai_assistant: t("login.heardFrom.aiAssistant"),
  github: raw("GitHub"),
  linkedin: raw("LinkedIn"),
  reddit: raw("Reddit"),
  youtube: raw("YouTube"),
  other: t("login.heardFrom.other"),
}));
const options = computed(() =>
  HEARD_FROM_VALUES.map((value) => ({ value, label: labels.value[value] })),
);

const answer = async (value: unknown) => {
  const from = HEARD_FROM_VALUES.find((v) => v === value);
  if (!from || sending.value || !visible.value) return;
  // Logout can clear the user before the reply lands, so the answer settles who clicked.
  const who = email();
  const mine = useHeardFromSending(() => who);
  mine.value = true;
  try {
    const res = await billings.submit_new_user_info(props.org, {
      from,
      company: "",
      first_source: readFirstSource(props.org),
      skipped: false,
    });
    if (res.status === 200) {
      clearHeardFromPending(who);
      toast({ message: t("login.heardFrom.thanks"), variant: "success" });
      analytics.track("onboarding_heard_from_answered", { from });
      return;
    }
  } catch {
    // Same toast as a non-200 answer; the question stays so the user can try again.
  } finally {
    mine.value = false;
  }
  toast({ message: t("toastMessages.login.somethingWentWrong"), variant: "error" });
};

const dismiss = () => {
  clearHeardFromPending(email());
  analytics.track("onboarding_heard_from_dismissed");
};
</script>
