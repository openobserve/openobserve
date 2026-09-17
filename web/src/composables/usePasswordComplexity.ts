// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, ref } from "vue";
import { useStore } from "vuex";

import { remediationOrg } from "@/composables/usePasswordReset";
import passwordPolicy, { type PasswordComplexity } from "@/services/passwordPolicy";
import { useI18nTyped } from "@/types/i18n";
import { buildPasswordRequirements, DEFAULT_COMPLEXITY } from "@/utils/passwordComplexity";

// Module scope so the last answer stays visible while a reopen refetches.
const complexity = ref<PasswordComplexity | null>(null);
let inFlight: Promise<void> | null = null;

/** `loaded` false must not block submit: the server validates regardless, and a missing hint is recoverable. */
export function usePasswordComplexity() {
  const store = useStore();
  const { t } = useI18nTyped();
  const error = ref(false);
  const loading = ref(false);

  // Always refetch: the policy can change in Settings within the same session.
  const load = async () => {
    if (inFlight) return inFlight;

    loading.value = true;
    error.value = false;
    const org = remediationOrg(store);

    inFlight = passwordPolicy
      .getComplexity(org)
      .then((response: any) => {
        complexity.value = response.data;
      })
      .catch(() => {
        error.value = true;
      })
      .finally(() => {
        loading.value = false;
        inFlight = null;
      });

    return inFlight;
  };

  const effective = computed<PasswordComplexity>(() => complexity.value ?? DEFAULT_COMPLEXITY);
  const loaded = computed(() => complexity.value !== null);
  const requirements = computed(() => buildPasswordRequirements(effective.value, t));

  return { complexity: effective, requirements, loaded, loading, error, load };
}

/** Test seam: drops the module-level cache so each case starts from a known state. */
export const resetPasswordComplexityCache = () => {
  complexity.value = null;
  inFlight = null;
};
