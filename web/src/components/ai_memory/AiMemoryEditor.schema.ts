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

import { z } from "zod";
import type { Memory } from "@/services/ai_memory";

export const makeAiMemorySchema = (t: (_k: string) => string) => {
  // A number input emits a string; empty means "leave the limit as it is".
  const kib = z
    .any()
    .refine(
      (v) => v === "" || (Number.isFinite(Number(v)) && Number(v) > 0),
      t("aiMemory.sizeInvalid"),
    );
  return z.object({
    content: z.string(),
    // "" is the toolset's "inherit" or the org's "default".
    agent_memory_writes: z.enum(["inherit", "review", "auto", "off"]),
    user_writes: z.boolean(),
    max_kib: kib,
    user_max_kib: kib,
  });
};

export type AiMemoryForm = z.infer<ReturnType<typeof makeAiMemorySchema>>;

export const aiMemoryDefaults = (m?: Memory | null): AiMemoryForm => ({
  content: m?.content ?? "",
  agent_memory_writes: ["review", "auto", "off"].includes(m?.agent_memory_writes ?? "")
    ? (m!.agent_memory_writes as AiMemoryForm["agent_memory_writes"])
    : "inherit",
  user_writes: m ? m.agent_memory_writes_effective !== "off" : true,
  max_kib: m?.max_bytes ? String(Math.round(m.max_bytes / 1024)) : "",
  // A 0 here failed validation on a field toolset and user memories never show, so Save did nothing.
  user_max_kib: m?.user_max_bytes ? String(Math.round(m.user_max_bytes / 1024)) : "",
});
