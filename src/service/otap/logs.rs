// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;
use opentelemetry_proto::tonic::common::v1::any_value::Value;
use opentelemetry_proto::tonic::common::v1::{AnyValue, InstrumentationScope};
use proto::otel_arrow::ArrowPayloadType;
use arrow::array::{
    Array, BooleanArray, Float64Array, Int64Array, RecordBatch, StructArray,
    TimestampNanosecondArray, UInt8Array, UInt16Array, UInt32Array,
};
use arrow::datatypes::{DataType, Fields};
use snafu::{OptionExt, ResultExt, ensure};

use super::arrays::{get_required_array, get_timestamp_nanosecond_array_opt, get_u16_array, get_u32_array_opt, ByteArrayAccessor, Int32ArrayAccessor, NullableArrayAccessor, StringArrayAccessor, StructColumnAccessor};
use super::consts;
use super::error::Error;
use super::store::{decode_pcommon_val, AttributeValueType};
use super::{decoder::RecordMessage, error, store::Attribute16Store};

use arrow::datatypes::Field;
use std::sync::LazyLock;


#[derive(Default)]
pub struct RelatedData {
    pub(crate) log_record_id: u16,

    pub(crate) res_attr_map_store: Attribute16Store,
    pub(crate) scope_attr_map_store: Attribute16Store,
    pub(crate) log_record_attr_map_store: Attribute16Store,
}

impl RelatedData {
    pub fn log_record_id_from_delta(&mut self, delta: u16) -> u16 {
        self.log_record_id += delta;
        self.log_record_id
    }

    /// returns an instance of self and also the index of the main log record
    /// in the input array.
    pub fn from_record_messages(rbs: &[RecordMessage]) -> error::Result<(Self, Option<usize>)> {
        let mut related_data = RelatedData::default();
        let mut logs_record_idx: Option<usize> = None;

        for (idx, rm) in rbs.iter().enumerate() {
            match rm.payload_type {
                ArrowPayloadType::Logs => logs_record_idx = Some(idx),
                ArrowPayloadType::ResourceAttrs => {
                    related_data.res_attr_map_store = Attribute16Store::try_from(&rm.record)?;
                }
                ArrowPayloadType::ScopeAttrs => {
                    related_data.scope_attr_map_store = Attribute16Store::try_from(&rm.record)?;
                }
                ArrowPayloadType::LogAttrs => {
                    related_data.log_record_attr_map_store =
                        Attribute16Store::try_from(&rm.record)?;
                }
                _ => {
                    return error::UnsupportedPayloadTypeSnafu {
                        actual: rm.payload_type,
                    }
                    .fail();
                }
            }
        }

        Ok((related_data, logs_record_idx))
    }
}


struct LogsArrays<'a> {
    id: &'a UInt16Array,
    schema_url: Option<StringArrayAccessor<'a>>,
    time_unix_nano: Option<&'a TimestampNanosecondArray>,
    observed_time_unix_nano: Option<&'a TimestampNanosecondArray>,
    trace_id: Option<ByteArrayAccessor<'a>>,
    span_id: Option<ByteArrayAccessor<'a>>,
    severity_number: Option<Int32ArrayAccessor<'a>>,
    severity_text: Option<StringArrayAccessor<'a>>,
    body: Option<LogBodyArrays<'a>>,
    dropped_attributes_count: Option<&'a UInt32Array>,
    flags: Option<&'a UInt32Array>,
}

impl<'a> TryFrom<&'a RecordBatch> for LogsArrays<'a> {
    type Error = Error;

    fn try_from(rb: &'a RecordBatch) -> error::Result<Self> {
        let id = get_u16_array(rb, consts::ID)?;
        let schema_url = rb
            .column_by_name(consts::SCHEMA_URL)
            .map(StringArrayAccessor::try_new)
            .transpose()?;

        let time_unix_nano = get_timestamp_nanosecond_array_opt(rb, consts::TIME_UNIX_NANO)?;
        let observed_time_unix_nano =
            get_timestamp_nanosecond_array_opt(rb, consts::OBSERVED_TIME_UNIX_NANO)?;
        let trace_id = rb
            .column_by_name(consts::TRACE_ID)
            .map(ByteArrayAccessor::try_new)
            .transpose()?;
        let span_id = rb
            .column_by_name(consts::SPAN_ID)
            .map(ByteArrayAccessor::try_new)
            .transpose()?;
        let severity_number = rb
            .column_by_name(consts::SEVERITY_NUMBER)
            .map(Int32ArrayAccessor::try_new)
            .transpose()?;
        let severity_text = rb
            .column_by_name(consts::SEVERITY_TEXT)
            .map(StringArrayAccessor::try_new)
            .transpose()?;

        let dropped_attributes_count = get_u32_array_opt(rb, consts::DROPPED_ATTRIBUTES_COUNT)?;
        let flags = get_u32_array_opt(rb, consts::FLAGS)?;

        let body = rb
            .column_by_name(consts::BODY)
            .map(|arr| {
                let logs_body = arr.as_any().downcast_ref::<StructArray>().context(
                    error::ColumnDataTypeMismatchSnafu {
                        name: consts::BODY,
                        actual: arr.data_type().clone(),
                        expect: DataType::Struct(Fields::default()),
                    },
                )?;

                LogBodyArrays::try_from(logs_body)
            })
            .transpose()?;

        Ok(Self {
            id,
            schema_url,
            time_unix_nano,
            observed_time_unix_nano,
            span_id,
            trace_id,
            severity_number,
            severity_text,
            body,
            dropped_attributes_count,
            flags,
        })
    }
}

