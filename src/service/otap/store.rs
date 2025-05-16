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

use arrow::array::{ArrowPrimitiveType, PrimitiveArray, RecordBatch};
use num_enum::TryFromPrimitive;
use opentelemetry_proto::tonic::common::v1::{AnyValue, ArrayValue, KeyValueList};
use opentelemetry_proto::tonic::common::v1::{any_value::Value, KeyValue};
use snafu::{OptionExt, ResultExt};
use std::collections::HashMap;
use arrow::datatypes::{UInt16Type, UInt32Type};
use std::hash::Hash;
use std::ops::{Add, AddAssign};

use super::arrays::{get_bool_array_opt, get_f64_array_opt, get_u8_array, ByteArrayAccessor, Int64ArrayAccessor, MaybeDictArrayAccessor, NullableArrayAccessor, StringArrayAccessor};
use super::decoder::{Attrs16ParentIdDecoder, Attrs32ParentIdDecoder, AttrsParentIdDecoder};
use super::{consts, error};


/// Decode bytes from a serialized attribute into pcommon value.
///
/// This should be used for values in the `ser` column of attributes and Log bodies.
pub fn decode_pcommon_val(input: &[u8]) -> error::Result<Option<Value>> {
    let decoded_val = ciborium::from_reader::<ciborium::Value, &[u8]>(input)
        .context(error::InvalidSerializedAttributeBytesSnafu)?;

    MaybeValue::try_from(decoded_val).map(Into::into)
}

/// `MaybeValue` is a thin wrapper around `Option<Value>`.
///
/// We use this so we to avoid violating the coherence rule when implementing TryFrom.
struct MaybeValue(Option<Value>);

impl From<MaybeValue> for Option<Value> {
    fn from(value: MaybeValue) -> Self {
        value.0
    }
}

impl TryFrom<ciborium::Value> for MaybeValue {
    type Error = error::Error;

    fn try_from(value: ciborium::Value) -> error::Result<Self> {
        let val = match value {
            ciborium::Value::Null => None,
            ciborium::Value::Text(string_val) => Some(Value::StringValue(string_val)),
            ciborium::Value::Float(double_val) => Some(Value::DoubleValue(double_val)),
            ciborium::Value::Bytes(bytes_val) => Some(Value::BytesValue(bytes_val)),
            ciborium::Value::Bool(bool_val) => Some(Value::BoolValue(bool_val)),
            ciborium::Value::Integer(int_val) => Some(Value::IntValue(
                int_val
                    .try_into()
                    .context(error::InvalidSerializedIntAttributeValueSnafu)?,
            )),
            ciborium::Value::Array(array_vals) => {
                let vals: error::Result<Vec<_>> = array_vals
                    .into_iter()
                    .map(|element| match MaybeValue::try_from(element) {
                        Ok(val) => Ok(AnyValue { value: val.into() }),
                        Err(e) => Err(e),
                    })
                    .collect();
                Some(Value::ArrayValue(ArrayValue { values: vals? }))
            },
            ciborium::Value::Map(kv_vals) => {
                let kvs: error::Result<Vec<_>> = kv_vals
                    .into_iter()
                    .map(|(k, v)| {
                        if let ciborium::Value::Text(key) = k {
                            match MaybeValue::try_from(v) {
                                Ok(val) => Ok(KeyValue{
                                    key,
                                    value: Some(AnyValue { value: val.into() }),
                                }),
                                Err(e) => Err(e),
                            }
                        } else {
                            error::InvalidSerializedMapKeyTypeSnafu { actual: k }.fail()
                        }
                    })
                    .collect();
                Some(Value::KvlistValue(KeyValueList{
                    values: kvs?,
                }))
            },
            other => {
                return error::UnsupportedSerializedAttributeValueSnafu { actual: other }.fail();
            }
        };

        Ok(Self(val))
    }
}

pub trait ParentId: Copy + Hash + Eq + Default + Add<Output = Self> + AddAssign {
    type ArrayType;

    fn new_decoder() -> AttrsParentIdDecoder<Self>;
}

impl ParentId for u16 {
    type ArrayType = UInt16Type;

    fn new_decoder() -> AttrsParentIdDecoder<Self> {
        Attrs16ParentIdDecoder::default()
    }
}

impl ParentId for u32 {
    type ArrayType = UInt32Type;

    fn new_decoder() -> AttrsParentIdDecoder<Self> {
        Attrs32ParentIdDecoder::default()
    }
}


#[derive(Copy, Clone, Eq, PartialEq, Debug, TryFromPrimitive)]
#[repr(u8)]
pub enum AttributeValueType {
    Empty = 0,
    Str = 1,
    Int = 2,
    Double = 3,
    Bool = 4,
    Map = 5,
    Slice = 6,
    Bytes = 7,
}

pub type Attribute32Store = AttributeStore<u32>;
pub type Attribute16Store = AttributeStore<u16>;

#[derive(Default)]
pub struct AttributeStore<T> {
    last_id: T,
    attribute_by_ids: HashMap<T, Vec<KeyValue>>,
}

