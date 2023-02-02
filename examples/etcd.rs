use async_once::AsyncOnce;
use etcd_client::{Client, Error};
use lazy_static::lazy_static;

lazy_static! {
    static ref CLIENT: AsyncOnce<Client> =
        AsyncOnce::new(async { Client::connect(["localhost:2379"], None).await.unwrap() });
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    // let mut client = Client::connect(["localhost:2379"], None).await?;
    let mut tasks = Vec::new();
    for i in 0..10 {
        let mut client = CLIENT.get().await.clone();
        let i = i;
        let task = tokio::task::spawn(async move {
            let _ret = test(&mut client, i).await;
        });
        tasks.push(task);
    }

    for task in tasks {
        task.await.unwrap();
    }

    // do 1000k write test
    // let mut client = CLIENT.get().await.clone();
    // write_1000k(&mut client).await?;
    // read_1000k(&mut client).await?;

    Ok(())
}

// async fn write_1000k(client: &mut Client) -> Result<(), Error> {
//     for i in 0..1000000 {
//         let key = format!(
//             "/btest/default/olympics/2022/10/03/10/6982652937134804993_{}.parquet",
//             i
//         );
//         let value = format!(
//             r##"{{"min_ts":1664794181570777,"max_ts":1664794188309667,"records":60000,"original_size":13605746,"compressed_size":520701}}"##
//         );
//         client.put(key.as_bytes(), value.as_bytes(), None).await?;
//     }
//     Ok(())
// }

// #[derive(Clone, Debug, serde::Deserialize)]
// struct fileInfo {
//     min_ts: u64,
//     max_ts: u64,
//     records: u64,
//     original_size: u64,
//     compressed_size: u64,
// }

// async fn read_1000k(client: &mut Client) -> Result<(), Error> {
//     let key = "/btest/".to_string();
//     let opt = GetOptions::new().with_prefix();
//     let ret = client.get(key.as_bytes(), Some(opt)).await?;
//     let mut files = HashMap::with_capacity(1000000);
//     for kv in ret.kvs() {
//         let key = String::from_utf8(kv.key().to_vec()).unwrap();
//         // let value = String::from_utf8(kv.value().to_vec()).unwrap();
//         let value:fileInfo = serde_json::from_str(kv.value_str().unwrap()).unwrap();
//         // println!("key: {}, value: {}", key, value);
//         for i in 0..10 {
//             let key = format!("{}/{}", key, i);
//             files.insert(key, value.clone());
//         }
//     }

//     println!("files len: {}", files.len());

//     tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

//     Ok(())
// }

async fn test(client: &mut Client, i: usize) -> Result<(), Error> {
    // let mut client = Client::connect(["localhost:2379"], None).await?;
    // put kv
    let key = format!("key_{}", i);
    let val = format!("value_{}", i);
    client.put(key.clone(), val, None).await?;
    // get kv
    let resp = client.get(key.clone(), None).await?;
    if let Some(kv) = resp.kvs().first() {
        println!("Get kv: {{{}: {}}}", kv.key_str()?, kv.value_str()?);
    }
    Ok(())
}
