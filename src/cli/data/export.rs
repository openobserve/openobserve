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

use std::{fs, path::Path};

use async_trait::async_trait;
use axum::extract::Query;
use config::{TIMESTAMP_COL_NAME, get_config, meta::search};
use hashbrown::HashMap;

use crate::{
    cli::data::{Context, cli::Cli},
    common::utils::http::{
        get_search_event_context_from_request, get_search_type_from_request,
        get_stream_type_from_request,
    },
    service::search as SearchService,
};

pub struct Export {}

#[async_trait]
impl Context for Export {
    async fn operator(c: Cli) -> Result<bool, anyhow::Error> {
        let cfg = get_config();
        let map = HashMap::from([("type".to_string(), c.stream_type)]);
        let query_map = Query(map);
        let stream_type = get_stream_type_from_request(&query_map).unwrap_or_default();

        let table = c.stream_name;
        let search_type = match get_search_type_from_request(&query_map) {
            Ok(v) => v,
            Err(_) => return Ok(false),
        };
        let search_event_context = search_type
            .as_ref()
            .and_then(|event_type| get_search_event_context_from_request(event_type, &query_map));
        let query = search::Query {
            sql: format!("select * from {table} ORDER BY {TIMESTAMP_COL_NAME} ASC"),
            from: 0,
            size: cfg.limit.query_default_limit,
            quick_mode: false,
            query_type: "".to_owned(),
            start_time: c.start_time,
            end_time: c.end_time,
            ..Default::default()
        };

        let req = search::Request {
            query,
            encoding: search::RequestEncoding::Empty,
            regions: vec![],
            clusters: vec![],
            timeout: 0,
            search_type,
            search_event_context,
            use_cache: false,
            clear_cache: false,
            local_mode: None,
        };

        match SearchService::search("", &c.org, stream_type, None, &req).await {
            Ok(res) => {
                if c.file_type != "json" {
                    eprintln!("No other file types are implemented");
                    return Ok(false);
                }
                let path = Path::new(c.data.as_str());
                fs::create_dir_all(path)?;
                let file = fs::File::create(path.join(format!(
                    "{}.{}",
                    chrono::Local::now().timestamp_micros(),
                    c.file_type
                )))?;
                serde_json::to_writer_pretty(file, &res.hits)?;
                Ok(true)
            }
            Err(e) => {
                eprintln!("search error: {e:?}");
                Ok(false)
            }
        }
    }
}
