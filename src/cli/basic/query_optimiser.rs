use std::{
    fmt::{Display, Formatter},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::Error;
use config::meta::stream::StreamSettings;
use hashbrown::HashMap;
use o2_enterprise::enterprise::common::sql_filter_util::*;
use serde_json::Value;

use crate::common::meta::stream::Stream;

fn clean_sql_query(query: &str) -> String {
    let cleaned = query
        .trim()
        .replace("\\\"", "\"") // Remove escaped quotes
        .replace("\\n", " ") // Replace newlines with spaces
        .replace("\\t", " ") // Replace tabs with spaces
        .replace("\\r", " ") // Replace carriage returns with spaces
        .split_whitespace() // Split by whitespace
        .collect::<Vec<&str>>() // Collect into vector
        .join(" ") // Rejoin with single spaces
        .trim()
        .to_string();

    // Remove outer quotes if they exist
    let cleaned = if cleaned.starts_with('"') && cleaned.ends_with('"') {
        cleaned[1..cleaned.len() - 1].to_string()
    } else {
        cleaned
    };

    // Add semicolon if missing
    if !cleaned.ends_with(';') {
        cleaned + ";"
    } else {
        cleaned
    }
}

#[cfg(feature = "enterprise")]
pub async fn query_optimiser(
    url: &str,
    token: &str,
    meta_token: &Option<String>,
    duration: i64,
    stream_name: &Option<String>,
) -> Result<(), Error> {
    println!("query_optimiser Start");

    let meta_token = match meta_token {
        Some(meta_token) => meta_token,
        None => token,
    };

    match get_query_data_from_usage(url, meta_token, duration, stream_name).await {
        Ok(data) => {
            println!("get_query_data_from_usage Got data");

            let data_array = data.as_array().unwrap();
            println!("data_array: {:?}", data_array.len());
            // Create QueryInfo objects with counts from the API response
            let all_sql_queries: Vec<QueryInfo> = data_array.iter().map(|hit| {
                            let query = clean_sql_query(&hit.get("request_body").unwrap().to_string());
                            let count = hit.get("r_count").unwrap().as_u64().unwrap_or(1) as usize;
                            QueryInfo { query, count }
                        })
                        .filter(|query_info| !query_info.query.is_empty()) // Filter out empty queries
                        .collect::<Vec<_>>();
            println!("all_sql_queries: {:?}", all_sql_queries.len());
            let result = analyze_where_clauses_by_table(&all_sql_queries);

            let streams = get_stream_settings(url, token, stream_name).await?;
            let stream_map = streams
                .iter()
                .map(|stream| (stream.name.clone(), stream))
                .collect::<HashMap<String, &Stream>>();
            let mut stream_partition_map = HashMap::new();
            for stream in &streams {
                stream_partition_map.insert(
                    stream.name.clone(),
                    stream
                        .settings
                        .partition_keys
                        .iter()
                        .map(|partition| partition.field.clone())
                        .collect::<Vec<String>>(),
                );
            }
            match result {
                Ok(table_columns) => {
                    println!("Analysis by table:");
                    for (table_name, columns) in &table_columns {
                        if let Some(stream_settings) = stream_map.get(table_name) {
                            println!("--------------------------------------------------------");
                            println!("********** {table_name} **********");
                            let stream_settings = stream_settings.settings.clone();
                            for col in columns {
                                let partition_keys = stream_partition_map.get(table_name).unwrap();
                                if partition_keys.contains(&col.column_name) {
                                    println!(
                                        "col {} is partition key &  uses {:?}",
                                        col.column_name, col.operators
                                    );
                                    continue;
                                }

                                if stream_settings.index_fields.contains(&col.column_name)
                                    && !col.operators.contains(&O2Operators::Eq.to_string())
                                    && !col.operators.contains(&O2Operators::StrMatch.to_string())
                                    && !col.operators.contains(&O2Operators::In.to_string())
                                {
                                    println!(
                                        "col {} , is secondary index hence use str_match",
                                        col.column_name
                                    );
                                    println!(
                                        "  - {}: used operators={:?}, occurrences={}",
                                        col.column_name, col.operators, col.occurrences
                                    );
                                } else if stream_settings
                                    .full_text_search_keys
                                    .contains(&col.column_name)
                                    && !col.operators.contains(&O2Operators::MatchAll.to_string())
                                {
                                    println!(
                                        "col {} , is full text search key hence use match_all",
                                        col.column_name
                                    );
                                    println!(
                                        "  - {}: operators={:?}, occurrences={}",
                                        col.column_name, col.operators, col.occurrences
                                    );
                                } else {
                                    for (operator, occurrences) in &col.operator_occurrences {
                                        if *operator == O2Operators::Eq.to_string()
                                            || *operator == O2Operators::In.to_string()
                                            || *operator == O2Operators::StrMatch.to_string()
                                        {
                                            println!(
                                                "Enable secondary index for col {} , occurrences {} of total {}",
                                                col.column_name, occurrences, col.occurrences
                                            );
                                        } else if *operator == O2Operators::Like.to_string()
                                            || *operator == O2Operators::RegexMatch.to_string()
                                        {
                                            println!(
                                                "Enable full text search for col {} , occurrences {} of total {}",
                                                col.column_name, occurrences, col.occurrences
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    panic!("Failed to analyze WHERE clauses by table: {e}");
                }
            }
        }
        Err(e) => {
            println!("get_query_data_from_usage Error: {e}");
            return Err(e);
        }
    }

    Ok(())
}

async fn get_query_data_from_usage(
    url: &str,
    token: &str,
    duration: i64,
    stream_name: &Option<String>,
) -> Result<Value, Error> {
    let search_url = format!("{url}/api/_meta/_search");

    let duration_micros = duration * 60 * 60 * 1000000;

    let end_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_micros();
    let start_time = end_time.saturating_sub(duration_micros as u128);

    let sql_query = match stream_name {
        Some(stream_name) => {
            format!(
                "SELECT request_body ,count(request_body) as r_count , max(response_time) as m_rs   FROM \"usage\" WHERE event = 'Search' AND search_type != 'ui'  and request_body like '%{stream_name}%' group by request_body  order by m_rs desc"
            )
        }
        None => {
            "SELECT request_body ,count(request_body) as r_count , max(response_time) as m_rs   FROM \"usage\" WHERE event = 'Search' AND search_type != 'ui' group by request_body  order by m_rs desc".to_string()
        }
    };

    // Create the request body JSON
    let request_body = serde_json::json!({
        "query": {
            "sql": sql_query,
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": -1,
            "quick_mode": false,
            "sql_mode": "full",
        }
    });

    // Create HTTP client with authorization header
    let client = reqwest::Client::new();
    let response = client
        .post(&search_url)
        .header("Authorization", token)
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "en-GB,en-US;q=0.9,en;q=0.8")
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await;
    match response {
        Ok(response) => {
            let status = response.status();

            match response.text().await {
                Ok(body) => {
                    if status.is_success() {
                        let data: serde_json::Value = serde_json::from_str(&body)?;
                        // Get the hits array from the response
                        if let Some(hits) = data.get("hits") {
                            println!("Response has 'hits' field");
                            Ok(hits.clone())
                        } else {
                            println!("No 'hits' field found in response");
                            Ok(data)
                        }
                    } else {
                        Err(anyhow::anyhow!("HTTP error {status}: {body}"))
                    }
                }
                Err(e) => {
                    println!("Error reading response body: {e}");
                    Err(e.into())
                }
            }
        }
        Err(e) => {
            println!("Error sending request: {e}");
            Err(e.into())
        }
    }
}

async fn get_stream_settings(
    url: &str,
    token: &str,
    _stream_name: &Option<String>,
) -> Result<Vec<Stream>, Error> {
    let streams_url =
        format!("{url}/api/default/streams?type=logs&sort=name&asc=true&fetchSchema=true");

    // Create HTTP client with authorization header
    let client = reqwest::Client::new();
    let response = client
        .get(&streams_url)
        .header("Authorization", token)
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "en-GB,en-US;q=0.9,en;q=0.8")
        .send()
        .await?;

    match response.text().await {
        Ok(body) => {
            let list_stream: Value = serde_json::from_str(&body)?;
            let list_stream_value = list_stream.get("list").unwrap();
            let list_stream_array = list_stream_value.as_array().unwrap();
            let streams = list_stream_array
                .iter()
                .map(|item| {
                    let settings =
                        StreamSettings::from(item.get("settings").unwrap().to_string().as_str());
                    Stream {
                        name: item.get("name").unwrap().as_str().unwrap().to_string(),
                        storage_type: item
                            .get("storage_type")
                            .unwrap()
                            .as_str()
                            .unwrap()
                            .to_string(),
                        stream_type: item
                            .get("stream_type")
                            .unwrap()
                            .as_str()
                            .unwrap()
                            .to_string()
                            .into(),
                        stats: config::meta::stream::StreamStats::default(),
                        schema: vec![],
                        uds_schema: vec![crate::common::meta::stream::StreamProperty {
                            name: "uds_field".to_string(),
                            prop_type: "string".to_string(),
                        }],
                        settings,
                        metrics_meta: None,
                        total_fields: 1,
                        is_derived: None,
                    }
                })
                .collect::<Vec<Stream>>();
            Ok(streams)
        }
        Err(e) => {
            println!("Error: {e}");
            Err(e.into())
        }
    }
}

pub enum O2Operators {
    Eq,
    StrMatch,
    MatchAll,
    In,
    Like,
    RegexMatch,
}

impl Display for O2Operators {
    fn fmt(&self, f: &mut Formatter<'_>) -> Result<(), std::fmt::Error> {
        match self {
            O2Operators::Eq => write!(f, "="),
            O2Operators::StrMatch => write!(f, "str_match"),
            O2Operators::MatchAll => write!(f, "match_all"),
            O2Operators::In => write!(f, "IN"),
            O2Operators::Like => write!(f, "LIKE"),
            O2Operators::RegexMatch => write!(f, "REGEX"),
        }
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn query_optimiser(
    url: &str,
    token: &str,
    meta_token: &Option<String>,
    duration: i64,
    stream_name: &Option<String>,
) -> Result<(), Error> {
    println!("query_optimiser not supported");
    Ok(())
}
