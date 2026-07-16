use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("store.json"))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("tmp");
    let previous = path.with_extension("previous.json");
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    if path.exists() {
        if previous.exists() {
            fs::remove_file(&previous).map_err(|error| error.to_string())?;
        }
        fs::rename(path, &previous).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if previous.exists() {
            let _ = fs::rename(&previous, path);
        }
        return Err(error.to_string());
    }
    if previous.exists() {
        let _ = fs::remove_file(previous);
    }
    Ok(())
}

#[tauri::command]
pub fn load_store(app: AppHandle) -> Result<Option<Value>, String> {
    let path = store_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|error| format!("本地数据无法解析：{error}"))
}

#[tauri::command]
pub fn save_store(app: AppHandle, payload: Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?;
    atomic_write(&store_path(&app)?, &bytes)
}

#[tauri::command]
pub fn export_backup(payload: Value) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .add_filter("HiFi Box JSON", &["json"])
        .set_file_name("hifi-box-backup.json")
        .save_file();
    let Some(path) = path else {
        return Ok(None);
    };
    let bytes = serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?;
    atomic_write(&path, &bytes)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn choose_backup() -> Result<Option<Value>, String> {
    let path = rfd::FileDialog::new()
        .add_filter("HiFi Box JSON", &["json"])
        .pick_file();
    let Some(path) = path else {
        return Ok(None);
    };
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|error| format!("备份文件无法解析：{error}"))
}

#[tauri::command]
pub fn restore_store(app: AppHandle, payload: Value) -> Result<(), String> {
    let current = store_path(&app)?;
    if current.exists() {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs();
        fs::copy(
            &current,
            data_dir(&app)?.join(format!("pre-restore-{timestamp}.json")),
        )
        .map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?;
    atomic_write(&current, &bytes)
}

#[tauri::command]
pub fn clear_store(app: AppHandle) -> Result<(), String> {
    let path = store_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}
