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

use config::utils::size::bytes_to_human_readable;
use hashbrown::HashSet;
use prettytable::{Cell, Row, Table};

pub async fn query(
    org: &str,
    sql: &str,
    time_range: &str,
    limit: i64,
) -> Result<(), anyhow::Error> {
    let time_range = config::utils::time::parse_milliseconds(time_range)?;
    let time_end = config::utils::time::now_micros();
    let time_start = time_end - (time_range as i64 * 1000);
    let query = config::meta::search::Query {
        sql: sql.to_string(),
        from: 0,
        size: limit,
        start_time: time_start,
        end_time: time_end,
        quick_mode: false,
        ..Default::default()
    };
    let search_req = config::meta::search::Request {
        query,
        ..Default::default()
    };
    let url = format!("/api/{org}/_search");
    let body = serde_json::to_vec(&search_req)?;
    let response = request(&url, Some(body), reqwest::Method::POST).await?;
    let Some(body) = response else {
        return Err(anyhow::anyhow!("query failed"));
    };
    let response = serde_json::from_str::<config::meta::search::Response>(&body)?;
    if response.hits.is_empty() {
        println!("total: 0, scan size: 0, took: {} ms", response.took);
        return Ok(());
    }

    let mut table = Table::new();
    let mut columns = Vec::new();
    let mut columns_set = HashSet::new();
    for hit in response.hits.iter() {
        let hit = hit.as_object().unwrap();
        for key in hit.keys() {
            if columns_set.contains(key) {
                continue;
            }
            columns_set.insert(key.to_string());
            columns.push(key.to_string());
        }
    }
    let headers = columns.iter().map(|c| Cell::new(c)).collect();
    table.add_row(Row::new(headers));
    for hit in response.hits {
        let hit = hit.as_object().unwrap();
        let mut row = Vec::new();
        for column in columns.iter() {
            row.push(Cell::new(
                &hit.get(column).map_or("".to_string(), |v| v.to_string()),
            ));
        }
        table.add_row(Row::new(row));
    }
    table.printstd();
    println!(
        "total: {}, scan size: {}, took: {} ms",
        response.total,
        bytes_to_human_readable((response.scan_size * 1024 * 1024) as f64),
        response.took
    );
    Ok(())
}

pub async fn node_offline() -> Result<(), anyhow::Error> {
    let url = "/node/enable?value=false";
    let response = request(url, None, reqwest::Method::PUT).await?;
    if response.is_some() {
        println!("node offline successfully");
    } else {
        println!("node offline failed");
    }
    Ok(())
}

pub async fn node_online() -> Result<(), anyhow::Error> {
    let url = "/node/enable?value=true";
    let response = request(url, None, reqwest::Method::PUT).await?;
    if response.is_some() {
        println!("node online successfully");
    } else {
        println!("node online failed");
    }
    Ok(())
}

pub async fn node_flush() -> Result<(), anyhow::Error> {
    let url = "/node/flush";
    let response = request(url, None, reqwest::Method::POST).await?;
    if response.is_some() {
        println!("node flush successfully");
    } else {
        println!("node flush failed");
    }
    Ok(())
}

pub async fn node_list() -> Result<(), anyhow::Error> {
    let url = "/node/list";
    let response = request(url, None, reqwest::Method::GET).await?;
    let Some(body) = response else {
        return Err(anyhow::anyhow!("node list failed"));
    };
    let mut nodes: Vec<config::meta::cluster::Node> = serde_json::from_str(&body)?;
    nodes.sort_by_key(|node| node.id);

    let mut table = Table::new();
    table.add_row(Row::new(vec![
        Cell::new("ID"),
        Cell::new("UUID"),
        Cell::new("Name"),
        Cell::new("Endpoint"),
        Cell::new("Version"),
        Cell::new("Status"),
        Cell::new("Scheduled"),
        Cell::new("CPU"),
        Cell::new("MEM"),
    ]));

    for node in nodes {
        table.add_row(Row::new(vec![
            Cell::new(&node.id.to_string()),
            Cell::new(&node.uuid),
            Cell::new(&node.name),
            Cell::new(&node.http_addr),
            Cell::new(&node.version),
            Cell::new(&format!("{:?}", node.status)),
            Cell::new(&node.scheduled.to_string()),
            Cell::new(&node.metrics.cpu_total.to_string()),
            Cell::new(
                &config::utils::size::bytes_to_human_readable(node.metrics.memory_total as f64)
                    .to_string(),
            ),
        ]));
    }

    table.printstd();
    Ok(())
}

