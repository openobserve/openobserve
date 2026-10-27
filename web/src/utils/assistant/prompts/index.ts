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
export { buildLogRowPrompt, logRowChip, modeText, type LogRowInput } from "./logRow";
export {
  MAX_EXPLAIN_BYTES,
  MAX_EXPLAIN_ROWS,
  buildLogRowsPrompt,
  reproducingQuery,
  rowsOverCap,
  type LogRowsInput,
} from "./logRows";
export { buildLogFieldPrompt, fieldValueOf, logFieldChip, type LogFieldInput } from "./logField";
export { buildRegexFieldPrompt, regexFieldChip, type RegexFieldInput } from "./regexField";
export { buildQueryErrorPrompt, errorPlainText, type QueryErrorInput } from "./queryError";
export { buildEmptyResultPrompt, type EmptyResultInput } from "./emptyResult";
export { buildNoStreamPrompt, type NoStreamInput } from "./noStream";
export { buildTracePrompt, type TraceInput } from "./trace";
export { MAX_SPAN_ATTRIBUTES, buildSpanPrompt, spanHasError, type SpanInput } from "./span";
export {
  buildTracingQueryPrompt,
  buildTracingSetupPrompt,
  type TracingQueryInput,
} from "./tracing";
export { buildPanelPrompt, type PanelInput } from "./panel";
export {
  alertInputOf,
  buildAlertPrompt,
  thresholdText,
  type AlertInput,
  type AlertRecord,
} from "./alert";
export { buildAlertFiringPrompt, type AlertFiringInput } from "./alertFiring";
export { buildMetricSeriesPrompt, labelSet, type MetricSeriesInput } from "./metricSeries";
export { buildServiceEdgePrompt, type ServiceEdgeInput } from "./serviceEdge";
export { buildIncidentReportPrompt, MAX_REPORT_CHARS, type IncidentReportInput } from "./incident";
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
