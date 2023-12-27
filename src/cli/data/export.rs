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

use std::{collections::HashMap, fs, path::Path};

use actix_web::web::Query;
use ahash::AHashMap;
use config::meta::stream::StreamType;

use crate::{
    cli::data::{cli::Cli, Context},
    common::{meta::search::Request, utils::http::get_stream_type_from_request},
    service::search as SearchService,
};

pub struct Export {}

impl Context for Export {
    fn operator(c: Cli) -> Result<bool, anyhow::Error> {
        let map = AHashMap::from([("type".to_string(), c.stream_type)]);

        let stream_type = match get_stream_type_from_request(&Query(map.clone())) {
            Ok(v) => v.unwrap_or(StreamType::Logs),
            Err(_) => return Ok(false),
        };

        let table = c.stream_name;
        let query = crate::common::meta::search::Query {
            sql: format!("select * from {}", table),
            from: 0,
            size: 100,
            sql_mode: "full".to_owned(),
            query_type: "".to_owned(),
            start_time: c.start_time,
            end_time: c.end_time,
            sort_by: Some(format!("{} ASC", config::CONFIG.common.column_timestamp)),
            track_total_hits: false,
            query_context: None,
            uses_zo_fn: false,
            query_fn: None,
        };

        let req: Request = Request {
            query,
            aggs: HashMap::new(),
            encoding: crate::common::meta::search::RequestEncoding::Empty,
            timeout: 0,
        };

        tokio::runtime::Runtime::new().unwrap().block_on(async {
            match SearchService::search("", &c.org, stream_type, &req).await {
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
                Err(err) => {
                    eprintln!("search error: {:?}", err);
                    Ok(false)
                }
            }
        })
    }
}
