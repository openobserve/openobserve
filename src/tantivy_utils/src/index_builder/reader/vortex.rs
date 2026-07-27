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

//! Vortex record readers used while building indexes.

use std::{ops::Range, sync::Arc};

use arrow::{datatypes::DataType, error::ArrowError, record_batch::RecordBatch};
use arrow_schema::Schema;
use bytes::Bytes;
use config::utils::parquet::{RecordBatchStream, vortex_array_to_record_batch};
use futures::StreamExt;
use vortex::{
    VortexSessionDefault,
    array::ArrayRef,
    expr::{root, select},
    file::{OpenOptionsSessionExt, VortexFile},
    io::{
        runtime::{BlockingRuntime, single::SingleThreadRuntime},
        session::RuntimeSessionExt,
    },
    layout::scan::scan_builder::ScanBuilder,
    session::VortexSession,
};

use super::RecordBatchIter;

/// Open a vortex file, apply an optional projection, and return an async
/// record batch stream over all rows.
pub(super) async fn scan_vortex_async(
    data: Bytes,
    projection: Option<&[String]>,
) -> Result<RecordBatchStream, anyhow::Error> {
    let session = VortexSession::default().with_tokio();
    let vxf = session.open_options().open_buffer(data)?;
    let scan = open_projected_scan(&vxf, projection)?;

    let stream_schema: Arc<Schema> = Arc::new(scan.dtype()?.to_arrow_schema()?);
    let data_type = DataType::Struct(stream_schema.fields().clone());

    let stream = scan.into_array_stream()?.then(move |result| {
        let data_type = data_type.clone();
        let session = session.clone();
        async move {
            match result {
                Ok(array) => vortex_array_to_record_batch(&session, array, &data_type),
                Err(e) => Err(ArrowError::ExternalError(Box::new(e))),
            }
        }
    });

    let stream: RecordBatchStream = Box::pin(stream);
    Ok(stream)
}

/// Build a lazy sync iterator for one vortex row range.
pub(super) fn scan_vortex_row_range(
    data: Bytes,
    projection: Option<&[String]>,
    row_range: Range<u64>,
) -> Result<RecordBatchIter, anyhow::Error> {
    let runtime = SingleThreadRuntime::default();
    let session = VortexSession::default().with_handle(runtime.handle());
    let vxf = session.open_options().open_buffer(data)?;
    let scan = open_projected_scan(&vxf, projection)?.with_row_range(row_range);

    let stream_schema: Arc<Schema> = Arc::new(scan.dtype()?.to_arrow_schema()?);
    let data_type = DataType::Struct(stream_schema.fields().clone());

    let iter: Box<dyn Iterator<Item = Result<RecordBatch, ArrowError>> + 'static> = Box::new(
        scan.into_array_iter(&runtime)?
            .map(move |result| match result {
                Ok(array) => vortex_array_to_record_batch(&session, array, &data_type),
                Err(e) => Err(ArrowError::ExternalError(Box::new(e))),
            }),
    );

    Ok(Box::new(VortexRowRangeIter {
        iter,
        _runtime: runtime,
    }))
}

struct VortexRowRangeIter {
    iter: Box<dyn Iterator<Item = Result<RecordBatch, ArrowError>> + 'static>,
    _runtime: SingleThreadRuntime, // dropped last — keeps Arc<Sender> alive
}

impl Iterator for VortexRowRangeIter {
    type Item = Result<RecordBatch, ArrowError>;

    fn next(&mut self) -> Option<Self::Item> {
        self.iter.next()
    }
}

fn open_projected_scan(
    vxf: &VortexFile,
    projection: Option<&[String]>,
) -> Result<ScanBuilder<ArrayRef>, anyhow::Error> {
    let full_schema = vxf.dtype().to_arrow_schema()?;
    let mut scan = vxf.scan()?;
    if let Some(cols) = projection {
        let kept: Vec<&str> = cols
            .iter()
            .filter(|c| full_schema.field_with_name(c).is_ok())
            .map(String::as_str)
            .collect();
        if !kept.is_empty() {
            scan = scan.with_projection(select(kept, root()));
        }
    }
    Ok(scan)
}
