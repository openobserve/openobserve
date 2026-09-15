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

<!-- What a flagged user sees under restrict_writes, opened by the http interceptor on the first
     refused write. Cancellable: reads still work, and trapping someone who only wanted to look
     would be worse than the restriction itself. -->
<template>
  <ODialog
    :open="isRestrictedPromptOpen"
    data-test="password-restricted-dialog"
    size="sm"
    :title="t('passwordReset.restrictedTitle')"
    :secondary-button-label="t('passwordReset.restrictedLater')"
    :primary-button-label="t('passwordReset.submit')"
    @update:open="(open: boolean) => !open && closeRestrictedPrompt()"
    @click:secondary="closeRestrictedPrompt"
    @click:primary="updatePassword"
  >
    <OBanner variant="warning" icon="warning" :content="t('passwordReset.restrictedMessage')" />
  </ODialog>
</template>

<script setup lang="ts">
import { usePasswordReset } from "@/composables/usePasswordReset";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const { isRestrictedPromptOpen, reason, closeRestrictedPrompt, openVoluntarily } =
  usePasswordReset();

const updatePassword = () => {
  const why = reason.value ?? "policy_tightened";
  closeRestrictedPrompt();
  openVoluntarily(why);
};
</script>
