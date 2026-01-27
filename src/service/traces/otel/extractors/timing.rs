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

//! Timing information extraction

use std::collections::HashMap;

use config::utils::json;

use crate::service::traces::otel::attributes::VercelAiSdkAttributes;

pub struct TimingExtractor;

impl TimingExtractor {
    /// Extract completion start time (time to first token)
    /// Calculates the timestamp of when the first token was generated
    pub fn extract_completion_start_time(
        &self,
        attributes: &HashMap<String, json::Value>,
        start_time_iso: Option<&str>,
    ) -> Option<String> {
        // Try to get ms to first chunk from Vercel AI SDK
        let ms_to_first_chunk = attributes
            .get(VercelAiSdkAttributes::RESPONSE_MS_TO_FIRST_CHUNK)
            .or_else(|| attributes.get(VercelAiSdkAttributes::STREAM_MS_TO_FIRST_CHUNK));

        if let Some(ms_value) = ms_to_first_chunk
            && let Some(start_time) = start_time_iso
        {
            // Parse the start time as ISO timestamp
            if let Ok(start_datetime) = chrono::DateTime::parse_from_rfc3339(start_time) {
                // Get milliseconds value
                let ms = if let Some(num) = ms_value.as_f64() {
                    num.ceil() as i64
                } else if let Some(num) = ms_value.as_i64() {
                    num
                } else if let Some(s) = ms_value.as_str() {
                    s.parse::<f64>().ok().map(|n| n.ceil() as i64)?
                } else {
                    return None;
                };

                // Add milliseconds to start time
                let completion_start = start_datetime + chrono::Duration::milliseconds(ms);

                return Some(completion_start.to_rfc3339());
            }
        }

        None
    }
}
