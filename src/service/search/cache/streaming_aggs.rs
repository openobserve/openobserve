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

    let file = format!("{}/{}/{}", STREAMING_AGGS_CACHE_DIR, file_path, file_name);
    let file = format!("{}{}", config::get_config().common.data_cache_dir, file);
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
    file_name: &str,
) -> std::io::Result<String> {
    todo!()
}
