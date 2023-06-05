use std::collections::HashMap;
use vrl::prelude::NotNan;

use crate::infra::cache::stats;
use crate::service::search as SearchService;
use crate::{
    common::json,
    meta::{self, search::Request},
};

pub async fn get(org_id: &str, name: &str) -> Result<Vec<vrl::value::Value>, anyhow::Error> {
    let stats = stats::get_stream_stats(org_id, name, meta::StreamType::EnrichmentTables);

    let rec_num = if stats.doc_num == 0 {
        100000
    } else {
        stats.doc_num
    };

    let query = meta::search::Query {
        sql: format!("SELECT * FROM \"{name}\" limit {rec_num}"),
        sql_mode: "full".to_owned(),
        ..Default::default()
    };

    let req: meta::search::Request = Request {
        query,
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
    };
    // do search
    match SearchService::search(org_id, meta::StreamType::EnrichmentTables, &req).await {
        Ok(res) => {
            if !res.hits.is_empty() {
                Ok(res.hits.iter().map(convert_to_vrl).collect())
            } else {
                Ok(vec![])
            }
        }
        Err(err) => {
            log::error!("get enrichment table data error: {:?}", err);
            Ok(vec![])
        }
    }
}

fn convert_to_vrl(value: &json::Value) -> vrl::value::Value {
    match value {
        json::Value::Null => vrl::value::Value::Null,
        json::Value::Bool(b) => vrl::value::Value::Boolean(*b),
        json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                vrl::value::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                vrl::value::Value::Float(NotNan::new(f).unwrap_or(NotNan::new(0.0).unwrap()))
            } else {
                unimplemented!("handle other number types")
            }
        }
        json::Value::String(s) => vrl::value::Value::from(s.as_str()),
        json::Value::Array(arr) => {
            vrl::value::Value::Array(arr.iter().map(convert_to_vrl).collect())
        }
        json::Value::Object(obj) => vrl::value::Value::Object(
            obj.iter()
                .map(|(k, v)| (k.to_string(), convert_to_vrl(v)))
                .collect(),
        ),
    }
}
