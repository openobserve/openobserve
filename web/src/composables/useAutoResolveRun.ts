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

import { onScopeDispose, ref, watch, type Ref } from "vue";
import autoresolve, {
  autoresolveErrorStatus,
  isForbidden,
  isTerminalRunState,
  type AutoResolveRun,
} from "@/services/autoresolve";
import { useOrgId } from "@/composables/query/useOrgId";
import { useI18nTyped, type I18nText } from "@/types/i18n";

/** The waits before each reconnect of a dropped live stream; the last repeats. */
const LIVE_RECONNECT_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/** One run, kept current by its live stream until the run ends or the stream is refused. */
export function useAutoResolveRun(runId: Ref<string>) {
  const { t } = useI18nTyped();
  const orgId = useOrgId();
  const run = ref<AutoResolveRun | null>(null);
  const live = ref(false);
  const reconnecting = ref(false);
  const error = ref<I18nText | null>(null);
  /** The HTTP status behind `error`, so a refusal and a missing run can look different. */
  const errorStatus = ref<number | null>(null);

  let connection: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnects = 0;

  /** Reads the run once; the only read path besides the live stream. */
  const refresh = async (): Promise<void> => {
    const id = runId.value;
    const { data } = await autoresolve.getRun(orgId.value, id);
    if (runId.value !== id) return;
    run.value = data;
    // A replan or an approval can make a run whose stream already closed live again.
    if (!live.value && !isTerminalRunState(data.state)) open();
  };

  const closeLive = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    connection?.abort();
    connection = null;
  };

  const stop = () => {
    closeLive();
    live.value = false;
    reconnecting.value = false;
  };

  const open = () => {
    closeLive();
    const id = runId.value;
    const org = orgId.value;
    if (!id || !org || isTerminalRunState(run.value?.state)) {
      stop();
      return;
    }
    const controller = new AbortController();
    connection = controller;
    live.value = true;
    // A drop, a network error or a 5xx keeps the last snapshot; the wait grows until an event arrives.
    // The server closes every stream after 300 s, so a close after events reconnects without a notice.
    let delivered = false;
    const reconnect = () => {
      if (connection !== controller) return;
      if (!delivered) reconnecting.value = true;
      const wait = LIVE_RECONNECT_MS[Math.min(reconnects, LIVE_RECONNECT_MS.length - 1)];
      reconnects += 1;
      reconnectTimer = setTimeout(open, wait);
    };
    autoresolve
      .openAutoResolveLiveStream(org, id, {
        signal: controller.signal,
        onEvent: (event) => {
          if (connection !== controller) return;
          delivered = true;
          reconnects = 0;
          reconnecting.value = false;
          if (event.event === "snapshot") run.value = event.data;
          // The stream can end before its last snapshot lands; read the run once so the page shows the end.
          if (event.event === "end" && event.data.state && event.data.state !== run.value?.state) {
            void refresh().catch((err: unknown) =>
              console.error("AutoResolve run refresh failed:", err),
            );
          }
          if (event.event === "end" || isTerminalRunState(run.value?.state)) stop();
        },
      })
      .then(({ ended }) => {
        if (!ended) reconnect();
        else if (connection === controller) stop();
      })
      .catch((err: unknown) => {
        if (connection !== controller) return;
        const forbidden = isForbidden(err);
        if (forbidden || autoresolveErrorStatus(err) === 404) {
          stop();
          errorStatus.value = forbidden ? 403 : 404;
          error.value = forbidden ? t("autoresolve.runForbidden") : t("autoresolve.runNotFound");
          return;
        }
        console.error("AutoResolve live stream failed:", err);
        reconnect();
      });
  };

  /** Starts over from nothing: on a new run or org, and when the user retries after a failure. */
  const restart = () => {
    run.value = null;
    error.value = null;
    errorStatus.value = null;
    reconnects = 0;
    open();
  };

  watch([runId, orgId] as const, restart, { immediate: true });

  onScopeDispose(stop);

  return { run, live, reconnecting, error, errorStatus, refresh, retry: restart };
}
