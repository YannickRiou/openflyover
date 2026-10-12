//! Project files handed to the app by the system: a double-click on a `.opnflvr` file or « Ouvrir avec… » (Windows and
//! Linux start the app with the path as an argument, macOS sends an open event, also while the app runs). Each path is
//! added to the fs scope (the frontend may then read it and write it again in place) and queued; the frontend takes the
//! queue with `opened_files` at start-up and each time `EVENT` says there is more (src/platform/openedFiles.ts).
//! Nothing here touches the arguments of the batch rendering (cli.rs): only paths with a project extension count.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_fs::FsExt;

/// Emitted to the frontend when paths were queued while the app was running.
#[cfg(target_os = "macos")]
pub const EVENT: &str = "openflyover://opened-files";

/// Paths waiting for the frontend, in the order the system gave them.
pub type OpenedState = Mutex<Vec<PathBuf>>;

/// Extensions of the files opened as projects: the project format, and the older plain JSON projects.
const PROJECT_EXTENSIONS: [&str; 2] = ["opnflvr", "json"];

/// Options of cli.rs that are followed by a value (a folder, a name…), which is not a file to open.
const OPTIONS_WITH_VALUE: [&str; 4] = ["--rendu", "--sortie", "--prereglage", "--formats"];

/// `path` ends with a project extension, whatever its case.
pub fn is_project_path(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| PROJECT_EXTENSIONS.iter().any(|p| e.eq_ignore_ascii_case(p)))
}

/// The project files among the command-line arguments (without the program name): no option, no value of an option.
pub fn project_paths(args: &[String]) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        if OPTIONS_WITH_VALUE.contains(&arg.as_str()) {
            it.next();
        } else if !arg.starts_with('-') && is_project_path(Path::new(arg)) {
            paths.push(PathBuf::from(arg));
        }
    }
    paths
}

/// Allow the project files among `paths` in the fs scope and queue them; true when at least one was queued.
fn queue(app: &AppHandle, paths: Vec<PathBuf>) -> bool {
    let scope = app.fs_scope();
    let accepted: Vec<PathBuf> = paths
        .into_iter()
        .filter(|path| is_project_path(path))
        .map(|path| crate::cli::absolute(&path).unwrap_or(path))
        .filter(|path| match scope.allow_file(path) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("Fichier non autorisé ({}) : {e}", path.display());
                false
            }
        })
        .collect();
    if accepted.is_empty() {
        return false;
    }
    app.state::<OpenedState>().lock().unwrap_or_else(|e| e.into_inner()).extend(accepted);
    true
}

/// Reads the command line once at startup: the project files it names are queued for the frontend.
pub fn setup(app: &AppHandle) {
    let args: Vec<String> = std::env::args().skip(1).collect();
    queue(app, project_paths(&args));
}

/// macOS: the system asks the app to open `paths`, at launch or while it runs; the frontend is told to take them.
#[cfg(target_os = "macos")]
pub fn on_opened(app: &AppHandle, paths: Vec<PathBuf>) {
    use tauri::Emitter;
    if queue(app, paths) {
        if let Err(e) = app.emit(EVENT, ()) {
            eprintln!("Ouverture de fichier non transmise : {e}");
        }
    }
}

/// The queued paths as text, the queue emptied (a path that is not valid text cannot reach the webview and is dropped).
fn drain(state: &OpenedState) -> Vec<String> {
    let paths = std::mem::take(&mut *state.lock().unwrap_or_else(|e| e.into_inner()));
    paths.into_iter().filter_map(|p| p.into_os_string().into_string().ok()).collect()
}

/// The files the system asked the app to open since the last call: each is handed over once.
#[tauri::command]
pub fn opened_files(state: State<'_, OpenedState>) -> Vec<String> {
    drain(&state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn recognizes_project_files_whatever_their_case() {
        assert!(is_project_path(Path::new("/home/a/Tour.opnflvr")));
        assert!(is_project_path(Path::new(r"C:\Projets\Tour.OPNFLVR")));
        assert!(is_project_path(Path::new("ancien.openflyover.json")));
        assert!(!is_project_path(Path::new("trace.gpx")));
        assert!(!is_project_path(Path::new("opnflvr")));
        assert!(!is_project_path(Path::new("dossier.opnflvr.bak")));
        assert!(!is_project_path(Path::new("")));
    }

    #[test]
    fn takes_the_project_files_of_the_arguments_in_order() {
        let found = project_paths(&args(&["a.opnflvr", "trace.gpx", "/x/b.JSON", "-psn_0_123"]));
        assert_eq!(found, vec![PathBuf::from("a.opnflvr"), PathBuf::from("/x/b.JSON")]);
        assert!(project_paths(&args(&[])).is_empty());
        assert!(project_paths(&args(&["trace.gpx"])).is_empty());
    }

    #[test]
    fn keeps_paths_with_spaces_and_accents_whole() {
        let found = project_paths(&args(&[r"C:\Mes projets\Étape 1 – Mont-Blanc.opnflvr"]));
        assert_eq!(found, vec![PathBuf::from(r"C:\Mes projets\Étape 1 – Mont-Blanc.opnflvr")]);
    }

    #[test]
    fn ignores_options_and_the_values_of_the_batch_rendering() {
        let found = project_paths(&args(&["--rendu", "traces.json", "--sortie", "films.opnflvr", "--prereglage", "x.json", "--formats", "16:9@1080p", "--vite.opnflvr", "Tour.opnflvr"]));
        assert_eq!(found, vec![PathBuf::from("Tour.opnflvr")]);
    }

    #[test]
    fn the_rendering_arguments_still_parse_with_a_project_file_beside_them() {
        let all = args(&["Tour.opnflvr", "--rendu", "traces"]);
        assert!(crate::cli::parse_cli(&all).unwrap().is_some());
        assert_eq!(crate::cli::parse_cli(&args(&["Tour.opnflvr"])), Ok(None));
    }

    #[test]
    fn hands_the_queue_over_once() {
        let state: OpenedState = Mutex::new(vec![PathBuf::from("a.opnflvr"), PathBuf::from("b.opnflvr")]);
        assert_eq!(drain(&state), vec!["a.opnflvr".to_string(), "b.opnflvr".to_string()]);
        assert!(drain(&state).is_empty());
    }
}
