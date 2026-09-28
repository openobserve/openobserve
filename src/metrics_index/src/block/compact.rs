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

use std::{collections::HashMap, sync::Arc};

use anyhow::{Context, Result, ensure};
use arrow::{
    array::{
        Array, ArrayRef, BooleanArray, DictionaryArray, Int64Array, LargeStringArray, StringArray,
        StringViewArray, UInt8Array, UInt16Array, UInt32Array, UInt64Array,
    },
    datatypes::{DataType, UInt8Type, UInt16Type, UInt32Type},
};

use super::{header::Section, label_value};

struct Input<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Input<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }
    fn take(&mut self, len: usize) -> Result<&'a [u8]> {
        let end = self
            .pos
            .checked_add(len)
            .context("compact offset overflow")?;
        let result = self
            .bytes
            .get(self.pos..end)
            .context("truncated compact data")?;
        self.pos = end;
        Ok(result)
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into()?))
    }
    fn remaining(&self) -> usize {
        self.bytes.len() - self.pos
    }
}

/// Encodes one column into a single zstd frame.
pub(super) fn encode_frame(col: &dyn Array) -> Result<(Section, Vec<u8>)> {
    let raw = encode_column(col)?;
    let frame = zstd::bulk::compress(&raw, 1)?;
    Ok((
        Section {
            raw: u64::try_from(raw.len())?,
            compressed: u64::try_from(frame.len())?,
        },
        frame,
    ))
}

/// Decompressor shared by the column frames of one index.
pub(super) fn frame_decoder() -> Result<zstd::bulk::Decompressor<'static>> {
    let mut decoder = zstd::bulk::Decompressor::new()?;
    decoder.set_parameter(zstd::zstd_safe::DParameter::WindowLogMax(27))?;
    Ok(decoder)
}

/// Decodes one column frame whose declared decompressed size is `raw_len`.
pub(super) fn decode_frame(
    decoder: &mut zstd::bulk::Decompressor<'static>,
    frame: &[u8],
    raw_len: usize,
    kind: &DataType,
    rows: usize,
) -> Result<ArrayRef> {
    ensure!(
        zstd::zstd_safe::find_frame_compressed_size(frame)
            .map_err(|e| anyhow::anyhow!("invalid zstd frame: {e:?}"))?
            == frame.len(),
        "extra MIDX frame bytes"
    );
    ensure!(
        zstd::zstd_safe::get_frame_content_size(frame)
            .map_err(|e| anyhow::anyhow!("invalid frame content size: {e:?}"))?
            == Some(u64::try_from(raw_len)?),
        "MIDX frame content size mismatch"
    );
    let mut raw = Vec::new();
    raw.try_reserve_exact(raw_len)
        .context("MIDX frame allocation failed")?;
    ensure!(
        decoder.decompress_to_buffer(frame, &mut raw)? == raw_len,
        "MIDX frame decompressed size mismatch"
    );
    decode_column(&raw, kind, rows)
}

