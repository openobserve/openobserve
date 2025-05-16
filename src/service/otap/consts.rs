// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

pub const ID: &str = "id";
pub const PARENT_ID: &str = "parent_id";

pub const METRIC_TYPE: &str = "metric_type";

pub const RESOURCE_METRICS: &str = "resource_metrics";
pub const TIME_UNIX_NANO: &str = "time_unix_nano";
pub const START_TIME_UNIX_NANO: &str = "start_time_unix_nano";
pub const DURATION_TIME_UNIX_NANO: &str = "duration_time_unix_nano";
pub const OBSERVED_TIME_UNIX_NANO: &str = "observed_time_unix_nano";
pub const SEVERITY_NUMBER: &str = "severity_number";
pub const SEVERITY_TEXT: &str = "severity_text";
pub const DROPPED_ATTRIBUTES_COUNT: &str = "dropped_attributes_count";
pub const DROPPED_EVENTS_COUNT: &str = "dropped_events_count";
pub const DROPPED_LINKS_COUNT: &str = "dropped_links_count";
pub const FLAGS: &str = "flags";
pub const TRACE_ID: &str = "trace_id";
pub const TRACE_STATE: &str = "trace_state";
pub const SPAN_ID: &str = "span_id";
pub const PARENT_SPAN_ID: &str = "parent_span_id";
pub const ATTRIBUTES: &str = "attributes";
pub const RESOURCE: &str = "resource";
pub const SCOPE_METRICS: &str = "scope_metrics";
pub const SCOPE: &str = "scope";
pub const NAME: &str = "name";
pub const KIND: &str = "kind";
pub const VERSION: &str = "version";
pub const BODY: &str = "body";
pub const STATUS: &str = "status";
pub const DESCRIPTION: &str = "description";
pub const UNIT: &str = "unit";
pub const DATA: &str = "data";
pub const STATUS_MESSAGE: &str = "status_message";
pub const STATUS_CODE: &str = "code";
pub const SUMMARY_COUNT: &str = "count";
pub const SUMMARY_SUM: &str = "sum";
pub const SUMMARY_QUANTILE_VALUES: &str = "quantile";
pub const SUMMARY_QUANTILE: &str = "quantile";
pub const SUMMARY_VALUE: &str = "value";
pub const METRIC_VALUE: &str = "value";
pub const INT_VALUE: &str = "int_value";
pub const DOUBLE_VALUE: &str = "double_value";
pub const HISTOGRAM_COUNT: &str = "count";
pub const HISTOGRAM_SUM: &str = "sum";
pub const HISTOGRAM_MIN: &str = "min";
pub const HISTOGRAM_MAX: &str = "max";
pub const HISTOGRAM_BUCKET_COUNTS: &str = "bucket_counts";
pub const HISTOGRAM_EXPLICIT_BOUNDS: &str = "explicit_bounds";
pub const EXP_HISTOGRAM_SCALE: &str = "scale";
pub const EXP_HISTOGRAM_ZERO_COUNT: &str = "zero_count";
pub const EXP_HISTOGRAM_POSITIVE: &str = "positive";
pub const EXP_HISTOGRAM_NEGATIVE: &str = "negative";
pub const EXP_HISTOGRAM_OFFSET: &str = "offset";
pub const EXP_HISTOGRAM_BUCKET_COUNTS: &str = "bucket_counts";
pub const SCHEMA_URL: &str = "schema_url";
pub const I64_METRIC_VALUE: &str = "i64";
pub const F64_METRIC_VALUE: &str = "f64";
pub const EXEMPLARS: &str = "exemplars";
pub const IS_MONOTONIC: &str = "is_monotonic";
pub const AGGREGATION_TEMPORALITY: &str = "aggregation_temporality";

pub const ATTRIBUTE_KEY: &str = "key";
pub const ATTRIBUTE_TYPE: &str = "type";
pub const ATTRIBUTE_STR: &str = "str";
pub const ATTRIBUTE_INT: &str = "int";
pub const ATTRIBUTE_DOUBLE: &str = "double";
pub const ATTRIBUTE_BOOL: &str = "bool";
pub const ATTRIBUTE_BYTES: &str = "bytes";
pub const ATTRIBUTE_SER: &str = "ser";
