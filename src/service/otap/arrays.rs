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

use super::error;
use arrow::array::{
    Array, ArrayRef, ArrowPrimitiveType, BinaryArray, BooleanArray, DictionaryArray,
    FixedSizeBinaryArray, Float32Array, Float64Array, Int8Array, Int16Array, Int32Array,
    Int64Array, PrimitiveArray, RecordBatch, StringArray, StructArray, TimestampNanosecondArray,
    UInt8Array, UInt16Array, UInt32Array, UInt64Array,
};
use arrow::datatypes::{
    ArrowDictionaryKeyType, DataType, TimeUnit, UInt8Type, UInt16Type,
};
use paste::paste;
use snafu::{OptionExt, ensure};

pub trait NullableArrayAccessor {
    type Native;

    fn value_at(&self, idx: usize) -> Option<Self::Native>;

    fn value_at_or_default(&self, idx: usize) -> Self::Native
    where
        Self::Native: Default,
    {
        self.value_at(idx).unwrap_or_default()
    }
}

impl<T> NullableArrayAccessor for &T
where
    T: NullableArrayAccessor,
{
    type Native = T::Native;

    fn value_at(&self, idx: usize) -> Option<Self::Native> {
        (*self).value_at(idx)
    }
}

impl<T> NullableArrayAccessor for Option<T>
where
    T: NullableArrayAccessor,
{
    type Native = T::Native;

    fn value_at(&self, idx: usize) -> Option<Self::Native> {
        self.as_ref().and_then(|r| r.value_at(idx))
    }
}

impl<T> NullableArrayAccessor for PrimitiveArray<T>
where
    T: ArrowPrimitiveType,
{
    type Native = T::Native;

    fn value_at(&self, idx: usize) -> Option<Self::Native> {
        if self.is_valid(idx) {
            Some(self.value(idx))
        } else {
            None
        }
    }
}

impl NullableArrayAccessor for BooleanArray {
    type Native = bool;

    fn value_at(&self, idx: usize) -> Option<Self::Native> {
        if self.is_valid(idx) {
            Some(self.value(idx))
        } else {
            None
        }
    }
}

impl NullableArrayAccessor for BinaryArray {
    type Native = Vec<u8>;

    fn value_at(&self, idx: usize) -> Option<Self::Native> {
        if self.is_valid(idx) {
            Some(self.value(idx).to_vec())
        } else {
            None
        }
    }
}

impl NullableArrayAccessor for FixedSizeBinaryArray {
    type Native = Vec<u8>;

    fn value_at(&self, idx: usize) -> Option<Self::Native> {
        if self.is_valid(idx) {
            Some(self.value(idx).to_vec())
        } else {
            None
        }
    }
}

impl NullableArrayAccessor for StringArray {
    type Native = String;

    fn value_at(&self, idx: usize) -> Option<Self::Native> {
        if self.is_valid(idx) {
            Some(self.value(idx).to_string())
        } else {
            None
        }
    }
}

macro_rules! impl_downcast {
    ($suffix:ident, $data_type:expr, $array_type:ident) => {
        paste!{
            pub fn [<get_ $suffix _array_opt> ]<'a>(rb: &'a RecordBatch, name: &str) -> error::Result<Option<&'a $array_type>> {
                use arrow::datatypes::DataType::*;
                rb.column_by_name(name)
                    .map(|arr|{
                        arr.as_any()
                            .downcast_ref::<$array_type>()
                            .with_context(|| error::ColumnDataTypeMismatchSnafu {
                                name,
                                expect: $data_type,
                                actual: arr.data_type().clone(),
                            })
                }).transpose()
            }

              pub fn [<get_ $suffix _array> ]<'a>(rb: &'a RecordBatch, name: &str) -> error::Result<&'a $array_type> {
                use arrow::datatypes::DataType::*;
                let arr = get_required_array(rb, name)?;

                 arr.as_any()
                            .downcast_ref::<$array_type>()
                            .with_context(|| error::ColumnDataTypeMismatchSnafu {
                                name,
                                expect: $data_type,
                                actual: arr.data_type().clone(),
                            })
            }
        }
    };
}

