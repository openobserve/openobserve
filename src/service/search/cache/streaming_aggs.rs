use std::{fs::File, path::Path, sync::Arc};

use arrow::{
    array::RecordBatch,
    ipc::{reader::FileReader as ArrowFileReader, writer::FileWriter as ArrowFileWriter},
};

const STREAMING_AGGS_CACHE_DIR: &str = "result_streaming_aggs";

pub fn cache_streaming_aggs_to_disk(
    file_path: &str,
    file_name: &str,
    records: Vec<Arc<RecordBatch>>,
) -> std::io::Result<()> {
    if records.is_empty() {
        return Ok(());
    }

    let file = construct_cache_path(file_path);
    let file = format!("{}/{}", file, file_name);
    // create the directory if not exists
    let dir = Path::new(&file).parent().unwrap();
    if !dir.exists() {
        std::fs::create_dir_all(dir).unwrap();
    }
    // create the file using the full path
    let file_handle = File::create(&file).unwrap();

    // Create an Arrow IPC writer
    let mut writer = ArrowFileWriter::try_new(file_handle, &records[0].schema().as_ref()).unwrap();

    // Write each batch
    for record in records {
        writer.write(&record).unwrap();
    }
    writer.finish().unwrap();
    Ok(())
}

pub async fn get_streaming_aggs_records_from_disk(
    file_path: &str,
    start_time: i64,
    end_time: i64,
) -> std::io::Result<(Vec<RecordBatch>, bool)> {
    let cache_path = construct_cache_path(file_path);
    if !Path::new(&cache_path).exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Cache file not found",
        ));
    }

    let mut cached_records = Vec::new();

    // Check if cached records were found for the entire time range
    let read_dir = std::fs::read_dir(&cache_path)?;
    let files: Vec<_> = read_dir.collect::<Result<Vec<_>, _>>()?;
    let files_num = files.len();
    log::info!("Found {} files in cache path: {}", files_num, cache_path);

    for file in files {
        let file_name = file.file_name();
        let file_name_str = file_name.to_str().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid filename")
        })?;

        // Remove file extension before parsing timestamps
        let name_without_ext = file_name_str
            .rsplit_once('.')
            .map(|(name, _)| name)
            .unwrap_or(file_name_str);

        let parts: Vec<&str> = name_without_ext.split("_").collect();
        if parts.len() < 2 {
            continue;
        }
        let file_start_time = match parts[0].parse::<i64>() {
            Ok(time) => time,
            Err(e) => {
                log::error!("Invalid start time in file name: {}: {}", file_name_str, e);
                continue;
            }
        };
        let file_end_time = match parts[1].parse::<i64>() {
            Ok(time) => time,
            Err(e) => {
                log::error!("Invalid end time in file name: {}: {}", file_name_str, e);
                continue;
            }
        };

        // Check if file time range overlaps with requested time range
        // Overlap condition:
        if file_start_time <= end_time && file_end_time >= start_time {
            let file_path_full = format!("{}/{}", cache_path, file_name_str);
            let file = File::open(&file_path_full)?;
            let reader = ArrowFileReader::try_new(file, None).map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("Arrow error: {}", e),
                )
            })?;
            for batch_result in reader {
                let batch = batch_result.map_err(|e| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("Arrow error: {}", e),
                    )
                })?;
                cached_records.push(batch);
            }
        }
    }

    // Return the cached records if any were found
    if !cached_records.is_empty() {
        log::info!(
            "Loaded {} cached record batches from {}",
            cached_records.len(),
            file_path
        );
        return Ok((cached_records, true));
    }

    // No cached records found
    Ok((Vec::new(), false))
}

pub fn construct_cache_path(file_path: &str) -> String {
    format!(
        "{}{}/{}",
        config::get_config().common.data_cache_dir,
        STREAMING_AGGS_CACHE_DIR,
        file_path
    )
}
