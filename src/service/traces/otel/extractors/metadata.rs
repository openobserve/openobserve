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

//! Metadata extraction (user ID, session ID, environment, tags)

use std::collections::HashMap;

use config::utils::json;

use crate::service::traces::otel::attributes::{
    GenAiAttributes, OtelAttributes, VercelAiSdkAttributes,
};

pub struct MetadataExtractor;

impl MetadataExtractor {
    /// Extract user ID
    pub fn extract_user_id(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        let user_id_keys = [
            OtelAttributes::USER_ID,
            VercelAiSdkAttributes::TELEMETRY_METADATA_USER_ID,
        ];

        for key in &user_id_keys {
            if let Some(value) = attributes.get(*key)
                && let Some(s) = value.as_str()
            {
                return Some(s.to_string());
            }
        }
        None
    }

    /// Extract session ID
    pub fn extract_session_id(&self, attributes: &HashMap<String, json::Value>) -> Option<String> {
        let session_id_keys = [
            OtelAttributes::SESSION_ID,
            GenAiAttributes::CONVERSATION_ID,
            VercelAiSdkAttributes::TELEMETRY_METADATA_SESSION_ID,
        ];

        for key in &session_id_keys {
            if let Some(value) = attributes.get(*key)
                && let Some(s) = value.as_str()
            {
                return Some(s.to_string());
            }
        }
        None
    }
}