impl_downcast!(u8, UInt8, UInt8Array);
impl_downcast!(u16, UInt16, UInt16Array);
impl_downcast!(u32, UInt32, UInt32Array);
impl_downcast!(u64, UInt64, UInt64Array);
impl_downcast!(i8, Int8, Int8Array);
impl_downcast!(i16, Int16, Int16Array);
impl_downcast!(i32, Int32, Int32Array);
impl_downcast!(i64, Int64, Int64Array);
impl_downcast!(bool, Boolean, BooleanArray);

impl_downcast!(f32, Float32, Float32Array);
impl_downcast!(f64, Float64, Float64Array);

impl_downcast!(string, Utf8, StringArray);
impl_downcast!(binary, Binary, BinaryArray);

impl_downcast!(
    timestamp_nanosecond,
    Timestamp(TimeUnit::Nanosecond, None),
    TimestampNanosecondArray
);

/// Get reference to array that the caller requires to be in the record batch.
/// If the column is not in the record batch, returns `ColumnNotFound` error
pub fn get_required_array<'a>(
    record_batch: &'a RecordBatch,
    column_name: &str,
) -> error::Result<&'a ArrayRef> {
    record_batch
        .column_by_name(column_name)
        .context(error::ColumnNotFoundSnafu { name: column_name })
}

/// Wrapper around various arrays that may return a byte slice. Note that
/// this delegates to the underlying NullableArrayAccessor implementation
/// for the Arrow array which copies the bytes when value_at is called
pub enum ByteArrayAccessor<'a> {
    Binary(MaybeDictArrayAccessor<'a, BinaryArray>),
    FixedSizeBinary(MaybeDictArrayAccessor<'a, FixedSizeBinaryArray>),
}

impl<'a> ByteArrayAccessor<'a> {
    pub fn try_new_for_column(
        record_batch: &'a RecordBatch,
        column_name: &str,
    ) -> error::Result<Self> {
        Self::try_new(get_required_array(record_batch, column_name)?)
    }

    pub fn try_new(arr: &'a ArrayRef) -> error::Result<Self> {
        match arr.data_type() {
            DataType::Binary => {
                MaybeDictArrayAccessor::<BinaryArray>::try_new(arr).map(Self::Binary)
            }
            DataType::FixedSizeBinary(dims) => {
                MaybeDictArrayAccessor::<FixedSizeBinaryArray>::try_new(arr, *dims)
                    .map(Self::FixedSizeBinary)
            }
            DataType::Dictionary(_, val) => match **val {
                DataType::Binary => {
                    MaybeDictArrayAccessor::<BinaryArray>::try_new(arr).map(Self::Binary)
                }
                DataType::FixedSizeBinary(dims) => {
                    MaybeDictArrayAccessor::<FixedSizeBinaryArray>::try_new(arr, dims)
                        .map(Self::FixedSizeBinary)
                }
                _ => error::UnsupportedDictionaryValueTypeSnafu {
                    expect_oneof: vec![DataType::Binary, DataType::FixedSizeBinary(-1)],
                    actual: (**val).clone(),
                }
                .fail(),
            },
            _ => error::InvalidListArraySnafu {
                expect_oneof: vec![
                    DataType::Binary,
                    DataType::FixedSizeBinary(-1),
                    DataType::Dictionary(Box::new(DataType::UInt8), Box::new(DataType::Binary)),
                    DataType::Dictionary(Box::new(DataType::UInt16), Box::new(DataType::Binary)),
                    DataType::Dictionary(
                        Box::new(DataType::UInt8),
                        Box::new(DataType::FixedSizeBinary(-1)),
                    ),
                    DataType::Dictionary(
                        Box::new(DataType::UInt16),
                        Box::new(DataType::FixedSizeBinary(-1)),
                    ),
                ],
                actual: arr.data_type().clone(),
            }
            .fail(),
        }
    }
}

impl NullableArrayAccessor for ByteArrayAccessor<'_> {
    type Native = Vec<u8>;

    fn value_at(&self, idx: usize) -> Option<Self::Native> {
        match self {
            Self::Binary(b) => b.value_at(idx),
            Self::FixedSizeBinary(b) => b.value_at(idx),
        }
    }
}