fn encode_column(col: &dyn Array) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    match col.data_type() {
        DataType::UInt64 => {
            ensure!(col.null_count() == 0, "null compact integer");
            for v in col
                .as_any()
                .downcast_ref::<UInt64Array>()
                .context("uint64")?
                .values()
            {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        DataType::Int64 => {
            ensure!(col.null_count() == 0, "null compact integer");
            for v in col
                .as_any()
                .downcast_ref::<Int64Array>()
                .context("int64")?
                .values()
            {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        DataType::UInt32 => {
            ensure!(col.null_count() == 0, "null compact integer");
            for v in col
                .as_any()
                .downcast_ref::<UInt32Array>()
                .context("uint32")?
                .values()
            {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        DataType::Boolean => {
            ensure!(col.null_count() == 0, "null compact bool");
            let col = col
                .as_any()
                .downcast_ref::<BooleanArray>()
                .context("bool")?;
            for i in 0..col.len() {
                out.push(u8::from(col.value(i)));
            }
        }
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => {
            return encode_string_column(col);
        }
        _ => anyhow::bail!("unsupported compact field"),
    }
    Ok(out)
}

fn encode_string_column(col: &dyn Array) -> Result<Vec<u8>> {
    let mut dictionary = Vec::new();
    let mut ids = HashMap::new();
    let mut indices = Vec::with_capacity(col.len());
    for i in 0..col.len() {
        let Some(value) = label_value(col, i)? else {
            indices.push(u32::MAX);
            continue;
        };
        let id = if let Some(id) = ids.get(value) {
            *id
        } else {
            let id = u32::try_from(dictionary.len())?;
            dictionary.push(value);
            ids.insert(value, id);
            id
        };
        indices.push(id);
    }
    let mut out = Vec::new();
    out.extend_from_slice(&u32::try_from(dictionary.len())?.to_le_bytes());
    for value in dictionary {
        out.extend_from_slice(&u32::try_from(value.len())?.to_le_bytes());
        out.extend_from_slice(value.as_bytes());
    }
    for id in indices {
        out.extend_from_slice(&id.to_le_bytes());
    }
    Ok(out)
}

fn decode_column(raw: &[u8], kind: &DataType, rows: usize) -> Result<ArrayRef> {
    match kind {
        DataType::UInt64 | DataType::Int64 => {
            ensure!(
                raw.len() == rows.checked_mul(8).context("column size overflow")?,
                "compact integer length"
            );
            if kind == &DataType::UInt64 {
                Ok(Arc::new(UInt64Array::from_iter_values(
                    raw.chunks_exact(8)
                        .map(|v| u64::from_le_bytes(v.try_into().unwrap())),
                )))
            } else {
                Ok(Arc::new(Int64Array::from_iter_values(
                    raw.chunks_exact(8)
                        .map(|v| i64::from_le_bytes(v.try_into().unwrap())),
                )))
            }
        }
        DataType::UInt32 => {
            ensure!(
                raw.len() == rows.checked_mul(4).context("column size overflow")?,
                "compact integer length"
            );
            Ok(Arc::new(UInt32Array::from_iter_values(
                raw.chunks_exact(4)
                    .map(|v| u32::from_le_bytes(v.try_into().unwrap())),
            )))
        }
        DataType::Boolean => {
            ensure!(
                raw.len() == rows && raw.iter().all(|v| *v <= 1),
                "invalid compact boolean"
            );
            Ok(Arc::new(BooleanArray::from(
                raw.iter().map(|v| *v != 0).collect::<Vec<_>>(),
            )))
        }
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => {
            decode_string_column(raw, kind, rows)
        }
        _ => anyhow::bail!("unsupported compact field"),
    }
}

fn decode_string_column(raw: &[u8], kind: &DataType, rows: usize) -> Result<ArrayRef> {
    let mut input = Input::new(raw);
    let count = input.u32()? as usize;
    ensure!(
        count <= rows && count <= input.remaining() / 4,
        "compact dictionary count"
    );
    let mut dictionary = Vec::new();
    dictionary
        .try_reserve_exact(count)
        .context("compact dictionary allocation failed")?;
    let mut dictionary_bytes = 0usize;
    for _ in 0..count {
        let len = input.u32()? as usize;
        dictionary_bytes = dictionary_bytes
            .checked_add(len)
            .context("compact dictionary bytes overflow")?;
        dictionary.push(std::str::from_utf8(input.take(len)?)?);
    }
    ensure!(
        input.remaining() == rows.checked_mul(4).context("index size overflow")?,
        "compact label indices length"
    );
    let mut ids = Vec::new();
    ids.try_reserve_exact(rows)
        .context("compact indices allocation failed")?;
    let mut direct_payload = 0usize;
    let mut view_payload = 0usize;
    let mut has_null = false;
    for _ in 0..rows {
        let id = input.u32()?;
        if id == u32::MAX {
            has_null = true;
            ids.push(None);
        } else {
            let value = dictionary
                .get(id as usize)
                .context("invalid compact dictionary index")?;
            direct_payload = direct_payload
                .checked_add(value.len())
                .context("compact direct size overflow")?;
            if value.len() > 12 {
                view_payload = view_payload
                    .checked_add(value.len())
                    .context("compact view size overflow")?;
            }
            ids.push(Some(id));
        }
    }
    let width = if count <= 256 {
        1
    } else if count <= 65536 {
        2
    } else {
        4
    };
    let null_bytes = if has_null { rows.div_ceil(8) } else { 0 };
    let direct_bytes = match kind {
        DataType::Utf8 => rows
            .checked_add(1)
            .and_then(|n| n.checked_mul(4))
            .and_then(|n| n.checked_add(direct_payload)),
        DataType::LargeUtf8 => rows
            .checked_add(1)
            .and_then(|n| n.checked_mul(8))
            .and_then(|n| n.checked_add(direct_payload)),
        DataType::Utf8View => rows
            .checked_mul(16)
            .and_then(|n| n.checked_add(view_payload)),
        _ => anyhow::bail!("unsupported compact label field"),
    }
    .and_then(|n| n.checked_add(null_bytes))
    .context("compact direct size overflow")?;
    let compact_bytes = count
        .checked_add(1)
        .and_then(|n| n.checked_mul(4))
        .and_then(|n| n.checked_add(dictionary_bytes))
        .and_then(|n| n.checked_add(rows.checked_mul(width)?))
        .and_then(|n| n.checked_add(null_bytes))
        .context("compact dictionary size overflow")?;
    if compact_bytes >= direct_bytes {
        let values = ids.iter().map(|id| id.map(|v| dictionary[v as usize]));
        return Ok(match kind {
            DataType::Utf8 => Arc::new(StringArray::from_iter(values)) as ArrayRef,
            DataType::LargeUtf8 => Arc::new(LargeStringArray::from_iter(values)),
            DataType::Utf8View => Arc::new(StringViewArray::from_iter(values)),
            _ => unreachable!(),
        });
    }
    let values: ArrayRef = Arc::new(StringArray::from_iter_values(dictionary));
    let compact: ArrayRef = match width {
        1 => Arc::new(DictionaryArray::<UInt8Type>::try_new(
            UInt8Array::from_iter(
                ids.iter()
                    .map(|id| id.map(|v| u8::try_from(v).expect("validated dictionary width"))),
            ),
            values,
        )?),
        2 => Arc::new(DictionaryArray::<UInt16Type>::try_new(
            UInt16Array::from_iter(
                ids.iter()
                    .map(|id| id.map(|v| u16::try_from(v).expect("validated dictionary width"))),
            ),
            values,
        )?),
        _ => Arc::new(DictionaryArray::<UInt32Type>::try_new(
            UInt32Array::from(ids),
            values,
        )?),
    };
    Ok(compact)
}

#[cfg(test)]
mod adaptive_tests {
    use super::*;

    #[test]
    fn dictionary_width_boundaries_preserve_null_and_all_codes() {
        for (cardinality, width) in [
            (255, DataType::UInt8),
            (256, DataType::UInt8),
            (257, DataType::UInt16),
            (65535, DataType::UInt16),
            (65536, DataType::UInt16),
            (65537, DataType::UInt32),
        ] {
            let values = (0..cardinality)
                .map(|i| format!("label-{i:06}"))
                .collect::<Vec<_>>();
            let rows = values
                .iter()
                .map(|value| Some(value.as_str()))
                .chain(values.iter().map(|value| Some(value.as_str())))
                .chain(std::iter::once(None))
                .collect::<Vec<_>>();
            let source: ArrayRef = Arc::new(StringArray::from(rows));
            let raw = encode_column(source.as_ref()).unwrap();
            let decoded = decode_column(&raw, &DataType::Utf8, source.len()).unwrap();
            assert_eq!(
                decoded.data_type(),
                &DataType::Dictionary(Box::new(width), Box::new(DataType::Utf8))
            );
            assert_eq!(
                super::label_value(decoded.as_ref(), cardinality - 1).unwrap(),
                Some(values[cardinality - 1].as_str())
            );
            assert_eq!(
                super::label_value(decoded.as_ref(), cardinality * 2).unwrap(),
                None
            );
            assert!(decoded.get_array_memory_size() < source.get_array_memory_size());
        }
    }

    #[test]
    fn compact_labels_keep_high_cardinality_direct_and_null_empty_distinct() {
        for kind in [DataType::Utf8, DataType::LargeUtf8, DataType::Utf8View] {
            let values = (0..1024)
                .map(|i| {
                    if i % 3 == 0 {
                        None
                    } else if i % 3 == 1 {
                        Some("")
                    } else {
                        Some("repeated")
                    }
                })
                .collect::<Vec<_>>();
            let source: ArrayRef = match kind {
                DataType::Utf8 => Arc::new(StringArray::from(values)),
                DataType::LargeUtf8 => Arc::new(LargeStringArray::from(values)),
                _ => Arc::new(StringViewArray::from(values)),
            };
            let raw = encode_column(source.as_ref()).unwrap();
            let decoded = decode_column(&raw, &kind, source.len()).unwrap();
            assert!(
                matches!(decoded.data_type(),DataType::Dictionary(key,_) if **key==DataType::UInt8)
            );
            for row in 0..source.len() {
                assert_eq!(
                    super::label_value(source.as_ref(), row).unwrap(),
                    super::label_value(decoded.as_ref(), row).unwrap()
                );
            }
        }
        let source: ArrayRef = Arc::new(StringArray::from_iter_values(
            (0..1024).map(|i| format!("unique-{i:06}")),
        ));
        let raw = encode_column(source.as_ref()).unwrap();
        let decoded = decode_column(&raw, &DataType::Utf8, source.len()).unwrap();
        assert_eq!(decoded.data_type(), &DataType::Utf8);
    }
}
