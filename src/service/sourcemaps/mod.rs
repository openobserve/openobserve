use std::io::Read;

use anyhow::Context;
use hashbrown::{HashMap, HashSet};
use infra::{
    storage,
    table::source_maps::{FileType, SourceMap},
};

use super::db::sourcemaps;

fn get_file_path(org_id: &str, name: &str) -> String {
    format!("files/{org_id}/sourcemaps/{name}")
}

pub async fn process_zip(
    org_id: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
    file_data: Vec<u8>,
) -> Result<(), anyhow::Error> {
    // Attempt to read the uploaded data as a ZIP file
    let mut archive = match zip::read::ZipArchive::new(std::io::Cursor::new(file_data)) {
        Ok(archive) => archive,
        Err(e) => {
            log::error!("Error reading sourcemap ZIP file for org {org_id} : {e}");
            return Err(anyhow::anyhow!("error in reading zip file : {e}"));
        }
    };
    let mut minified = HashSet::new();
    let mut map_files = HashMap::new();

    // first filter out the js and .map files from teh archive
    for name in archive.file_names() {
        if name.ends_with(".js") {
            let (_, file_name) = name.rsplit_once("/").unwrap_or(("", name));
            minified.insert(file_name.to_string());
        } else if name.ends_with(".js.map") {
            let (_, file_name) = name.rsplit_once("/").unwrap_or(("", name));
            map_files.insert(file_name.to_string(), name.to_string());
        }
    }

    let mut map_pairs = Vec::with_capacity(minified.len());

    // check that for all js files, we have a corresponding .map
    // file present. If not, currently we do not support that.
    for mfile in minified {
        let expected_mapfile = format!("{mfile}.map");

        // we expect that all minified files have corresponding maps
        // if any of them is not present, we need to error out.
        if let Some(path) = map_files.remove(&expected_mapfile) {
            map_pairs.push((mfile, (expected_mapfile, path)));
        } else {
            return Err(anyhow::anyhow!(
                "no mapfile corresponding to source {mfile} found"
            ));
        }
    }

    // for remaining map files, assume the minified files are with
    // suffix .map stripped
    for (mapfile, path) in map_files {
        log::warn!(
            "no source file found corresponding to sourcemap {mapfile} for org_id {org_id}, creating default entry."
        );
        let expected_minified = mapfile.strip_suffix(".map").unwrap();
        map_pairs.push((expected_minified.to_string(), (mapfile, path)));
    }

    let mut source_maps = Vec::with_capacity(map_pairs.len());
    let mut source_map_paths = Vec::with_capacity(map_pairs.len());

    let now = chrono::Utc::now().timestamp_micros();

    // finally, for each minified-sourcemap pair -
    // first store the sourcemap file with a uuid in storage
    // then bulk insert all file entries in the db
    // finally if db entry fails, attempt to delete from storage
    for (minified, (smap, path)) in map_pairs {
        let mut file = archive
            .by_path(&path)
            .context(format!("path {path} missing unexpectedly in archive"))?;

        // TODO : add a restriction on size?
        let mut buf = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut buf)?;

        let id = config::ider::uuid();
        let storage_name = format!("{id}.js.map");
        let path = get_file_path(org_id, &storage_name);
        source_map_paths.push(path.clone());

        storage::put("", &path, buf.into()).await?;

        let sourcemap = SourceMap {
            id: 0,
            org: org_id.to_string(),
            service: service.clone(),
            env: env.clone(),
            version: version.clone(),
            source_file_name: minified,
            source_map_file_name: smap,
            file_store_id: storage_name,
            file_type: FileType::SourceMap,
            is_local: true,
            created_at: now,
        };
        source_maps.push(sourcemap);
    }

    if let Err(e) = sourcemaps::add_many(source_maps).await {
        log::error!("error saving sourcemaps in db for org_id {org_id} : {e}");
        let temp = source_map_paths.iter().map(|p| ("", p.as_str())).collect();
        if let Err(e) = storage::del(temp).await {
            log::warn!(
                "error deleting files from storage after sourcemap saving error for org_id {org_id} {e} "
            );
        }
        return Err(e);
    }

    Ok(())
}

// TODO: implement
pub async fn translate_stacktrace(
    org_id: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
    stacktrace: String,
) -> Result<String, anyhow::Error> {
    Ok(stacktrace)
}
