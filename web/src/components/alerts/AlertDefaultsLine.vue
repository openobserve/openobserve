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

<!-- What a starter saves with, each part a jump to its setting, so Save from step 1 hides nothing. -->
<script setup lang="ts">
import { inject } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { AlertSaveDefaults } from "@/composables/alerts/useAlertFormSections";
import { ALERT_FORM_CONTEXT_KEY } from "./alertFormContext";

const props = defineProps<{
  defaults: AlertSaveDefaults;
  /** The name the alert saves as: the typed one, else the suggestion. */
  name: string;
}>();

const { t } = useI18nTyped();
const formContext = inject(ALERT_FORM_CONTEXT_KEY, null);
const open = (id: string) => void formContext?.openSetting?.(id);
const separator = raw(" · ");
</script>

<!-- Two lines held from first paint, so a longer destination or name never moves what is below. -->
<template>
  <p
    class="text-text-secondary m-0 min-h-8 min-w-0 text-xs leading-4 break-words"
    data-test="add-alert-defaults-line"
  >
    <i18n-t
      v-if="props.defaults.targets"
      keypath="alerts.intent.defaults.sendsTo"
      tag="span"
      scope="global"
    >
      <template #targets>
        <OButton
          variant="link"
          size="xs"
          data-test="add-alert-defaults-destination"
          @click="open('destinations')"
          >{{ props.defaults.targets }}</OButton
        >
      </template>
    </i18n-t>
    <template v-else>
      <span>{{ t("alerts.intent.defaults.tellsNobody") }}</span
      >{{ separator
      }}<OButton
        variant="link"
        size="xs"
        data-test="add-alert-defaults-destination"
        @click="open('destinations')"
        >{{ t("alerts.intent.defaults.pickDestination") }}</OButton
      >
    </template>
    <template v-if="props.defaults.every"
      >{{ separator
      }}<i18n-t keypath="alerts.intent.defaults.checksEvery" tag="span" scope="global">
        <template #every>
          <OButton
            variant="link"
            size="xs"
            data-test="add-alert-defaults-check-every"
            @click="open('checkEvery')"
            >{{ props.defaults.every }}</OButton
          >
        </template>
      </i18n-t></template
    >
    <template v-if="props.defaults.repeat"
      >{{ separator
      }}<i18n-t
        :keypath="
          props.defaults.group
            ? 'alerts.intent.defaults.repeatsEveryPer'
            : 'alerts.intent.defaults.repeatsEvery'
        "
        tag="span"
        scope="global"
      >
        <template #every>
          <OButton
            variant="link"
            size="xs"
            data-test="add-alert-defaults-repeat"
            @click="open('cooldown')"
            >{{ props.defaults.repeat }}</OButton
          >
        </template>
        <template #group>{{ props.defaults.group }}</template>
      </i18n-t></template
    >
    <template v-if="props.name"
      >{{ separator
      }}<i18n-t keypath="alerts.intent.defaults.named" tag="span" scope="global">
        <template #name>
          <OButton
            variant="link"
            size="xs"
            class="break-all"
            data-test="add-alert-defaults-name"
            @click="open('name')"
            >{{ raw(props.name) }}</OButton
          >
        </template>
      </i18n-t></template
    >
  </p>
</template>