struct LogBodyArrays<'a> {
    body: &'a StructArray,
    value_type: &'a UInt8Array,
    str: Option<StringArrayAccessor<'a>>,
    int: Option<&'a Int64Array>,
    double: Option<&'a Float64Array>,
    bool: Option<&'a BooleanArray>,
    bytes: Option<ByteArrayAccessor<'a>>,

    // ser is for serialized value type of AnyValue including "kvlist" and "array"
    ser: Option<ByteArrayAccessor<'a>>,
}

impl NullableArrayAccessor for LogBodyArrays<'_> {
    type Native = error::Result<AnyValue>;

    fn value_at(&self, idx: usize) -> Option<Self::Native> {
        if !self.body.is_valid(idx) {
            return None;
        }

        let value_type = AttributeValueType::try_from(self.value_type.value_at_or_default(idx))
            .context(error::UnrecognizedAttributeValueTypeSnafu);
        let value_type = match value_type {
            Ok(v) => v,
            Err(err) => {
                return Some(Err(err));
            }
        };

        if value_type == AttributeValueType::Slice || value_type == AttributeValueType::Map {
            let bytes = self.ser.value_at(idx)?;
            let decode_result = decode_pcommon_val(&bytes).transpose()?;
            return Some(decode_result.map(|val| AnyValue { value: Some(val) }));
        }

        let value = match value_type {
            AttributeValueType::Str => Value::StringValue(self.str.value_at_or_default(idx)),
            AttributeValueType::Int => Value::IntValue(self.int.value_at_or_default(idx)),
            AttributeValueType::Double => Value::DoubleValue(self.double.value_at_or_default(idx)),
            AttributeValueType::Bool => Value::BoolValue(self.bool.value_at_or_default(idx)),
            AttributeValueType::Bytes => Value::BytesValue(self.bytes.value_at_or_default(idx)),
            _ => {
                // silently ignore unknown types to avoid DOS attacks
                return None;
            }
        };

        Some(Ok(AnyValue { value: Some(value) }))
    }
}

impl<'a> TryFrom<&'a StructArray> for LogBodyArrays<'a> {
    type Error = Error;

    fn try_from(body: &'a StructArray) -> error::Result<Self> {
        let column_accessor = StructColumnAccessor::new(body);
        Ok(Self {
            body,
            value_type: column_accessor.primitive_column(consts::ATTRIBUTE_TYPE)?,
            str: column_accessor.string_column_op(consts::ATTRIBUTE_STR)?,
            int: column_accessor.primitive_column_op(consts::ATTRIBUTE_INT)?,
            double: column_accessor.primitive_column_op(consts::ATTRIBUTE_DOUBLE)?,
            bool: column_accessor.bool_column_op(consts::ATTRIBUTE_BOOL)?,
            bytes: column_accessor.byte_array_column_op(consts::ATTRIBUTE_BYTES)?,
            ser: column_accessor.byte_array_column_op(consts::ATTRIBUTE_SER)?,
        })
    }
}


pub struct ResourceArrays<'a> {
    pub id: &'a UInt16Array,
    pub dropped_attributes_count: Option<&'a UInt32Array>,
    pub schema_url: Option<StringArrayAccessor<'a>>,
}

