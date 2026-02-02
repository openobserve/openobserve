use tokio::time;

pub async fn run() -> Result<(), anyhow::Error> {
    let mut interval = time::interval(time::Duration::from_secs(10));

    // trigger the first run
    interval.tick().await;

    tokio::spawn(async move {
        loop {
            interval.tick().await;
            if let Err(e) = crate::service::pipeline::batch_execution::flush_all_buffers().await {
                log::error!("Error flushing all buffers: {e}");
            }
        }
    });

    Ok(())
}
