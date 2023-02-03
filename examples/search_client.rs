use cluster::search_client::SearchClient;
use cluster::SearchRequest;
use http_auth_basic::Credentials;
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use zinc_observe::infra::config::CONFIG;

pub mod cluster {
    tonic::include_proto!("cluster");
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let credentials = Credentials::new(&CONFIG.auth.username, &CONFIG.auth.password);
    let credentials = credentials.as_http_header();
    let token: MetadataValue<_> = credentials.parse()?;
    let org_id: MetadataValue<_> = "default".parse()?;
    let channel = Channel::from_static("http://127.0.0.1:5081")
        .connect()
        .await?;

    let mut client = SearchClient::with_interceptor(channel, move |mut req: Request<()>| {
        req.metadata_mut().insert("authorization", token.clone());
        req.metadata_mut()
            .insert(CONFIG.grpc.org_header_key.as_str(), org_id.clone());
        Ok(req)
    });
    client = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);

    let req_query = cluster::SearchQuery {
        sql: "select * from k8s".to_string(),
        sql_mode: "".to_string(),
        from: 0,
        size: 10,
        start_time: 0,
        end_time: 0,
        track_total_hits: true,
    };
    // let mut aggs = AHashMap::new();
    // aggs.insert("histogram".to_string(),"select histogram(_timestamp, '1 minute') AS key, count(*) AS num from query GROUP BY key ORDER BY key".to_string());
    // let mut file_list = Vec::with_capacity(100000);
    // for _ in 0..2 {
    //     file_list
    //         .push("default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet".to_string());
    //     file_list
    //         .push("default/logs/olympics/2022/10/03/10/6982655327841947649_1.parquet".to_string());
    //     file_list
    //         .push("default/logs/olympics/2022/10/03/11/6982665068089577473_1.parquet".to_string());
    // }

    let request = tonic::Request::new(SearchRequest {
        job: Some(cluster::Job::default()),
        org_id: "default".to_string(),
        stype: cluster::SearchType::User.into(),
        query: Some(req_query),
        aggs: Vec::new(),
        partition: None,
        file_list: Vec::new(),
        stream_type: "logs".to_string(),
    });

    let response = client.search(request).await?;

    println!("{}", serde_json::to_string(&response.into_inner()).unwrap());

    Ok(())
}
