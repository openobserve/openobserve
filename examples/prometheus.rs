use bytes::{Bytes, BytesMut};
use chrono::Utc;
use prost::Message;
use tokio::time::sleep;
use tokio::time::Duration;
pub mod prometheus_prot {
    include!(concat!(env!("OUT_DIR"), "/prometheus.rs"));
}

#[tokio::main]
async fn main() {
    let replicas = ["prom-k8s-0", "prom-k8s-2", "prom-k8s-0"];
    let labels = [
        "grafana_api_dashboard_save_milliseconds_count",
        "kube_cronjob_info",
        "alertmanager_config_hash",
    ];
    let handle = tokio::spawn(async move {
        for i in 1..10 {
            sleep(Duration::from_secs(1)).await;
            let client = reqwest::Client::new();
            let mut loc_lable: Vec<prometheus_prot::Label> = vec![];
            loc_lable.push(prometheus_prot::Label {
                name: "__name__".to_string(),
                value: labels[i % 3].to_string(),
            });

            loc_lable.push(prometheus_prot::Label {
                name: "cluster".to_string(),
                value: "prom-k8s".to_string(),
            });
            loc_lable.push(prometheus_prot::Label {
                name: "__replica__".to_string(),
                value: replicas[i % 3].to_string(),
            });

            let mut loc_samples: Vec<prometheus_prot::Sample> = vec![];

            for i in 1..100 {
                loc_samples.push(prometheus_prot::Sample {
                    value: i as f64,
                    timestamp: Utc::now().timestamp_micros(),
                });
            }
            loc_samples.push(prometheus_prot::Sample {
                value: f64::NEG_INFINITY,
                timestamp: Utc::now().timestamp_micros(),
            });
            loc_samples.push(prometheus_prot::Sample {
                value: f64::INFINITY,
                timestamp: Utc::now().timestamp_micros(),
            });

            loc_samples.push(prometheus_prot::Sample {
                value: 0.0_f64 / 0.0_f64,
                timestamp: Utc::now().timestamp_micros(),
            });
            println!("Number of samples {}", loc_samples.len());
            let loc_exemp: Vec<prometheus_prot::Exemplar> = vec![];
            let loc_hist: Vec<prometheus_prot::Histogram> = vec![];

            let ts = prometheus_prot::TimeSeries {
                labels: loc_lable,
                samples: loc_samples,
                exemplars: loc_exemp,
                histograms: loc_hist,
            };

            let metadata: Vec<prometheus_prot::MetricMetadata> = vec![];
            let wr_req: prometheus_prot::WriteRequest = prometheus_prot::WriteRequest {
                timeseries: vec![ts],
                metadata,
            };
            let mut out = BytesMut::with_capacity(wr_req.encoded_len());
            wr_req.encode(&mut out).expect("Out of memory");
            let body = snap_block(out.into());

            let req = client
                .post("http://localhost:5080/api/nexus/prometheus/write")
                .header("Authorization", "Basic YWRtaW46Q29tcGxleHBhc3MjMTIz")
                .header("X-Prometheus-Remote-Write-Version", "0.1.0")
                .header("Content-Encoding", "snappy")
                .header("Content-Type", "application/x-protobuf")
                .body(body);

            let res = req.send().await.unwrap();
            println!("{}", res.status());
        }
    });
    let _out = handle.await.unwrap();
}

fn snap_block(data: Bytes) -> Vec<u8> {
    snap::raw::Encoder::new()
        .compress_vec(&data)
        .expect("Out of memory")
}