static RESOURCE_ARRAY_DATA_TYPE: LazyLock<DataType> = LazyLock::new(|| {
    DataType::Struct(Fields::from(vec![
        Field::new(consts::ID, DataType::UInt16, true),
        Field::new(consts::DROPPED_ATTRIBUTES_COUNT, DataType::UInt32, true),
        Field::new(
            consts::SCHEMA_URL,
            DataType::Dictionary(Box::new(DataType::UInt8), Box::new(DataType::Utf8)),
            true,
        ),
    ]))
});

impl ResourceArrays<'_> {
    fn data_type() -> &'static DataType {
        &RESOURCE_ARRAY_DATA_TYPE
    }
}

impl<'a> TryFrom<&'a RecordBatch> for ResourceArrays<'a> {
    type Error = error::Error;

    fn try_from(rb: &'a RecordBatch) -> Result<Self, Self::Error> {
        let struct_array = get_required_array(rb, consts::RESOURCE)?;
        let struct_array = struct_array
            .as_any()
            .downcast_ref::<StructArray>()
            .with_context(|| error::ColumnDataTypeMismatchSnafu {
                name: consts::RESOURCE,
                actual: struct_array.data_type().clone(),
                expect: Self::data_type().clone(),
            })?;

        let struct_col_accessor = StructColumnAccessor::new(struct_array);

        Ok(Self {
            id: struct_col_accessor.primitive_column(consts::ID)?,
            dropped_attributes_count: struct_col_accessor
                .primitive_column_op(consts::DROPPED_ATTRIBUTES_COUNT)?,
            schema_url: struct_col_accessor.string_column_op(consts::SCHEMA_URL)?,
        })
    }
}

pub struct ScopeArrays<'a> {
    pub name: Option<StringArrayAccessor<'a>>,
    pub version: Option<StringArrayAccessor<'a>>,
    pub dropped_attributes_count: Option<&'a UInt32Array>,
    pub id: Option<&'a UInt16Array>,
}

pub static SCOPE_ARRAY_DATA_TYPE: LazyLock<DataType> = LazyLock::new(|| {
    DataType::Struct(Fields::from(vec![
        Field::new(
            consts::NAME,
            DataType::Dictionary(Box::new(DataType::UInt8), Box::new(DataType::Utf8)),
            true,
        ),
        Field::new(consts::VERSION, DataType::Utf8, true),
        Field::new(consts::DROPPED_ATTRIBUTES_COUNT, DataType::UInt32, true),
        Field::new(consts::ID, DataType::UInt16, true),
    ]))
});

impl ScopeArrays<'_> {
    fn data_type() -> &'static DataType {
        &SCOPE_ARRAY_DATA_TYPE
    }

    pub fn create_instrumentation_scope(&self, idx: usize) -> InstrumentationScope {
        InstrumentationScope {
            name: self.name.value_at(idx).unwrap_or_default(),
            version: self.version.value_at_or_default(idx),
            dropped_attributes_count: self.dropped_attributes_count.value_at_or_default(idx),
            attributes: vec![],
        }
    }
}

impl<'a> TryFrom<&'a RecordBatch> for ScopeArrays<'a> {
    type Error = error::Error;

    fn try_from(rb: &'a RecordBatch) -> Result<Self, Self::Error> {
        let struct_array = get_required_array(rb, consts::RESOURCE)?;
        let scope_array = struct_array
            .as_any()
            .downcast_ref::<StructArray>()
            .with_context(|| error::ColumnDataTypeMismatchSnafu {
                name: consts::RESOURCE,
                actual: struct_array.data_type().clone(),
                expect: Self::data_type().clone(),
            })?;
        let struct_col_accessor = StructColumnAccessor::new(scope_array);

        Ok(Self {
            name: struct_col_accessor.string_column_op(consts::NAME)?,
            version: struct_col_accessor.string_column_op(consts::VERSION)?,
            dropped_attributes_count: struct_col_accessor
                .primitive_column_op(consts::DROPPED_ATTRIBUTES_COUNT)?,
            id: struct_col_accessor.primitive_column_op(consts::ID)?,
        })
    }
}

pub trait AppendAndGet<T> {
    fn append_and_get(&mut self) -> &mut T;
}

impl<T> AppendAndGet<T> for Vec<T>
where
    T: Default,
{
    fn append_and_get(&mut self) -> &mut T {
        self.push(T::default());
        self.last_mut().expect("vec is not empty")
    }
}