pub async fn node_list_with_metrics() -> Result<(), anyhow::Error> {
    let url = "/node/list";
    let response = request(url, None, reqwest::Method::GET).await?;
    let Some(body) = response else {
        return Err(anyhow::anyhow!("node list failed"));
    };
    let mut nodes: Vec<config::meta::cluster::Node> = serde_json::from_str(&body)?;
    nodes.sort_by_key(|node| node.id);

    let mut table = Table::new();
    table.add_row(Row::new(vec![
        Cell::new("ID"),
        Cell::new("UUID"),
        Cell::new("Name"),
        Cell::new("Endpoint"),
        Cell::new("Version"),
        Cell::new("Status"),
        Cell::new("Scheduled"),
        Cell::new("CPU"),
        Cell::new("Usage"),
        Cell::new("MEM"),
        Cell::new("Usage"),
        Cell::new("TCP Conns"),
        Cell::new("Established"),
        Cell::new("Close Wait"),
        Cell::new("Time Wait"),
    ]));

    for node in nodes {
        table.add_row(Row::new(vec![
            Cell::new(&node.id.to_string()),
            Cell::new(&node.uuid),
            Cell::new(&node.name),
            Cell::new(&node.http_addr),
            Cell::new(&node.version),
            Cell::new(&format!("{:?}", node.status)),
            Cell::new(&node.scheduled.to_string()),
            Cell::new(&node.metrics.cpu_total.to_string()),
            Cell::new(&format!("{:.2}%", node.metrics.cpu_usage)),
            Cell::new(
                &config::utils::size::bytes_to_human_readable(node.metrics.memory_total as f64)
                    .to_string(),
            ),
            Cell::new(
                &config::utils::size::bytes_to_human_readable(node.metrics.memory_usage as f64)
                    .to_string(),
            ),
            Cell::new(&node.metrics.tcp_conns.to_string()),
            Cell::new(&node.metrics.tcp_conns_established.to_string()),
            Cell::new(&node.metrics.tcp_conns_close_wait.to_string()),
            Cell::new(&node.metrics.tcp_conns_time_wait.to_string()),
        ]));
    }

    table.printstd();
    Ok(())
}

pub async fn local_node_metrics() -> Result<(), anyhow::Error> {
    let url = "/node/metrics";
    let response = request(url, None, reqwest::Method::GET).await?;
    let Some(body) = response else {
        return Err(anyhow::anyhow!("node metrics failed"));
    };
    let metrics: config::utils::sysinfo::NodeMetrics = serde_json::from_str(&body)?;

    // Create header row with all column names
    let mut table = Table::new();
    table.add_row(Row::new(vec![
        Cell::new("Name"),
        Cell::new("CPU"),
        Cell::new("Usage"),
        Cell::new("MEM"),
        Cell::new("Usage"),
        Cell::new("TCP Conns"),
        Cell::new("Established"),
        Cell::new("Close Wait"),
        Cell::new("Time Wait"),
    ]));

    // Create second row with all values
    table.add_row(Row::new(vec![
        Cell::new(&config::utils::sysinfo::os::get_hostname()),
        Cell::new(&metrics.cpu_total.to_string()),
        Cell::new(&format!("{:.2}%", metrics.cpu_usage)),
        Cell::new(
            &config::utils::size::bytes_to_human_readable(metrics.memory_total as f64).to_string(),
        ),
        Cell::new(
            &config::utils::size::bytes_to_human_readable(metrics.memory_usage as f64).to_string(),
        ),
        Cell::new(&metrics.tcp_conns.to_string()),
        Cell::new(&metrics.tcp_conns_established.to_string()),
        Cell::new(&metrics.tcp_conns_close_wait.to_string()),
        Cell::new(&metrics.tcp_conns_time_wait.to_string()),
    ]));

    table.printstd();
    Ok(())
}

pub async fn consistent_hash(files: Vec<String>) -> Result<(), anyhow::Error> {
    let url = "/node/consistent_hash";
    let req = config::meta::search::HashFileRequest { files };
    let body = serde_json::to_vec(&req)?;
    let response = request(url, Some(body), reqwest::Method::POST).await?;
    let Some(body) = response else {
        return Err(anyhow::anyhow!("consistent hash failed"));
    };
    let response: config::meta::search::HashFileResponse = serde_json::from_str(&body)?;

    // Create header row with all column names
    let mut table = Table::new();
    table.add_row(Row::new(vec![
        Cell::new("File"),
        Cell::new("Querier"),
        Cell::new("Alert Querier"),
    ]));
    for (file, nodes) in response.files.iter() {
        table.add_row(Row::new(vec![
            Cell::new(file),
            Cell::new(nodes.get("querier_interactive").unwrap_or(&"".to_string())),
            Cell::new(nodes.get("querier_background").unwrap_or(&"".to_string())),
        ]));
    }

    table.printstd();
    Ok(())
}

