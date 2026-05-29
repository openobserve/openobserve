// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{ops::Range, sync::Arc};

use arrow::{
    array::StructArray, datatypes::DataType, error::ArrowError, record_batch::RecordBatch,
};
use arrow_schema::Schema;
use bytes::Bytes;
use config::utils::parquet::RecordBatchStream;
use futures::StreamExt;
use vortex::{
    VortexSessionDefault,
    array::{ArrayRef, arrow::IntoArrowArray},
    error::VortexResult,
    expr::{root, select},
    file::OpenOptionsSessionExt,
    io::{
        runtime::{BlockingRuntime, single::SingleThreadRuntime},
        session::RuntimeSessionExt,
    },
    session::VortexSession,
};

/// Open a vortex file, apply an optional projection, and return an async
/// record batch stream over all rows.
pub(super) async fn read_vortex_with_projection(
    data: Bytes,
    projection: Option<&[String]>,
) -> Result<RecordBatchStream, anyhow::Error> {
    let session = VortexSession::default().with_tokio();
    let vxf = session.open_options().open_buffer(data)?;
    let full_schema = vxf.dtype().to_arrow_schema()?;

    let projected_names = vortex_projection_names(&full_schema, projection);

    let mut scan = vxf.scan()?;
    if let Some(names) = projected_names.as_deref() {
        let name_refs: Vec<&str> = names.iter().map(String::as_str).collect();
        scan = scan.with_projection(select(name_refs, root()));
    }
    let stream_schema: Arc<Schema> = Arc::new(scan.dtype()?.to_arrow_schema()?);

    let arrow_data_type = DataType::Struct(stream_schema.fields().clone());
    let vortex_stream = scan.into_array_stream()?;

    let stream = vortex_stream.then(move |result| {
        let arrow_data_type = arrow_data_type.clone();
        async move {
            match result {
                Ok(vortex_array) => {
                    let arrow_array = vortex_array
                        .into_arrow(&arrow_data_type)
                        .map_err(|e| ArrowError::ExternalError(Box::new(e)))?;
                    let struct_array = arrow_array
                        .as_any()
                        .downcast_ref::<StructArray>()
                        .ok_or_else(|| {
                            ArrowError::InvalidArgumentError(
                                "Expected struct array from vortex".to_string(),
                            )
                        })?;
                    Ok(RecordBatch::from(struct_array))
                }
                Err(e) => Err(ArrowError::ExternalError(Box::new(e))),
            }
        }
    });

    let stream: RecordBatchStream = Box::pin(stream);
    Ok(stream)
}

/// Build a lazy sync iterator for one vortex row range.
pub(super) fn build_vortex_sync_iter(
    data: Bytes,
    projection: Option<&[String]>,
    row_range: Range<u64>,
) -> Result<VortexRowRangeIter, anyhow::Error> {
    let runtime = SingleThreadRuntime::default();
    let session = VortexSession::default().with_handle(runtime.handle());
    let vxf = session.open_options().open_buffer(data)?;
    let full_schema = vxf.dtype().to_arrow_schema()?;

    let projected_names = vortex_projection_names(&full_schema, projection);

    let mut scan = vxf.scan()?;
    if let Some(names) = projected_names.as_deref() {
        let name_refs: Vec<&str> = names.iter().map(String::as_str).collect();
        scan = scan.with_projection(select(name_refs, root()));
    }
    let scan = scan.with_row_range(row_range);

    let projected_schema: Arc<Schema> = Arc::new(scan.dtype()?.to_arrow_schema()?);
    let arrow_data_type = DataType::Struct(projected_schema.fields().clone());

    // The borrow of `runtime` ends here; the returned iterator is 'static.
    let iter_inner = scan.into_array_iter(&runtime)?;
    let iter: Box<dyn Iterator<Item = VortexResult<ArrayRef>> + 'static> = Box::new(iter_inner);

    Ok(VortexRowRangeIter {
        iter,
        arrow_data_type,
        _runtime: runtime,
    })
}

/// Lazy sync iterator over one vortex row range.
pub(in crate::service::tantivy) struct VortexRowRangeIter {
    iter: Box<dyn Iterator<Item = VortexResult<ArrayRef>> + 'static>,
    arrow_data_type: DataType,
    _runtime: SingleThreadRuntime, // dropped last — keeps Arc<Sender> alive
}

impl Iterator for VortexRowRangeIter {
    type Item = Result<RecordBatch, ArrowError>;

    fn next(&mut self) -> Option<Self::Item> {
        Some(match self.iter.next()? {
            Ok(vortex_array) => vortex_array
                .into_arrow(&self.arrow_data_type)
                .map_err(|e| ArrowError::ExternalError(Box::new(e)))
                .and_then(|arrow_array| {
                    let struct_array = arrow_array
                        .as_any()
                        .downcast_ref::<StructArray>()
                        .ok_or_else(|| {
                            ArrowError::InvalidArgumentError(
                                "Expected struct array from vortex".to_string(),
                            )
                        })?;
                    Ok(RecordBatch::from(struct_array))
                }),
            Err(e) => Err(ArrowError::ExternalError(Box::new(e))),
        })
    }
}

/// Intersection of `projection` with the file's actual columns; returns
/// `None` when the result would be empty (so the caller skips applying the
/// projection at all rather than producing a 0-column struct).
fn vortex_projection_names(
    full_schema: &Schema,
    projection: Option<&[String]>,
) -> Option<Vec<String>> {
    projection.and_then(|cols| {
        let kept: Vec<String> = cols
            .iter()
            .filter(|c| full_schema.field_with_name(c).is_ok())
            .cloned()
            .collect();
        (!kept.is_empty()).then_some(kept)
    })
}