pub fn logs_from(
    rb: &RecordBatch,
    related_data: &mut RelatedData,
) -> error::Result<ExportLogsServiceRequest> {
    let mut logs = ExportLogsServiceRequest::default();
    let mut prev_res_id: Option<u16> = None;
    let mut prev_scope_id: Option<u16> = None;

    let mut res_id = 0;
    let mut scope_id = 0;

    let resource_arrays = ResourceArrays::try_from(rb)?;
    let scope_arrays = ScopeArrays::try_from(rb)?;
    let logs_arrays = LogsArrays::try_from(rb)?;

    for idx in 0..rb.num_rows() {
        let res_delta_id = resource_arrays.id.value_at(idx).unwrap_or_default();
        res_id += res_delta_id;

        if prev_res_id != Some(res_id) {
            // new resource id
            prev_res_id = Some(res_id);
            let resource_logs = logs.resource_logs.append_and_get();
            prev_scope_id = None;

            // Update the resource field of the current resource logs
            let resource = resource_logs.resource.get_or_insert_default();
            if let Some(dropped_attributes_count) =
                resource_arrays.dropped_attributes_count.value_at(idx)
            {
                resource.dropped_attributes_count = dropped_attributes_count;
            }

            if let Some(res_id) = resource_arrays.id.value_at(idx) {
                if let Some(attrs) = related_data
                    .res_attr_map_store
                    .attribute_by_delta_id(res_id)
                {
                    resource.attributes = attrs.to_vec();
                }
            }

            resource_logs.schema_url = resource_arrays.schema_url.value_at(idx).unwrap_or_default();
        }

        let scope_delta_id_opt = scope_arrays.id.value_at(idx);
        scope_id += scope_delta_id_opt.unwrap_or_default();

        if prev_scope_id != Some(scope_id) {
            prev_scope_id = Some(scope_id);
            let mut scope = scope_arrays.create_instrumentation_scope(idx);
            if let Some(scope_id) = scope_delta_id_opt {
                if let Some(attrs) = related_data
                    .scope_attr_map_store
                    .attribute_by_delta_id(scope_id)
                {
                    scope.attributes = attrs.to_vec();
                }
            }

            // safety: we must have appended at least one resource logs when reach here
            let current_scope_logs_slice = &mut logs
                .resource_logs
                .last_mut()
                .expect("At this stage, we should have at least one resource log.")
                .scope_logs;
            let scope_logs = current_scope_logs_slice.append_and_get();
            scope_logs.scope = Some(scope);
            scope_logs.schema_url = logs_arrays.schema_url.value_at(idx).unwrap_or_default();
        }

        // safety: we've appended at least one value at each slice when reach here.
        let current_scope_logs = &mut logs
            .resource_logs
            .last_mut()
            .expect("At this stage, we should have at least one resource log.")
            .scope_logs
            .last_mut()
            .expect("At this stage, we should have added at least one scope log.");

        let current_log_record = current_scope_logs.log_records.append_and_get();
        let delta_id = logs_arrays.id.value_at_or_default(idx);
        let log_id = related_data.log_record_id_from_delta(delta_id);

        current_log_record.time_unix_nano =
            logs_arrays.time_unix_nano.value_at_or_default(idx) as u64;
        current_log_record.observed_time_unix_nano =
            logs_arrays.observed_time_unix_nano.value_at_or_default(idx) as u64;

        if let Some(trace_id_bytes) = logs_arrays.trace_id.value_at(idx) {
            ensure!(trace_id_bytes.len() == 16, error::InvalidTraceIdSnafu {
                message: format!(
                    "log_id = {}, index = {}, trace_id = {:?}",
                    log_id, idx, trace_id_bytes
                ),
            });
            current_log_record.trace_id = trace_id_bytes
        }

        if let Some(span_id_bytes) = logs_arrays.span_id.value_at(idx) {
            ensure!(span_id_bytes.len() == 8, error::InvalidSpanIdSnafu {
                message: format!(
                    "log_id = {}, index = {}, span_id = {:?}",
                    log_id, idx, span_id_bytes
                ),
            });
            current_log_record.span_id = span_id_bytes;
        }

        current_log_record.severity_number = logs_arrays.severity_number.value_at_or_default(idx);
        current_log_record.severity_text = logs_arrays.severity_text.value_at_or_default(idx);
        current_log_record.dropped_attributes_count = logs_arrays
            .dropped_attributes_count
            .value_at_or_default(idx);
        current_log_record.flags = logs_arrays.flags.value_at_or_default(idx);

        if let Some(body_val) = logs_arrays.body.value_at(idx) {
            current_log_record.body = Some(body_val?)
        }

        if let Some(attrs) = related_data
            .log_record_attr_map_store
            .attribute_by_id(delta_id)
        {
            current_log_record.attributes = attrs.to_vec();
        }
    }

    Ok(logs)
}
