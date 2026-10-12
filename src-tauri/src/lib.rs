//! Desktop shell of OpenFlyover: the web app (../dist) in a native window, with the dialog and fs plugins used by
//! src/platform/desktop.ts, the oauth and opener plugins of the Strava connection (src/platform/oauthRedirect.ts), the
//! native video encoder (system ffmpeg) for webviews without WebCodecs (video.rs), batch rendering from the command
//! line (cli.rs), the project files the system opens with the app (opened.rs) and the load of the machine shown in
//! the status bar (system.rs).

mod cli;
mod opened;
mod system;
mod video;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_opener::init())
        .manage(video::VideoState::default())
        .manage(cli::CliState::default())
        .manage(opened::OpenedState::default())
        .manage(system::new_state())
        .setup(|app| {
            cli::setup(app.handle());
            opened::setup(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cli::cli_render,
            cli::cli_exit,
            opened::opened_files,
            system::system_stats,
            video::video_available,
            video::video_sound,
            video::video_open,
            video::video_frame,
            video::video_finish,
            video::video_cancel,
        ])
        .build(tauri::generate_context!())
        .expect("échec du lancement d'OpenFlyover")
        .run(|app, event| match event {
            // closed during an export: no ffmpeg left running, no partial film left on disk
            tauri::RunEvent::Exit => {
                if let Ok(mut videos) = app.state::<video::VideoState>().lock() {
                    videos.cancel_all();
                }
            }
            // macOS: a project opened from the Finder, at launch or while the app runs
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                opened::on_opened(app, urls.iter().filter_map(|url| url.to_file_path().ok()).collect());
            }
            _ => {}
        });
}
