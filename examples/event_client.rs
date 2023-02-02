use cluster::event_client::EventClient;
use http_auth_basic::Credentials;
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use zinc_oxide::infra::config::CONFIG;

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

    let mut client = EventClient::with_interceptor(channel, move |mut req: Request<()>| {
        req.metadata_mut().insert("authorization", token.clone());
        req.metadata_mut()
            .insert(CONFIG.grpc.org_header_key.as_str(), org_id.clone());
        Ok(req)
    });
    client = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);

    let mut req_query = cluster::FileList::default();
    req_query.items.push(cluster::FileKey {
        key: "default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet".to_string(),
        meta: Some(cluster::FileMeta::default()),
        deleted: false,
    });
    req_query.items.push(cluster::FileKey {
        key: "default/logs/olympics/2022/10/03/10/6982652937134804993_2.parquet".to_string(),
        meta: Some(cluster::FileMeta::default()),
        deleted: true,
    });

    let request = tonic::Request::new(req_query);

    let response = client.send_file_list(request).await?;

    println!("RESPONSE={:?}", response);
    Ok(())
}
