// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Shared LLM trace-stream loader, extracted verbatim from
// SessionsList.vue's loadTraceStreams/ensureStreamsLoaded so Behavior,
// Sessions, and LLM Insights pages share one implementation. Behavior is
// byte-identical to the original — do not "improve" the filter or error
// handling here.

import { ref, type Ref } from "vue";
import type { TranslateFn } from "@/types/i18n";
import useStreams from "@/composables/useStreams";

export function useLlmTraceStreams(activeStream: Ref<string>, t: TranslateFn) {
  const { getStreams } = useStreams(t);

  const availableStreams = ref<string[]>([]);
  const streamsLoaded = ref(false);

  // Load the trace-stream list at most once per mount. Both the initial
  // mount and the (parent-driven) session load await the SAME promise, so a
  // load can neither race ahead of the stream list nor trigger a second
  // stream fetch.
  let streamsPromise: Promise<void> | null = null;
  function ensureStreamsLoaded(): Promise<void> {
    if (!streamsPromise) streamsPromise = loadTraceStreams();
    return streamsPromise;
  }

  async function loadTraceStreams() {
    streamsLoaded.value = false;
    try {
      const res: any = await getStreams("traces", false, false);
      const list = res?.list || [];
      const llmStreams = list.filter((stream: any) => stream?.settings?.is_llm_stream !== false);
      availableStreams.value = llmStreams.map((stream: any) => stream.name);
      if (!availableStreams.value.includes(activeStream.value)) {
        activeStream.value = availableStreams.value[0] || "";
      }
    } catch (e) {
      console.error("Error loading trace streams:", e);
      availableStreams.value = [];
      activeStream.value = "";
    } finally {
      streamsLoaded.value = true;
    }
  }

  return { availableStreams, streamsLoaded, loadTraceStreams, ensureStreamsLoaded };
}
