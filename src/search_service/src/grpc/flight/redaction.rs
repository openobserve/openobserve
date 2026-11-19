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

use ::datafusion::logical_expr::ScalarUDF;
use arrow_schema::Schema;
use config::meta::stream::StreamType;
use infra::errors::Error;

use crate::datafusion::physical_optimizer::sdr_redact::redacted_columns;

/// What the scanning node redacts for the one stream it reads.
#[derive(Debug, Default)]
pub(super) struct ScanRedaction {
    protected: bool,
    udfs: HashMap<String, Arc<ScalarUDF>>,
}

impl ScanRedaction {
    /// Fails closed: a protected stream whose patterns cannot be applied is not scanned at all.
    #[cfg(feature = "vectorscan")]
    pub(super) async fn load(
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        schema: &Schema,
    ) -> Result<Self, Error> {
        use o2_enterprise::enterprise::re_patterns::{
            get_pattern_manager, search_redact_udf::sdr_redact_udf,
        };

        let manager = get_pattern_manager().await.map_err(|e| {
            Error::ResourceError(format!("search-time redaction is unavailable: {e}"))
        })?;
        let Some(protection) = manager
            .search_protection(org_id, stream_type, stream_name)
            .map_err(|e| Error::ResourceError(e.to_string()))?
        else {
            return Ok(Self::default());
        };
        // A field the schema types as non-string carries no text a pattern could match.
        let udfs = protection
            .fields
            .iter()
            .filter(|field| {
                schema.field_with_name(field).is_ok_and(|f| {
                    matches!(
                        f.data_type(),
                        arrow_schema::DataType::Utf8
                            | arrow_schema::DataType::LargeUtf8
                            | arrow_schema::DataType::Utf8View
                    )
                })
            })
            .map(|field| {
                let udf = sdr_redact_udf(org_id, stream_type, stream_name, field);
                (field.clone(), udf)
            })
            .collect();
        Ok(Self {
            protected: true,
            udfs,
        })
    }

    #[cfg(not(feature = "vectorscan"))]
    pub(super) async fn load(
        _org_id: &str,
        _stream_type: StreamType,
        _stream_name: &str,
        _schema: &Schema,
    ) -> Result<Self, Error> {
        Ok(Self::default())
    }

    pub(super) fn is_protected(&self) -> bool {
        self.protected
    }

    pub(super) fn udfs(&self) -> &HashMap<String, Arc<ScalarUDF>> {
        &self.udfs
    }

    /// The protected fields plus the raw-copy columns; empty for an unprotected stream.
    pub(super) fn redacted_columns(&self) -> std::collections::HashSet<String> {
        if self.protected {
            redacted_columns(&self.udfs)
        } else {
            Default::default()
        }
    }
}