/// Wrapper around an array that might be a dictionary or it might just be an unencoded
/// array of the base type
pub enum MaybeDictArrayAccessor<'a, V> {
    Native(&'a V),
    Dictionary8(DictionaryArrayAccessor<'a, UInt8Type, V>),
    Dictionary16(DictionaryArrayAccessor<'a, UInt16Type, V>),
}

impl<'a, T> NullableArrayAccessor for MaybeDictArrayAccessor<'a, T>
where
    T: Array + NullableArrayAccessor + 'static,
{
    type Native = T::Native;

    fn value_at(
        &self,
        idx: usize,
    ) -> Option<<MaybeDictArrayAccessor<'a, T> as NullableArrayAccessor>::Native> {
        match self {
            Self::Native(s) => s.value_at(idx),
            Self::Dictionary8(d) => d.value_at(idx),
            Self::Dictionary16(d) => d.value_at(idx),
        }
    }
}

impl<'a, T> MaybeDictArrayAccessor<'a, T>
where
    T: Array + NullableArrayAccessor + 'static,
{
    /// Inspects the given array to determine whether it can be treated as an array
    /// of the specified data type. The array must either:
    /// - Directly have the expected data type, or
    /// - Be a dictionary array whose value type matches the expected data type.
    ///
    /// Returns a wrapped native array if the type matches.
    /// Returns an error if the array type can't be treated as this datatype
    fn try_new_with_datatype(data_type: DataType, arr: &'a ArrayRef) -> error::Result<Self> {
        // if the type isn't a dictionary, we treat it as an unencoded array
        if *arr.data_type() == data_type {
            return Ok(Self::Native(
                arr.as_any()
                    .downcast_ref::<T>()
                    .expect("array can be downcast to it's native datatype"),
            ));
        }

        // determine if the type is a dictionary where the value is the desired datatype
        if let DataType::Dictionary(key, v) = arr.data_type() {
            ensure!(
                **v == data_type,
                error::UnsupportedDictionaryValueTypeSnafu {
                    expect_oneof: vec![data_type],
                    actual: (**v).clone()
                }
            );

            let result = match **key {
                DataType::UInt8 => Self::Dictionary8(DictionaryArrayAccessor::new(
                    arr.as_any()
                        .downcast_ref::<DictionaryArray<UInt8Type>>()
                        .expect("array can be downcast to DictionaryArray<UInt8Type"),
                )?),
                DataType::UInt16 => Self::Dictionary16(DictionaryArrayAccessor::new(
                    arr.as_any()
                        .downcast_ref::<DictionaryArray<UInt16Type>>()
                        .expect("array can be downcast to DictionaryArray<UInt16Type>"),
                )?),
                _ => {
                    return error::UnsupportedDictionaryKeyTypeSnafu {
                        expect_oneof: vec![DataType::UInt8, DataType::UInt16],
                        actual: (**key).clone(),
                    }
                    .fail();
                }
            };

            return Ok(result);
        }

        error::InvalidListArraySnafu {
            expect_oneof: vec![
                data_type.clone(),
                DataType::Dictionary(Box::new(DataType::UInt8), Box::new(data_type.clone())),
                DataType::Dictionary(Box::new(DataType::UInt16), Box::new(data_type.clone())),
            ],
            actual: arr.data_type().clone(),
        }
        .fail()
    }
}

impl<'a, V> MaybeDictArrayAccessor<'a, PrimitiveArray<V>>
where
    V: ArrowPrimitiveType,
{
    pub fn try_new(arr: &'a ArrayRef) -> error::Result<Self> {
        Self::try_new_with_datatype(V::DATA_TYPE, arr)
    }

    pub fn try_new_for_column(
        record_batch: &'a RecordBatch,
        column_name: &str,
    ) -> error::Result<Self> {
        Self::try_new(get_required_array(record_batch, column_name)?)
    }
}

impl<'a> MaybeDictArrayAccessor<'a, BinaryArray> {
    pub fn try_new(arr: &'a ArrayRef) -> error::Result<Self> {
        Self::try_new_with_datatype(BinaryArray::DATA_TYPE, arr)
    }
}

impl<'a> MaybeDictArrayAccessor<'a, FixedSizeBinaryArray> {
    pub fn try_new(arr: &'a ArrayRef, dims: i32) -> error::Result<Self> {
        Self::try_new_with_datatype(DataType::FixedSizeBinary(dims), arr)
    }
}

impl<'a> MaybeDictArrayAccessor<'a, StringArray> {
    pub fn try_new(arr: &'a ArrayRef) -> error::Result<Self> {
        Self::try_new_with_datatype(StringArray::DATA_TYPE, arr)
    }

    pub fn try_new_for_column(
        record_batch: &'a RecordBatch,
        column_name: &str,
    ) -> error::Result<Self> {
        Self::try_new(get_required_array(record_batch, column_name)?)
    }
}

pub type Int32ArrayAccessor<'a> = MaybeDictArrayAccessor<'a, Int32Array>;
pub type Int64ArrayAccessor<'a> = MaybeDictArrayAccessor<'a, Int64Array>;
pub type StringArrayAccessor<'a> = MaybeDictArrayAccessor<'a, StringArray>;

pub struct DictionaryArrayAccessor<'a, K, V>
where
    K: ArrowDictionaryKeyType,
{
    inner: &'a DictionaryArray<K>,
    value: &'a V,
}

impl<'a, K, V> DictionaryArrayAccessor<'a, K, V>
where
    K: ArrowDictionaryKeyType,
    V: Array + NullableArrayAccessor + 'static,
{
    pub fn new(dict: &'a DictionaryArray<K>) -> error::Result<Self> {
        let value = dict
            .values()
            .as_any()
            .downcast_ref::<V>()
            .with_context(|| error::InvalidListArraySnafu {
                expect_oneof: Vec::new(),
                actual: dict.values().data_type().clone(),
            })?;
        Ok(Self { inner: dict, value })
    }

    pub fn value_at(&self, idx: usize) -> Option<V::Native> {
        if self.inner.is_valid(idx) {
            let offset = self
                .inner
                .key(idx)
                .expect("dictionary should be valid at index");
            self.value.value_at(offset)
        } else {
            None
        }
    }
}

/// Helper for accessing columns of a struct array
///
/// Methods return various errors into this crate's Error type if
/// if callers requirments for the struct columns are not met (for
/// example `ColumnDataTypeMismatchSnafu`)
pub struct StructColumnAccessor<'a> {
    inner: &'a StructArray,
}

