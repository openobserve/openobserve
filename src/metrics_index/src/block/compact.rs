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
        Array, ArrayRef, DictionaryArray, LargeStringArray, StringArray, StringViewArray,
        UInt8Array, UInt16Array, UInt32Array,
    },
    datatypes::{DataType, UInt8Type, UInt16Type, UInt32Type},
};

use super::{header::Section, label_value};

/// Compresses one column's raw bytes into a single zstd frame.
pub(super) fn encode_frame(raw: &[u8]) -> Result<(Section, Vec<u8>)> {
    let frame = zstd::bulk::compress(raw, 1)?;
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

/// Decompresses one column frame whose declared decompressed size is `raw_len`.
pub(super) fn decode_frame(
    decoder: &mut zstd::bulk::Decompressor<'static>,
    frame: &[u8],
    raw_len: usize,
) -> Result<Vec<u8>> {
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
    Ok(raw)
}

/// Returns the next `len` bytes at `pos` and advances past them.
pub(super) fn take<'a>(bytes: &'a [u8], pos: &mut usize, len: usize) -> Result<&'a [u8]> {
    let data = bytes
        .get(*pos..pos.saturating_add(len))
        .context("truncated MIDX data")?;
    *pos += len;
    Ok(data)
}

pub(super) fn get_u32(bytes: &[u8], pos: &mut usize) -> Result<u32> {
    Ok(u32::from_le_bytes(take(bytes, pos, 4)?.try_into()?))
}

pub(super) fn get_u64(bytes: &[u8], pos: &mut usize) -> Result<u64> {
    Ok(u64::from_le_bytes(take(bytes, pos, 8)?.try_into()?))
}

pub(super) fn put_varint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push(value as u8 | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

/// Reads one LEB128 value of at most 10 bytes.
#[inline]
pub(super) fn get_varint(bytes: &[u8], pos: &mut usize) -> Result<u64> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *bytes.get(*pos).context("truncated varint")?;
        *pos += 1;
        ensure!(shift < 63 || byte <= 1, "varint overflow");
        value |= u64::from(byte & 0x7f) << shift;
        if byte < 0x80 {
            return Ok(value);
        }
    }
    anyhow::bail!("varint overflow")
}

#[inline]
pub(super) fn zigzag(value: i64) -> u64 {
    ((value << 1) ^ (value >> 63)) as u64
}

#[inline]
pub(super) fn unzigzag(value: u64) -> i64 {
    ((value >> 1) as i64) ^ -((value & 1) as i64)
}

/// Dictionary, then one id per row whose width depends on the dictionary size.
pub(super) fn encode_label_column(col: &dyn Array) -> Result<Vec<u8>> {
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
    for value in &dictionary {
        out.extend_from_slice(&u32::try_from(value.len())?.to_le_bytes());
        out.extend_from_slice(value.as_bytes());
    }
    let width = id_width(dictionary.len());
    for id in indices {
        out.extend_from_slice(&id.to_le_bytes()[..width]);
    }
    Ok(out)
}

pub(super) fn decode_label_column(raw: &[u8], kind: &DataType, rows: usize) -> Result<ArrayRef> {
    let mut pos = 0;
    let count = get_u32(raw, &mut pos)? as usize;
    ensure!(
        count <= rows && count <= (raw.len() - pos) / 4,
        "compact dictionary count"
    );
    let mut dictionary = Vec::new();
    dictionary
        .try_reserve_exact(count)
        .context("compact dictionary allocation failed")?;
    let mut dictionary_bytes = 0usize;
    for _ in 0..count {
        let len = get_u32(raw, &mut pos)? as usize;
        dictionary_bytes = dictionary_bytes
            .checked_add(len)
            .context("compact dictionary bytes overflow")?;
        dictionary.push(std::str::from_utf8(take(raw, &mut pos, len)?)?);
    }
    let id_width = id_width(count);
    let null = u32::MAX >> (32 - 8 * id_width);
    ensure!(
        raw.len() - pos == rows.checked_mul(id_width).context("index size overflow")?,
        "compact label indices length"
    );
    let mut ids = Vec::new();
    ids.try_reserve_exact(rows)
        .context("compact indices allocation failed")?;
    let mut direct_payload = 0usize;
    let mut view_payload = 0usize;
    let mut has_null = false;
    for _ in 0..rows {
        let mut id = [0u8; 4];
        id[..id_width].copy_from_slice(take(raw, &mut pos, id_width)?);
        let id = u32::from_le_bytes(id);
        if id == null {
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

/// Stored label id width: the all-ones id of each width is NULL, so it never names an entry.
fn id_width(count: usize) -> usize {
    if count < 0xff {
        1
    } else if count < 0xffff {
        2
    } else {
        4
    }
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
            let raw = encode_label_column(source.as_ref()).unwrap();
            let decoded = decode_label_column(&raw, &DataType::Utf8, source.len()).unwrap();
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
            let raw = encode_label_column(source.as_ref()).unwrap();
            let decoded = decode_label_column(&raw, &kind, source.len()).unwrap();
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
        let raw = encode_label_column(source.as_ref()).unwrap();
        let decoded = decode_label_column(&raw, &DataType::Utf8, source.len()).unwrap();
        assert_eq!(decoded.data_type(), &DataType::Utf8);
    }

    #[test]
    fn label_id_width_and_null_follow_dictionary_size() {
        for (count, width) in [(254, 1), (255, 2), (65534, 2), (65535, 4)] {
            let values = std::iter::once(String::new())
                .chain((1..count).map(|i| format!("v{i}")))
                .collect::<Vec<_>>();
            let rows = values
                .iter()
                .map(|value| Some(value.as_str()))
                .chain([None, Some("")])
                .collect::<Vec<_>>();
            let source: ArrayRef = Arc::new(StringArray::from(rows));
            let raw = encode_label_column(source.as_ref()).unwrap();
            let dictionary = 4 + values.iter().map(|v| 4 + v.len()).sum::<usize>();
            assert_eq!(raw.len(), dictionary + source.len() * width);
            let null = &raw[dictionary + count * width..][..width];
            assert!(null.iter().all(|byte| *byte == 0xff));
            let decoded = decode_label_column(&raw, &DataType::Utf8, source.len()).unwrap();
            for row in 0..source.len() {
                assert_eq!(
                    super::label_value(source.as_ref(), row).unwrap(),
                    super::label_value(decoded.as_ref(), row).unwrap()
                );
            }
            assert_eq!(super::label_value(decoded.as_ref(), count).unwrap(), None);
            assert_eq!(
                super::label_value(decoded.as_ref(), count + 1).unwrap(),
                Some("")
            );
            let mut truncated = raw.clone();
            truncated.pop();
            assert!(decode_label_column(&truncated, &DataType::Utf8, source.len()).is_err());
        }
    }
}
