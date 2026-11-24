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

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

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
    /// A `raw` stream is scanned as if unprotected, raw-copy columns included.
    #[cfg(feature = "vectorscan")]
    pub(super) async fn load(
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        schema: &Schema,
        raw: bool,
    ) -> Result<Self, Error> {
        use arrow_schema::DataType;
        use o2_enterprise::enterprise::re_patterns::{
            get_pattern_manager, search_redact_udf::sdr_redact_udf,
        };

        if raw {
            return Ok(Self::default());
        }
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
                        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View
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
        _raw: bool,
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
    pub(super) fn redacted_columns(&self) -> HashSet<String> {
        if self.protected {
            redacted_columns(&self.udfs)
        } else {
            Default::default()
        }
    }
}

#[cfg(all(test, feature = "vectorscan"))]
mod tests {
    use arrow_schema::{DataType, Field};
    use config::meta::stream::PatternAssociation;
    use infra::table::re_pattern::PatternEntry;
    use o2_enterprise::enterprise::re_patterns::{PATTERN_MANAGER, PatternManager};

    use super::*;

    const ORG: &str = "sdr_scan_raw";

    fn protect_msg() {
        if PATTERN_MANAGER.get().is_none() {
            let _ = PATTERN_MANAGER.set(PatternManager::empty());
        }
        let mgr = PATTERN_MANAGER.get().unwrap();
        mgr.insert_pattern(PatternEntry {
            id: "scan_raw_secret".to_string(),
            org: ORG.to_string(),
            name: "scan_raw_secret".to_string(),
            description: String::new(),
            created_by: String::new(),
            created_at: 0,
            updated_at: 0,
            pattern: r"SECRETVAL\d+".to_string(),
        });
        mgr.update_associations(
            ORG,
            StreamType::Logs,
            "app",
            vec![],
            vec![PatternAssociation {
                field: "msg".to_string(),
                pattern_id: "scan_raw_secret".to_string(),
                policy: "Redact".to_string(),
                apply_at: "AtSearch".to_string(),
                ..Default::default()
            }],
        )
        .unwrap();
    }

    #[tokio::test]
    async fn a_raw_stream_is_scanned_as_unprotected() {
        protect_msg();
        let schema = Schema::new(vec![Field::new("msg", DataType::Utf8, true)]);

        let redacted = ScanRedaction::load(ORG, StreamType::Logs, "app", &schema, false)
            .await
            .unwrap();
        assert!(redacted.udfs().contains_key("msg"));
        assert!(redacted.redacted_columns().contains("msg"));

        let raw = ScanRedaction::load(ORG, StreamType::Logs, "app", &schema, true)
            .await
            .unwrap();
        assert!(!raw.is_protected());
        assert!(raw.udfs().is_empty());
        assert!(raw.redacted_columns().is_empty());
    }
}