impl<T> AttributeStore<T>
where
    T: ParentId,
{
    pub fn attribute_by_delta_id(&mut self, delta: T) -> Option<&[KeyValue]> {
        self.last_id += delta;
        self.attribute_by_ids
            .get(&self.last_id)
            .map(|r| r.as_slice())
    }

    pub fn attribute_by_id(&self, id: T) -> Option<&[KeyValue]> {
        self.attribute_by_ids.get(&id).map(|r| r.as_slice())
    }
}

impl<T> TryFrom<&RecordBatch> for AttributeStore<T>
where
    T: ParentId,
    <T as ParentId>::ArrayType: ArrowPrimitiveType,
    <<T as ParentId>::ArrayType as ArrowPrimitiveType>::Native: Into<T>,
{
    type Error = error::Error;

    fn try_from(rb: &RecordBatch) -> Result<Self, Self::Error> {
        let mut store = Self::default();

        let key_arr = rb
            .column_by_name(consts::ATTRIBUTE_KEY)
            .map(StringArrayAccessor::try_new)
            .transpose()?;
        let value_type_arr = get_u8_array(rb, consts::ATTRIBUTE_TYPE)?;

        let value_str_arr = StringArrayAccessor::try_new_for_column(rb, consts::ATTRIBUTE_STR)?;
        let value_int_arr = rb
            .column_by_name(consts::ATTRIBUTE_INT)
            .map(Int64ArrayAccessor::try_new)
            .transpose()?;
        let value_double_arr = get_f64_array_opt(rb, consts::ATTRIBUTE_DOUBLE)?;
        let value_bool_arr = get_bool_array_opt(rb, consts::ATTRIBUTE_BOOL)?;
        let value_bytes_arr = rb
            .column_by_name(consts::ATTRIBUTE_BYTES)
            .map(ByteArrayAccessor::try_new)
            .transpose()?;
        let value_ser_arr = rb
            .column_by_name(consts::ATTRIBUTE_SER)
            .map(ByteArrayAccessor::try_new)
            .transpose()?;

        for idx in 0..rb.num_rows() {
            let key = key_arr.value_at_or_default(idx);
            let value_type = AttributeValueType::try_from(value_type_arr.value_at_or_default(idx))
                .context(error::UnrecognizedAttributeValueTypeSnafu)?;
            let value = match value_type {
                AttributeValueType::Str => {
                    Value::StringValue(value_str_arr.value_at(idx).unwrap_or_default())
                }
                AttributeValueType::Int => Value::IntValue(value_int_arr.value_at_or_default(idx)),
                AttributeValueType::Double => {
                    Value::DoubleValue(value_double_arr.value_at_or_default(idx))
                }
                AttributeValueType::Bool => {
                    Value::BoolValue(value_bool_arr.value_at_or_default(idx))
                }
                AttributeValueType::Bytes => {
                    Value::BytesValue(value_bytes_arr.value_at_or_default(idx))
                }
                AttributeValueType::Slice | AttributeValueType::Map => {
                    let bytes = value_ser_arr.value_at(idx);
                    if bytes.is_none() {
                        continue;
                    }

                    let decoded_result = decode_pcommon_val(&bytes.expect("expected Some"))?;
                    match decoded_result {
                        Some(value) => value,
                        None => continue,
                    }
                }
                AttributeValueType::Empty => {
                    // should warn here.
                    continue;
                }
            };

            // Parse potentially delta encoded parent id field.
            let parent_id_arr =
                rb.column_by_name(consts::PARENT_ID)
                    .context(error::ColumnNotFoundSnafu {
                        name: consts::PARENT_ID,
                    })?;
            let parent_id_arr =
                MaybeDictArrayAccessor::<PrimitiveArray<<T as ParentId>::ArrayType>>::try_new(
                    parent_id_arr,
                )?;
            let mut parent_id_decoder = T::new_decoder();

            let parent_id = parent_id_decoder.decode(
                parent_id_arr.value_at_or_default(idx).into(),
                &key,
                &value,
            );
            let attributes = store.attribute_by_ids.entry(parent_id).or_default();
            //todo: support assigning ArrayValue and KvListValue by deep copy as in https://github.com/open-telemetry/opentelemetry-collector/blob/fbf6d103eea79e72ff6b2cc3a2a18fc98a836281/pdata/pcommon/value.go#L323
            *attributes.find_or_append(&key) = Some(AnyValue { value: Some(value) });
        }

        Ok(store)
    }
}

trait FindOrAppendValue<V> {
    /// Finds a value with given key and returns the mutable reference to that value.
    /// Appends a new value if not found and return mutable reference to that newly created value.
    fn find_or_append(&mut self, key: &str) -> &mut V;
}

impl FindOrAppendValue<Option<AnyValue>> for Vec<KeyValue> {
    fn find_or_append(&mut self, key: &str) -> &mut Option<AnyValue> {
        // It's a workaround for https://github.com/rust-lang/rust/issues/51545
        if let Some((idx, _)) = self.iter().enumerate().find(|(_, kv)| kv.key == key) {
            return &mut self[idx].value;
        }

        self.push(KeyValue {
            key: key.to_string(),
            value: None,
        });
        &mut self.last_mut().expect("vec is not empty").value
    }
}
