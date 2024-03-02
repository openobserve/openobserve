// Copyright 2023 Zinc Labs Inc.
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
    collections::HashMap,
    io::{Error, ErrorKind},
};

use actix_web::web::Query;
use config::meta::stream::StreamType;

#[inline(always)]
pub(crate) fn get_stream_type_from_request(
    query: &Query<HashMap<String, String>>,
) -> Result<Option<StreamType>, Error> {
    let stream_type = match query.get("type") {
        Some(s) => match s.to_lowercase().as_str() {
            "logs" => Some(StreamType::Logs),
            "metrics" => Some(StreamType::Metrics),
            "traces" => Some(StreamType::Traces),
            "enrichment_tables" => Some(StreamType::EnrichmentTables),
            "metadata" => Some(StreamType::Metadata),
            "index" => Some(StreamType::Index),
            _ => {
                return Err(Error::new(
                    ErrorKind::Other,
                    "'type' query param with value 'logs', 'metrics', 'traces', 'enrichment_table', 'metadata' or 'index' allowed",
                ));
            }
        },
        None => None,
    };

    Ok(stream_type)
}

#[inline(always)]
pub(crate) fn get_folder(query: &Query<HashMap<String, String>>) -> String {
    match query.get("folder") {
        Some(s) => s.to_string(),
        None => crate::common::meta::dashboards::DEFAULT_FOLDER.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_file_from_cache() {
        let key = "type".to_string();

        let mut map: HashMap<String, String> = HashMap::default();
        map.insert(key.clone(), key.clone());

        let resp = get_stream_type_from_request(&Query(map.clone()));
        assert!(resp.is_err());

        map.insert(key.clone(), "LOGS".to_string());
        let resp = get_stream_type_from_request(&Query(map.clone()));
        assert_eq!(resp.unwrap(), Some(StreamType::Logs));

        map.insert(key.clone(), "METRICS".to_string());
        let resp = get_stream_type_from_request(&Query(map.clone()));
        assert_eq!(resp.unwrap(), Some(StreamType::Metrics));

        map.insert(key.clone(), "TRACES".to_string());
        let resp = get_stream_type_from_request(&Query(map.clone()));
        assert_eq!(resp.unwrap(), Some(StreamType::Traces));
    }
}
