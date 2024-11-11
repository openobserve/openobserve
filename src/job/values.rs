// Copyright 2024 Zinc Labs Inc.
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

use std::collections::{BTreeMap, HashMap};

use bytes::Bytes;
use config::{cluster::LOCAL_NODE, utils::util::zero_or};
use once_cell::sync::Lazy;
use serde_json::Value;
use tokio::{
    sync::RwLock,
    time::{self, Duration},
};

use crate::{common, service};

const VALUES_STREAM_PREFIX: &str = "distinct_values_";
static VALUES: Lazy<RwLock<HashMap<ValueEntry, usize>>> = Lazy::new(|| RwLock::new(HashMap::new()));

type ErrorChannel = (
    tokio::sync::mpsc::Sender<ValueEntry>,
    RwLock<tokio::sync::mpsc::Receiver<ValueEntry>>,
);

static ERROR_CHANNEL: Lazy<ErrorChannel> = Lazy::new(|| {
    let (tx, rx) = tokio::sync::mpsc::channel(500);
    (tx, RwLock::new(rx))
});

#[derive(Debug, Hash, PartialEq, Eq)]
struct ValueEntry {
    org: String,
    stream: String,
    value: BTreeMap<String, String>,
}

fn value_to_json(value: BTreeMap<String, String>, count: usize) -> Value {
    let mut m = serde_json::Map::new();
    for (k, v) in value {
        m.insert(k, v.into());
    }
    m.insert("count".into(), count.into());
    serde_json::Value::Object(m)
}

// TODO deal with ingestion response stuff
async fn ingest_values(
    org: String,
    stream: String,
    values: Vec<(BTreeMap<String, String>, usize)>,
) -> anyhow::Result<()> {
    let data: Vec<Value> = values
        .into_iter()
        .map(|(v, count)| value_to_json(v, count))
        .collect();

    let bytes = Bytes::from(serde_json::to_string(&data).unwrap());
    let req = common::meta::ingestion::IngestionRequest::JSON(&bytes);

    service::logs::ingest::ingest(
        0,
        &org,
        &format!("{}{}", VALUES_STREAM_PREFIX, stream),
        req,
        "",
        None,
    )
    .await?;

    Ok(())
}

pub async fn add_value(org: &str, stream: &str, value: BTreeMap<String, String>) {
    ERROR_CHANNEL
        .0
        .send(ValueEntry {
            org: org.into(),
            stream: stream.into(),
            value,
        })
        .await
        .unwrap();
}

pub async fn run() -> Result<(), anyhow::Error> {
    log::info!("[VALUES] starting values job",);

    // safeguard
    if !LOCAL_NODE.is_ingester() {
        return Ok(());
    }

    tokio::task::spawn(async {
        let mut receiver = ERROR_CHANNEL.1.write().await;
        while let Some(item) = receiver.recv().await {
            let mut map = VALUES.write().await;
            let v = map.entry(item).or_insert(0);
            *v += 1
        }
    });

    // Set up the interval timer for periodic fetching
    let timeout = zero_or(60, 60);
    let mut interval = time::interval(Duration::from_secs(timeout));
    interval.tick().await; // Trigger the first run

    loop {
        // Wait for the interval before running the task again
        interval.tick().await;

        let mut content = VALUES.write().await;
        let temp = std::mem::take(&mut *content);
        drop(content);
        if temp.is_empty() {
            continue;
        }
        let mut values: HashMap<(String, String), Vec<(BTreeMap<String, String>, usize)>> =
            HashMap::new();
        for value in temp.into_iter() {
            values
                .entry((value.0.org, value.0.stream))
                .or_default()
                .push((value.0.value, value.1));
        }

        for (k, v) in values {
            match ingest_values(k.0, k.1, v).await {
                Ok(_) => {
                    log::debug!("successfully ingested values");
                }
                Err(e) => {
                    log::error!("error in ingesting values {}", e)
                }
            }
        }
    }
}
