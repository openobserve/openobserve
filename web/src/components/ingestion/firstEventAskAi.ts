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
import type { InjectionKey } from "vue";

export {
  REJECTION_REASON_KEYS,
  askAiQuery,
  type AskAiContext,
} from "@/utils/assistant/prompts/ingestion";

/** Provided by the Ingestion page; opens the AI chat prefilled with the query and does not send it. */
export const FIRST_EVENT_ASK_AI: InjectionKey<(query: string) => void> = Symbol("firstEventAskAi");
