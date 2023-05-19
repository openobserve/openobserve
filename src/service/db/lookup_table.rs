use std::collections::HashMap;
use vrl::prelude::NotNan;

use crate::service::search as SearchService;
use crate::{
    common::json,
    meta::{self, search::Request},
};

pub async fn get(org_id: &str, name: &str) -> Result<Vec<vrl_value::value::Value>, anyhow::Error> {
    let query = meta::search::Query {
        sql: format!("SELECT * FROM \"{}\"", name),
        sql_mode: "full".to_owned(),
        ..Default::default()
    };

    let req: meta::search::Request = Request {
        query,
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
    };
    // do search
    match SearchService::search(org_id, meta::StreamType::LookUpTable, &req).await {
        Ok(res) => {
            if !res.hits.is_empty() {
                Ok(res.hits.iter().map(convert_to_vrl).collect())
            } else {
                Ok(vec![])
            }
        }
        Err(err) => {
            log::error!("get lookup table data error: {:?}", err);
            Ok(vec![])
        }
    }
}

fn convert_to_vrl(value: &json::Value) -> vrl_value::Value {
    match value {
        json::Value::Null => vrl_value::Value::Null,
        json::Value::Bool(b) => vrl_value::Value::Boolean(*b),
        json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                vrl_value::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                vrl_value::Value::Float(NotNan::new(f).unwrap_or(NotNan::new(0.0).unwrap()))
            } else {
                unimplemented!("handle other number types")
            }
        }
        json::Value::String(s) => vrl_value::Value::from(s.as_str()),
        json::Value::Array(arr) => {
            vrl_value::Value::Array(arr.iter().map(convert_to_vrl).collect())
        }
        json::Value::Object(obj) => vrl_value::Value::Object(
            obj.iter()
                .map(|(k, v)| (k.to_string(), convert_to_vrl(v)))
                .collect(),
        ),
    }
}
