use config::get_config;

use crate::service::workflows::get_inputs_file_path;

const CHECK_INTERVAL_MIN: u64 = 30;

pub async fn clean() {
    let cfg = get_config();
    let duration_limit = cfg.limit.workflow_error_retention_secs * 1000 * 1000;

    loop {
        let now = chrono::Utc::now().timestamp_micros();
        let limit_time = now - duration_limit;

        let error_entries =
            match infra::table::workflows::delete_all_errors_older_than(limit_time).await {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "error listing workflow errors older than {limit_time} for cleanup : {e}"
                    );
                    continue;
                }
            };
        let mut files = Vec::with_capacity(error_entries.len());
        log::info!(
            "cleaning {} old files for workflow input : {files:?}",
            files.len()
        );

        let file_paths: Vec<_> = error_entries
            .into_iter()
            .map(|error| get_inputs_file_path(&error.org_id, &error.workflow_id, &error.run_id))
            .collect();
        for path in &file_paths {
            files.push(("", path.as_str()));
        }

        if let Err(e) = infra::storage::del(files).await {
            log::error!("error deleting error input files : {e}");
        } else {
            log::info!("successfully cleaned up old workflow error files");
        }
        tokio::time::sleep(tokio::time::Duration::from_mins(CHECK_INTERVAL_MIN)).await;
    }
}
