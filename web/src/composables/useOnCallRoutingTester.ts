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

import { ref, type Ref } from "vue";
import { useMutation } from "@tanstack/vue-query";

import type { SimulatorQuery } from "@/components/oncall/OnCallRoutingSimulator.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import oncallService from "@/services/oncall";
import { testPageMutation } from "@/services/oncall.queries";
import type { RoutingPreview, TestPageResult, UnroutedSignal } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { useI18nTyped } from "@/types/i18n";
import { claimableDimensions } from "@/utils/oncall";

/** Test routing's state and calls, shared by org Routing and a team's Routing tab so both open the same drawer the same way. */
export function useOnCallRoutingTester(options: {
  orgId: Ref<string>;
  signals: Ref<UnroutedSignal[]>;
  onError: (err: unknown, fallback: I18nText) => void;
  onSendError?: (err: unknown, fallback: I18nText) => void;
}) {
  const { t } = useI18nTyped();
  const { noteConfigurationDenied } = useOnCallPermissions();
  const testPageWrite = useMutation(() => testPageMutation(options.orgId.value));

  const open = ref(false);
  /// A fresh object each open, so the simulator's rows re-seed.
  const seed = ref<Record<string, string> | null>(null);
  const preview = ref<RoutingPreview | null>(null);
  const testing = ref(false);
  const sending = ref(false);
  const testResult = ref<TestPageResult | null>(null);
  let latestRun = 0;

  /// Opens on a real alert shape: the given rule, else the signal that fell through most.
  function openTester(dimensions?: Record<string, string>) {
    const top = [...options.signals.value].sort((a, b) => b.occurrences - a.occurrences)[0];
    seed.value = { ...(dimensions ?? (top ? claimableDimensions(top.dimensions) : {})) };
    latestRun += 1;
    preview.value = null;
    testing.value = false;
    testResult.value = null;
    open.value = true;
  }

  async function run(query: SimulatorQuery) {
    const runId = ++latestRun;
    testing.value = true;
    testResult.value = null;
    try {
      // Uncached: the answer belongs to this query alone.
      const res = await oncallService.previewRouting({
        org_identifier: options.orgId.value,
        data: { dimensions: query.dimensions },
      });
      if (runId === latestRun) preview.value = res.data;
    } catch (err) {
      if (runId === latestRun) options.onError(err, t("oncall.testRoutingFailed"));
    } finally {
      if (runId === latestRun) testing.value = false;
    }
  }

  /// This one really sends; the dry run above does not, which is why they are separate calls.
  async function sendTest(value: { team_id: string; priority: string }) {
    sending.value = true;
    testResult.value = null;
    try {
      const res = await testPageWrite.mutateAsync({
        teamId: value.team_id,
        priority: Number(value.priority.replace(/^P/i, "")) || undefined,
      });
      testResult.value = res.data ?? null;
    } catch (err) {
      noteConfigurationDenied(err);
      (options.onSendError ?? options.onError)(err, t("oncall.testPageFailed"));
    } finally {
      sending.value = false;
    }
  }

  return { open, seed, preview, testing, sending, testResult, openTester, run, sendTest };
}
