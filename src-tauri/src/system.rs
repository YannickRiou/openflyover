//! Load of the machine for the status bar of the desktop app (src/ui/StatusBar.tsx, « Performances »): memory in use
//! and processor activity, which a webview cannot read. One `System` is kept between calls: the processor usage is
//! the activity since the previous reading (the first one says 0).

use std::sync::Mutex;

use serde::Serialize;
use sysinfo::System;
use tauri::State;

pub type SystemState = Mutex<System>;

pub fn new_state() -> SystemState {
    Mutex::new(System::new())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    used_memory_bytes: u64,
    total_memory_bytes: u64,
    /// every core averaged, 0 to 100
    cpu_percent: f32,
}

fn read(system: &mut System) -> SystemStats {
    system.refresh_memory();
    system.refresh_cpu_usage();
    SystemStats {
        used_memory_bytes: system.used_memory(),
        total_memory_bytes: system.total_memory(),
        cpu_percent: system.global_cpu_usage().clamp(0.0, 100.0),
    }
}

#[tauri::command]
pub fn system_stats(state: State<'_, SystemState>) -> Result<SystemStats, String> {
    let mut system = state.lock().map_err(|_| "état du système illisible".to_string())?;
    Ok(read(&mut system))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_memory_and_processor() {
        let mut system = System::new();
        read(&mut system);
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        let stats = read(&mut system);
        assert!(stats.total_memory_bytes > 0);
        assert!(stats.used_memory_bytes <= stats.total_memory_bytes);
        assert!((0.0..=100.0).contains(&stats.cpu_percent));
    }
}