impl<'a> StructColumnAccessor<'a> {
    pub fn new(arr: &'a StructArray) -> Self {
        Self { inner: arr }
    }

    pub fn primitive_column<T: ArrowPrimitiveType + 'static>(
        &self,
        column_name: &str,
    ) -> error::Result<&'a PrimitiveArray<T>> {
        self.primitive_column_op(column_name)?
            .with_context(|| error::ColumnNotFoundSnafu {
                name: column_name.to_string(),
            })
    }

    pub fn primitive_column_op<T: ArrowPrimitiveType + 'static>(
        &self,
        column_name: &str,
    ) -> error::Result<Option<&'a PrimitiveArray<T>>> {
        self.inner
            .column_by_name(column_name)
            .map(|arr| {
                arr.as_any()
                    .downcast_ref::<PrimitiveArray<T>>()
                    .with_context(|| error::ColumnDataTypeMismatchSnafu {
                        name: column_name.to_string(),
                        expect: T::DATA_TYPE,
                        actual: arr.data_type().clone(),
                    })
            })
            .transpose()
    }

    pub fn bool_column_op(&self, column_name: &str) -> error::Result<Option<&'a BooleanArray>> {
        self.inner
            .column_by_name(column_name)
            .map(|arr| {
                arr.as_any()
                    .downcast_ref()
                    .with_context(|| error::ColumnDataTypeMismatchSnafu {
                        name: column_name.to_string(),
                        expect: DataType::Boolean,
                        actual: arr.data_type().clone(),
                    })
            })
            .transpose()
    }

    pub fn string_column_op(
        &self,
        column_name: &str,
    ) -> error::Result<Option<StringArrayAccessor<'a>>> {
        self.inner
            .column_by_name(column_name)
            .map(StringArrayAccessor::try_new)
            .transpose()
    }

    pub fn byte_array_column_op(
        &self,
        column_name: &str,
    ) -> error::Result<Option<ByteArrayAccessor<'a>>> {
        self.inner
            .column_by_name(column_name)
            .map(ByteArrayAccessor::try_new)
            .transpose()
    }
}