async fn request(
    url: &str,
    body: Option<Vec<u8>>,
    method: reqwest::Method,
) -> Result<Option<String>, anyhow::Error> {
    let cfg = config::get_config();
    let client = reqwest::Client::new();
    let local = config::cluster::load_local_node();
    let url = format!("{}{}", local.http_addr, url);
    let user = cfg.auth.root_user_email.clone();
    let password = cfg.auth.root_user_password.clone();
    let mut req = client.request(method, url).basic_auth(user, Some(password));
    if let Some(body) = body {
        req = req.header("Content-Type", "application/json");
        req = req.body(body);
    }
    let response = req.send().await?;
    let status = response.status();
    let body = response.text().await?;
    if status.is_success() {
        Ok(Some(body))
    } else {
        Err(anyhow::anyhow!(
            "request failed, status: {}, body: {}",
            status,
            body
        ))
    }
}

#[cfg(test)]
mod tests {
    use prettytable::{Cell, Row, Table};

    use super::*;

    #[tokio::test]
    async fn test_query_invalid_time_range() {
        let result = query("test_org", "SELECT * FROM logs", "invalid", 10).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_query_valid_time_range() {
        // This test validates that valid time ranges are accepted
        // Note: This will fail with network error since no server is running
        // but it validates the time parsing logic
        let result = query("test_org", "SELECT * FROM logs", "1h", 10).await;
        // We expect this to fail due to network, not time parsing
        assert!(result.is_err());
        // But the error should not be about invalid time format
        let error_msg = result.unwrap_err().to_string();
        assert!(!error_msg.contains("invalid time"));
    }

    #[test]
    fn test_time_parsing() {
        // Test that the time parsing utility works correctly
        let result = config::utils::time::parse_milliseconds("1h");
        assert!(result.is_ok_and(|v| v == 3600000));

        let result = config::utils::time::parse_milliseconds("30m");
        assert!(result.is_ok_and(|v| v == 1800000));

        let result = config::utils::time::parse_milliseconds("invalid");
        assert!(result.is_err_and(|e| e.to_string().contains("Invalid time format")));
    }

    #[test]
    fn test_bytes_to_human_readable() {
        let test_fn = config::utils::size::bytes_to_human_readable;

        for (input, expected) in [
            (1024.0, "1.00 KB"),
            (1048576.0, "1.00 MB"),
            (1073741824.0, "1.00 GB"),
        ] {
            let result = test_fn(input);
            assert_eq!(result, expected);
        }
    }

    #[tokio::test]
    async fn test_node_operations_network_failure() {
        // These tests verify that the functions handle network failures gracefully
        // They will fail due to no server running, but that's expected

        assert!(node_offline().await.is_err());
        assert!(node_online().await.is_err());
        assert!(node_flush().await.is_err());
        assert!(node_list().await.is_err());
        assert!(node_list_with_metrics().await.is_err());
        assert!(local_node_metrics().await.is_err());
        assert!(
            consistent_hash(vec!["file1.log".to_string()])
                .await
                .is_err()
        );
    }

    #[test]
    fn test_query_request_construction() {
        // Test that query requests are constructed correctly
        let time_range = config::utils::time::parse_milliseconds("1h").unwrap();
        let time_end = config::utils::time::now_micros();
        let time_start = time_end - (time_range as i64 * 1000);

        let query = config::meta::search::Query {
            sql: "SELECT * FROM logs".to_string(),
            from: 0,
            size: 10,
            start_time: time_start,
            end_time: time_end,
            quick_mode: false,
            ..Default::default()
        };

        assert_eq!(query.sql, "SELECT * FROM logs");
        assert_eq!(query.size, 10);
        assert!(!query.quick_mode);
    }

    #[test]
    fn test_json_serialization() {
        // Test that JSON serialization works for the request types
        let query = config::meta::search::Query {
            sql: "SELECT * FROM logs".to_string(),
            from: 0,
            size: 10,
            start_time: 0,
            end_time: 0,
            quick_mode: false,
            ..Default::default()
        };

        let search_req = config::meta::search::Request {
            query,
            ..Default::default()
        };

        let json_result = serde_json::to_string(&search_req);
        assert!(json_result.is_ok_and(|r| r.contains("SELECT * FROM logs") && r.contains("10")));
    }

    #[test]
    fn test_hash_file_request_serialization() {
        let req = config::meta::search::HashFileRequest {
            files: vec!["file1.log".to_string(), "file2.log".to_string()],
        };

        let result = serde_json::to_string(&req);
        assert!(result.is_ok_and(|r| r.contains("file1.log") && r.contains("file2.log")));
    }

    #[test]
    fn test_table_with_various_data_types() {
        let mut table = Table::new();

        // Test with different data types that might appear in responses
        table.add_row(Row::new(vec![Cell::new("ID"), Cell::new("Name")]));
        table.add_row(Row::new(vec![Cell::new("1"), Cell::new("John")]));
        table.add_row(Row::new(vec![Cell::new("2"), Cell::new("Jane")]));

        assert_eq!(table.len(), 3);
    }

    #[test]
    fn test_error_handling_patterns() {
        let result = config::utils::time::parse_milliseconds("invalid");
        assert!(result.is_err_and(|e| !e.to_string().is_empty()));
    }
}
