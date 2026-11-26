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

// One rule: English text of fixed copy, numbers and `IDENT` identifiers; every other value travels in a chip.

export { REDACTED, isSecretKey, redactSecrets, redactText, withoutSecretKeys } from "./redact";
export {
  IDENT,
  MAX_PROMPT_WORDS,
  ident,
  promptRange,
  promptTime,
  queryChip,
  wordCount,
  type PromptBuild,
  type PromptRange,
} from "./format";
export { buildLogRowPrompt, logRowChip, modeText, type LogRowInput } from "./logs";
export {
  MAX_EXPLAIN_BYTES,
  MAX_EXPLAIN_ROWS,
  buildLogRowsPrompt,
  reproducingQuery,
  rowsOverCap,
  type LogRowsInput,
} from "./logs";
export { buildLogFieldPrompt, fieldValueOf, logFieldChip, type LogFieldInput } from "./logs";
export { buildRegexFieldPrompt, regexFieldChip, type RegexFieldInput } from "./logs";
export { buildQueryErrorPrompt, errorPlainText, type QueryErrorInput } from "./logs";
export { buildEmptyResultPrompt, type EmptyResultInput } from "./logs";
export { buildNoStreamPrompt, type NoStreamInput } from "./logs";
export { buildTracePrompt, type TraceInput } from "./traces";
export { MAX_SPAN_ATTRIBUTES, buildSpanPrompt, spanHasError, type SpanInput } from "./traces";
export { buildTracingQueryPrompt, buildTracingSetupPrompt, type TracingQueryInput } from "./traces";
export { buildPanelPrompt, type PanelInput } from "./metrics";
export {
  alertInputOf,
  buildAlertPrompt,
  thresholdText,
  type AlertInput,
  type AlertRecord,
} from "./alerts";
export { buildAlertFiringPrompt, type AlertFiringInput } from "./alerts";
export { buildMetricSeriesPrompt, labelSet, type MetricSeriesInput } from "./metrics";
export { buildServiceEdgePrompt, type ServiceEdgeInput } from "./traces";
export { buildIncidentReportPrompt, MAX_REPORT_CHARS, type IncidentReportInput } from "./alerts";
export { buildAutoObserveAskPrompt, MAX_ASK_CHARS, type AutoObserveAskInput } from "./autoobserve";
export { askAiQuery, buildIngestionPrompt, englishT, type AskAiContext } from "./ingestion";
export {
  buildBlockingFixPrompt,
  buildDbmFindingPrompt,
  buildDeadlockFixPrompt,
  buildQueryFixPrompt,
  type DbmFinding,
  type DbmFindingInput,
} from "./dbm";
