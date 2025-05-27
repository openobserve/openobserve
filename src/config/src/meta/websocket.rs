// Copyright 2025 OpenObserve Inc.
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

use serde::{Deserialize, Serialize};

use crate::meta::search::{Response, SearchEventContext, ValuesEventContext};

pub const MAX_QUERY_RANGE_LIMIT_ERROR_MESSAGE: &str = "Reached Max query range limit.";

pub enum SearchResultType {
    Cached(Response),
    Search(Response),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchEventReq {
    pub trace_id: String,
    pub payload: crate::meta::search::Request,
    pub time_offset: Option<i64>,
    pub stream_type: crate::meta::stream::StreamType,
    pub use_cache: bool,
    pub search_type: crate::meta::search::SearchEventType,
    #[serde(flatten)]
    pub search_event_context: Option<SearchEventContext>,
    #[serde(default)]
    pub fallback_order_by_col: Option<String>,
    // TODO: modify this once v1 is deprecated
    pub org_id: String,
    // TODO: is it PII safe?
    pub user_id: Option<String>,
    /// Top K is used only in values search
    #[serde(default)]
    pub values_event_context: Option<ValuesEventContext>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ValuesEventReq {
    pub trace_id: String,
    pub payload: crate::meta::search::ValuesRequest,
    pub stream_type: crate::meta::stream::StreamType,
    pub use_cache: bool,
    pub org_id: String,
    pub user_id: Option<String>,
}

impl ValuesEventReq {
    pub fn is_valid(&self) -> bool {
        if self.trace_id.is_empty() {
            return false;
        }
        if self.org_id.is_empty() {
            return false;
        }
        true
    }

    pub fn event_type(&self) -> &'static str {
        "values"
    }
}

impl SearchEventReq {
    pub fn is_valid(&self) -> bool {
        // TODO: add event payload validation in the future
        if self.trace_id.is_empty() {
            return false;
        }
        if self.org_id.is_empty() {
            return false;
        }
        true
    }

    pub fn event_type(&self) -> &'static str {
        "search"
    }
}
