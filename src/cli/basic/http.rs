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

use prettytable::{Cell, Row, Table};

pub async fn node_offline() -> Result<(), anyhow::Error> {
    let url = "/node/enable?value=false";
    let response = request(url, reqwest::Method::PUT).await?;
    if response.is_some() {
        println!("node offline successfully");
    } else {
        println!("node offline failed");
    }
    Ok(())
}
pub async fn node_online() -> Result<(), anyhow::Error> {
    let url = "/node/enable?value=true";
    let response = request(url, reqwest::Method::PUT).await?;
    if response.is_some() {
        println!("node online successfully");
    } else {
        println!("node online failed");
    }
    Ok(())
}

pub async fn node_flush() -> Result<(), anyhow::Error> {
    let url = "/node/flush";
    let response = request(url, reqwest::Method::POST).await?;
    if response.is_some() {
        println!("node flush successfully");
    } else {
        println!("node flush failed");
    }
    Ok(())
}

pub async fn node_list() -> Result<(), anyhow::Error> {
    let url = "/node/list";
    let response = request(url, reqwest::Method::GET).await?;
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
        Cell::new("HTTP Address"),
        Cell::new("Status"),
        Cell::new("Scheduled"),
        Cell::new("CPU Usage"),
        Cell::new("Memory Usage"),
    ]));

    for node in nodes {
        table.add_row(Row::new(vec![
            Cell::new(&node.id.to_string()),
            Cell::new(&node.uuid),
            Cell::new(&node.name),
            Cell::new(&node.http_addr),
            Cell::new(&format!("{:?}", node.status)),
            Cell::new(&node.scheduled.to_string()),
            Cell::new(&format!("{:.2}%", node.metrics.cpu_usage)),
            Cell::new(&format!(
                "{}",
                config::utils::size::bytes_to_human_readable(node.metrics.memory_usage as f64)
            )),
        ]));
    }

    table.printstd();
    Ok(())
}

async fn request(url: &str, method: reqwest::Method) -> Result<Option<String>, anyhow::Error> {
    let cfg = config::get_config();
    let client = reqwest::Client::new();
    let local = config::cluster::load_local_node();
    let url = format!("{}{}", local.http_addr, url);
    let user = cfg.auth.root_user_email.clone();
    let password = cfg.auth.root_user_password.clone();
    let response = client
        .request(method, url)
        .basic_auth(user, Some(password))
        .send()
        .await?;
    if response.status().is_success() {
        let body = response.text().await?;
        Ok(Some(body))
    } else {
        Ok(None)
    }
}
