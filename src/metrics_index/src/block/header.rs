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

//! Tail header of a MIDX file; column offsets are prefix sums from the end of the sample blocks.

use std::{collections::HashSet, ops::Range, sync::Arc};

use anyhow::{Context, Result, ensure};
use arrow::datatypes::{DataType, Schema, SchemaRef};
use config::meta::promql::midx::MidxTrailer;
use serde::{Deserialize, Serialize};

use super::*;

/// Validated tail header of one MIDX file.
#[derive(Debug, Clone)]
pub struct Header {
    pub parent: ParentMetadata,
    pub row_group_size: Option<u32>,
    pub source_schema: SchemaRef,
    pub(super) blocks: usize,
    pub(super) blocks_end: u64,
    pub(super) labels: Vec<LabelColumn>,
    pub(super) directory: Vec<Column>,
}

impl Header {
    /// Reads the trailer from the last bytes of `suffix`, the tail of a file of `file_size` bytes.
    pub fn trailer(suffix: &[u8], file_size: u64) -> Result<MidxTrailer> {
        let start = suffix
            .len()
            .checked_sub(MIDX_TRAILER_LEN)
            .context("truncated MIDX trailer")?;
        MidxTrailer::read(&suffix[start..], file_size)
    }

    /// Parses the header from the last `suffix.len()` bytes of a file of `file_size` bytes.
    pub fn parse(suffix: &[u8], file_size: u64, expected: &ParentMetadata) -> Result<Self> {
        ensure!(
            suffix.len() as u64 <= file_size,
            "MIDX suffix exceeds file size"
        );
        let trailer = Self::trailer(suffix, file_size)?;
        let tail = trailer.header_len as usize + MIDX_TRAILER_LEN;
        let json = suffix
            .len()
            .checked_sub(tail)
            .map(|start| &suffix[start..suffix.len() - MIDX_TRAILER_LEN])
            .context("MIDX suffix does not cover the header")?;
        let data: HeaderData = serde_json::from_slice(json)?;
        Self::validate(data, &trailer, file_size, expected)
    }

    /// Byte range of the contiguous block directory columns.
    pub fn directory_range(&self) -> Range<u64> {
        self.directory[0].range.start..self.directory[DIRECTORY_FIELDS - 1].range.end
    }

    /// End of the sample blocks, where the label frames start.
    pub fn blocks_end(&self) -> u64 {
        self.blocks_end
    }

    /// Directory range followed by one range per requested label stored in this file.
    pub fn column_ranges(&self, labels: &[String]) -> Result<Vec<Range<u64>>> {
        let mut ranges = vec![self.directory_range()];
        ranges.extend(
            self.projection(labels)?
                .0
                .into_iter()
                .map(|index| self.labels[index].column.range.clone()),
        );
        Ok(ranges)
    }

    /// Stored label indices and names absent from the file, both deduplicated in request order.
    pub(super) fn projection(&self, labels: &[String]) -> Result<(Vec<usize>, Vec<String>)> {
        let mut projection = Vec::new();
        let mut missing: Vec<String> = Vec::new();
        for name in labels {
            if let Some(index) = self.labels.iter().position(|label| &label.name == name) {
                if !projection.contains(&index) {
                    projection.push(index);
                }
            } else if !missing.contains(name) {
                ensure!(
                    self.source_schema.field_with_name(name).is_err(),
                    "requested source field lacks identity label metadata"
                );
                missing.push(name.clone());
            }
        }
        Ok((projection, missing))
    }

    fn validate(
        data: HeaderData,
        trailer: &MidxTrailer,
        file_size: u64,
        expected: &ParentMetadata,
    ) -> Result<Self> {
        ensure!(
            &data.parent == expected && data.parent.rows > 0 && data.parent.compressed_size > 0,
            "parent metadata mismatch"
        );
        ensure!(
            data.row_group_size != Some(0),
            "invalid parent row group size"
        );
        ensure!(
            data.blocks > 0 && data.blocks <= data.parent.rows,
            "block count limit"
        );
        let blocks = usize::try_from(data.blocks)?;
        let identity = identity_label_columns(&data.source_schema)?;
        let mut names = HashSet::new();
        ensure!(
            data.labels.len() == identity.len()
                && data
                    .labels
                    .iter()
                    .all(|label| identity.contains(&label.name) && names.insert(&label.name)),
            "incomplete source identity labels"
        );
        ensure!(
            data.directory.len() == DIRECTORY_FIELDS,
            "invalid directory column count"
        );
        let min_label_raw = blocks
            .checked_mul(4)
            .and_then(|n| n.checked_add(4))
            .context("label size overflow")?;
        let blocks_end = trailer.blocks_end(file_size);
        let mut next = blocks_end;
        let mut labels = Vec::with_capacity(data.labels.len());
        for label in data.labels {
            let column = Column::next(&mut next, label.section)?;
            ensure!(
                column.raw >= min_label_raw,
                "MIDX label shorter than its rows"
            );
            labels.push(LabelColumn {
                name: label.name,
                column,
            });
        }
        ensure!(
            next == trailer.directory_start(file_size),
            "MIDX label region length mismatch"
        );
        let mut directory = Vec::with_capacity(DIRECTORY_FIELDS);
        for (section, kind) in data.directory.into_iter().zip(DIRECTORY_TYPES) {
            let width = match kind {
                DataType::Boolean => 1,
                DataType::UInt32 => 4,
                _ => 8,
            };
            let raw = blocks
                .checked_mul(width)
                .context("directory size overflow")?;
            let column = Column::next(&mut next, section)?;
            ensure!(column.raw == raw, "directory column row count mismatch");
            directory.push(column);
        }
        ensure!(
            next == trailer.header_start(file_size),
            "MIDX directory region length mismatch"
        );
        Ok(Self {
            parent: data.parent,
            row_group_size: data.row_group_size,
            source_schema: Arc::new(data.source_schema),
            blocks,
            blocks_end,
            labels,
            directory,
        })
    }
}

/// One compressed column frame located by the header.
#[derive(Debug, Clone)]
pub(super) struct Column {
    pub(super) raw: usize,
    pub(super) range: Range<u64>,
}

impl Column {
    fn next(offset: &mut u64, section: Section) -> Result<Self> {
        ensure!(section.compressed > 0, "empty MIDX column");
        let raw = usize::try_from(section.raw)?;
        let end = offset
            .checked_add(section.compressed)
            .context("MIDX column offset overflow")?;
        let range = *offset..end;
        *offset = end;
        Ok(Self { raw, range })
    }
}

#[derive(Debug, Clone)]
pub(super) struct LabelColumn {
    pub(super) name: String,
    pub(super) column: Column,
}

/// Serialized header; labels precede the directory in file order.
#[derive(Serialize, Deserialize)]
pub(super) struct HeaderData {
    pub(super) parent: ParentMetadata,
    pub(super) row_group_size: Option<u32>,
    pub(super) source_schema: Schema,
    pub(super) blocks: u64,
    pub(super) labels: Vec<LabelSection>,
    pub(super) directory: Vec<Section>,
}

impl HeaderData {
    pub(super) fn encode(&self) -> Result<Vec<u8>> {
        let mut value = serde_json::to_value(self)?;
        value.sort_all_objects();
        Ok(serde_json::to_vec(&value)?)
    }
}

#[derive(Serialize, Deserialize)]
pub(super) struct LabelSection {
    pub(super) name: String,
    #[serde(flatten)]
    pub(super) section: Section,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
pub(super) struct Section {
    pub(super) raw: u64,
    pub(super) compressed: u64,
}
