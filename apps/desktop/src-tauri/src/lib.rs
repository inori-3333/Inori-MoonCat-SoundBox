mod audio;
mod storage;

use audio::AudioEngine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AudioEngine::default())
        .invoke_handler(tauri::generate_handler![
            audio::list_output_devices,
            audio::prepare_output,
            audio::set_session_gain,
            audio::confirm_session_gain,
            audio::play_stimulus,
            audio::pause_playback,
            audio::resume_playback,
            audio::stop_all,
            storage::load_store,
            storage::save_store,
            storage::export_backup,
            storage::choose_backup,
            storage::restore_store,
            storage::clear_store,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HiFi Box");
}
