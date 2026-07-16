use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    Device, FromSample, Sample, SampleFormat, SizedSample, StreamConfig, SupportedStreamConfig,
};
use serde::{Deserialize, Serialize};
use std::{
    f32::consts::PI,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

const STANDARD_CEILING_DBFS: f32 = -24.0;
const EXPERT_CEILING_DBFS: f32 = -12.0;
const START_LEVEL_DBFS: f32 = -48.0;
const FADE_MS: f32 = 50.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    id: String,
    name: String,
    channels: u16,
    sample_rate: Option<u32>,
    is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhaseChoice {
    InPhase,
    OutOfPhase,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StimulusDescriptor {
    CalibrationNoise {
        duration_ms: u64,
    },
    ChannelNoise {
        side: String,
        duration_ms: u64,
    },
    BandNoise {
        low_hz: f32,
        high_hz: f32,
        duration_ms: u64,
    },
    PolarityNoise {
        phase: PhaseChoice,
        duration_ms: u64,
    },
    SealSequence {
        loops: u32,
    },
    LogSweep {
        start_hz: f32,
        end_hz: f32,
        duration_ms: u64,
    },
    ToneSequence {
        frequencies_hz: Vec<f32>,
        tone_duration_ms: u64,
    },
}

impl StimulusDescriptor {
    fn duration_ms(&self) -> u64 {
        match self {
            Self::CalibrationNoise { duration_ms }
            | Self::ChannelNoise { duration_ms, .. }
            | Self::BandNoise { duration_ms, .. }
            | Self::PolarityNoise { duration_ms, .. }
            | Self::LogSweep { duration_ms, .. } => *duration_ms,
            Self::SealSequence { loops } => *loops as u64 * 4 * 800,
            Self::ToneSequence {
                frequencies_hz,
                tone_duration_ms,
            } => frequencies_hz.len() as u64 * (*tone_duration_ms + 150),
        }
    }

    fn frequency_at(&self, elapsed_ms: f32) -> Option<f32> {
        match self {
            Self::LogSweep {
                start_hz,
                end_hz,
                duration_ms,
            } => {
                let progress = (elapsed_ms / *duration_ms as f32).clamp(0.0, 1.0);
                Some(*start_hz * (*end_hz / *start_hz).powf(progress))
            }
            Self::ToneSequence {
                frequencies_hz,
                tone_duration_ms,
            } => {
                let step = (*tone_duration_ms + 150) as usize;
                frequencies_hz.get(elapsed_ms as usize / step).copied()
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackProgress {
    playback_id: String,
    state: String,
    elapsed_ms: u64,
    duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    frequency_hz: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Clone)]
struct PreparedOutput {
    device_id: String,
}

struct GainPolicy {
    level_dbfs: f32,
    expert: bool,
    confirmed: bool,
}

struct PlaybackControl {
    stopped: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
}

pub struct AudioEngine {
    prepared: Mutex<Option<PreparedOutput>>,
    gain: Mutex<GainPolicy>,
    gain_bits: Arc<AtomicU32>,
    playback: Mutex<Option<PlaybackControl>>,
}

impl Default for AudioEngine {
    fn default() -> Self {
        Self {
            prepared: Mutex::new(None),
            gain: Mutex::new(GainPolicy {
                level_dbfs: START_LEVEL_DBFS,
                expert: false,
                confirmed: false,
            }),
            gain_bits: Arc::new(AtomicU32::new(START_LEVEL_DBFS.to_bits())),
            playback: Mutex::new(None),
        }
    }
}

impl AudioEngine {
    fn stop(&self) {
        if let Some(control) = self.playback.lock().expect("playback lock").take() {
            control.stopped.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command]
pub fn list_output_devices() -> Result<Vec<OutputDevice>, String> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|device| device.name().ok());
    let devices = host.output_devices().map_err(|error| error.to_string())?;
    Ok(devices
        .enumerate()
        .map(|(index, device)| {
            let name = device
                .name()
                .unwrap_or_else(|_| format!("输出设备 {}", index + 1));
            let config = device.default_output_config().ok();
            OutputDevice {
                id: format!("output-{index}"),
                name: name.clone(),
                channels: config.as_ref().map(|value| value.channels()).unwrap_or(0),
                sample_rate: config.as_ref().map(|value| value.sample_rate().0),
                is_default: default_name.as_ref() == Some(&name),
            }
        })
        .collect())
}

#[tauri::command]
pub fn prepare_output(
    device_id: String,
    expert_mode: bool,
    state: tauri::State<'_, AudioEngine>,
) -> Result<(), String> {
    state.stop();
    let device = find_device(&device_id)?;
    let config = choose_config(&device)?;
    if config.channels() < 2 {
        return Err("该输出设备没有可用的立体声配置".into());
    }
    *state.prepared.lock().map_err(|_| "音频状态不可用")? = Some(PreparedOutput { device_id });
    *state.gain.lock().map_err(|_| "音量状态不可用")? = GainPolicy {
        level_dbfs: START_LEVEL_DBFS,
        expert: expert_mode,
        confirmed: false,
    };
    state
        .gain_bits
        .store(START_LEVEL_DBFS.to_bits(), Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn set_session_gain(
    level_dbfs: f32,
    state: tauri::State<'_, AudioEngine>,
) -> Result<f32, String> {
    let mut policy = state.gain.lock().map_err(|_| "音量状态不可用")?;
    let ceiling = if policy.expert {
        EXPERT_CEILING_DBFS
    } else {
        STANDARD_CEILING_DBFS
    };
    let requested = level_dbfs.clamp(START_LEVEL_DBFS, ceiling);
    if policy.confirmed && !policy.expert && requested > policy.level_dbfs {
        return Err("标准模式确认后只能降低音量；如需提高，请重新进行安全确认".into());
    }
    policy.level_dbfs = requested;
    state.gain_bits.store(requested.to_bits(), Ordering::SeqCst);
    Ok(requested)
}

#[tauri::command]
pub fn confirm_session_gain(state: tauri::State<'_, AudioEngine>) -> Result<(), String> {
    state.gain.lock().map_err(|_| "音量状态不可用")?.confirmed = true;
    Ok(())
}

#[tauri::command]
pub fn play_stimulus(
    stimulus: StimulusDescriptor,
    app: AppHandle,
    state: tauri::State<'_, AudioEngine>,
) -> Result<String, String> {
    state.stop();
    let prepared = state
        .prepared
        .lock()
        .map_err(|_| "音频状态不可用")?
        .clone()
        .ok_or("请先选择并准备输出设备")?;
    let device = find_device(&prepared.device_id)?;
    let supported = choose_config(&device)?;
    let sample_format = supported.sample_format();
    let config: StreamConfig = supported.into();
    let playback_id = uuid::Uuid::new_v4().to_string();
    let stopped = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let cursor = Arc::new(AtomicU64::new(0));
    let failed = Arc::new(AtomicBool::new(false));
    *state.playback.lock().map_err(|_| "音频状态不可用")? = Some(PlaybackControl {
        stopped: stopped.clone(),
        paused: paused.clone(),
    });
    let gain_bits = state.gain_bits.clone();
    let thread_id = playback_id.clone();
    thread::spawn(move || {
        let duration_ms = stimulus.duration_ms();
        let duration_samples = duration_ms * config.sample_rate.0 as u64 / 1000;
        let stream_result = match sample_format {
            SampleFormat::F32 => build_stream::<f32>(
                &device,
                &config,
                stimulus.clone(),
                cursor.clone(),
                stopped.clone(),
                paused.clone(),
                failed.clone(),
                gain_bits.clone(),
            ),
            SampleFormat::I16 => build_stream::<i16>(
                &device,
                &config,
                stimulus.clone(),
                cursor.clone(),
                stopped.clone(),
                paused.clone(),
                failed.clone(),
                gain_bits.clone(),
            ),
            SampleFormat::U16 => build_stream::<u16>(
                &device,
                &config,
                stimulus.clone(),
                cursor.clone(),
                stopped.clone(),
                paused.clone(),
                failed.clone(),
                gain_bits.clone(),
            ),
            other => Err(format!("暂不支持音频样本格式 {other:?}")),
        };
        let Ok(stream) = stream_result else {
            let _ = app.emit(
                "playback-progress",
                PlaybackProgress {
                    playback_id: thread_id,
                    state: "error".into(),
                    elapsed_ms: 0,
                    duration_ms,
                    frequency_hz: None,
                    message: stream_result.err(),
                },
            );
            return;
        };
        if let Err(error) = stream.play() {
            let _ = app.emit(
                "playback-progress",
                PlaybackProgress {
                    playback_id: thread_id,
                    state: "error".into(),
                    elapsed_ms: 0,
                    duration_ms,
                    frequency_hz: None,
                    message: Some(error.to_string()),
                },
            );
            return;
        }
        loop {
            let current = cursor.load(Ordering::SeqCst);
            let elapsed_ms = current.saturating_mul(1000) / config.sample_rate.0 as u64;
            let is_complete = current >= duration_samples;
            let is_stopped = stopped.load(Ordering::SeqCst);
            let is_failed = failed.load(Ordering::SeqCst);
            let state_name = if is_failed {
                "error"
            } else if is_complete {
                "completed"
            } else if is_stopped {
                "stopped"
            } else if paused.load(Ordering::SeqCst) {
                "paused"
            } else {
                "playing"
            };
            let _ = app.emit(
                "playback-progress",
                PlaybackProgress {
                    playback_id: thread_id.clone(),
                    state: state_name.into(),
                    elapsed_ms: elapsed_ms.min(duration_ms),
                    duration_ms,
                    frequency_hz: stimulus.frequency_at(elapsed_ms as f32),
                    message: if is_failed {
                        Some("输出设备已中断".into())
                    } else {
                        None
                    },
                },
            );
            if is_complete || is_stopped || is_failed {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        drop(stream);
    });
    Ok(playback_id)
}

#[tauri::command]
pub fn pause_playback(state: tauri::State<'_, AudioEngine>) -> Result<(), String> {
    if let Some(control) = state
        .playback
        .lock()
        .map_err(|_| "音频状态不可用")?
        .as_ref()
    {
        control.paused.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn resume_playback(state: tauri::State<'_, AudioEngine>) -> Result<(), String> {
    if let Some(control) = state
        .playback
        .lock()
        .map_err(|_| "音频状态不可用")?
        .as_ref()
    {
        control.paused.store(false, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn stop_all(state: tauri::State<'_, AudioEngine>) -> Result<(), String> {
    state.stop();
    Ok(())
}

fn find_device(device_id: &str) -> Result<Device, String> {
    let index = device_id
        .strip_prefix("output-")
        .ok_or("输出设备标识无效")?
        .parse::<usize>()
        .map_err(|_| "输出设备标识无效")?;
    cpal::default_host()
        .output_devices()
        .map_err(|error| error.to_string())?
        .nth(index)
        .ok_or_else(|| "输出设备已断开，请重新选择".into())
}

fn choose_config(device: &Device) -> Result<SupportedStreamConfig, String> {
    let ranges = device
        .supported_output_configs()
        .map_err(|error| error.to_string())?;
    for range in ranges {
        if range.channels() >= 2
            && range.min_sample_rate().0 <= 48_000
            && range.max_sample_rate().0 >= 48_000
        {
            return Ok(range.with_sample_rate(cpal::SampleRate(48_000)));
        }
    }
    let fallback = device
        .default_output_config()
        .map_err(|error| error.to_string())?;
    if fallback.channels() < 2 {
        Err("该设备仅提供单声道输出".into())
    } else {
        Ok(fallback)
    }
}

fn build_stream<T>(
    device: &Device,
    config: &StreamConfig,
    stimulus: StimulusDescriptor,
    cursor: Arc<AtomicU64>,
    stopped: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
    gain_bits: Arc<AtomicU32>,
) -> Result<cpal::Stream, String>
where
    T: Sample + SizedSample + FromSample<f32>,
{
    let channels = config.channels as usize;
    let sample_rate = config.sample_rate.0 as f32;
    let total_samples = stimulus.duration_ms() * config.sample_rate.0 as u64 / 1000;
    let error_failed = failed.clone();
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                for frame in data.chunks_mut(channels) {
                    if stopped.load(Ordering::SeqCst) || paused.load(Ordering::SeqCst) {
                        for sample in frame {
                            *sample = T::from_sample(0.0);
                        }
                        continue;
                    }
                    let sample_index = cursor.load(Ordering::Relaxed);
                    if sample_index >= total_samples {
                        for sample in frame {
                            *sample = T::from_sample(0.0);
                        }
                        continue;
                    }
                    let (left, right) =
                        render_sample(&stimulus, sample_index, total_samples, sample_rate);
                    let gain =
                        10.0_f32.powf(f32::from_bits(gain_bits.load(Ordering::Relaxed)) / 20.0);
                    for (index, sample) in frame.iter_mut().enumerate() {
                        let value = if index == 0 {
                            left * gain
                        } else if index == 1 {
                            right * gain
                        } else {
                            0.0
                        };
                        *sample = T::from_sample(value.clamp(-1.0, 1.0));
                    }
                    cursor.fetch_add(1, Ordering::Relaxed);
                }
            },
            move |_| {
                error_failed.store(true, Ordering::SeqCst);
            },
            None,
        )
        .map_err(|error| error.to_string())
}

fn render_sample(
    stimulus: &StimulusDescriptor,
    index: u64,
    total: u64,
    sample_rate: f32,
) -> (f32, f32) {
    let time = index as f32 / sample_rate;
    let fade_samples = (FADE_MS / 1000.0 * sample_rate) as u64;
    let envelope = ((index as f32 / fade_samples.max(1) as f32).min(1.0)
        * ((total - index).max(1) as f32 / fade_samples.max(1) as f32).min(1.0))
    .clamp(0.0, 1.0);
    let (left, right) = match stimulus {
        StimulusDescriptor::CalibrationNoise { .. } => {
            let value = dense_tone(time, 180.0, 4_000.0);
            (value, value)
        }
        StimulusDescriptor::ChannelNoise { side, .. } => {
            let value = dense_tone(time, 500.0, 2_500.0);
            if side == "left" {
                (value, 0.0)
            } else {
                (0.0, value)
            }
        }
        StimulusDescriptor::BandNoise {
            low_hz, high_hz, ..
        } => {
            let value = dense_tone(time, *low_hz, *high_hz);
            (value, value)
        }
        StimulusDescriptor::PolarityNoise { phase, .. } => {
            let value = dense_tone(time, 300.0, 3_000.0);
            (
                value,
                if matches!(phase, PhaseChoice::OutOfPhase) {
                    -value
                } else {
                    value
                },
            )
        }
        StimulusDescriptor::SealSequence { .. } => {
            let step_samples = (0.8 * sample_rate) as u64;
            let position = index % (4 * step_samples);
            let step = (position / step_samples) as usize;
            let local = position % step_samples;
            let frequencies = [40.0, 60.0, 80.0, 200.0];
            if local as f32 / sample_rate > 0.7 {
                (0.0, 0.0)
            } else {
                let value = (2.0 * PI * frequencies[step] * time).sin();
                (value, value)
            }
        }
        StimulusDescriptor::LogSweep {
            start_hz,
            end_hz,
            duration_ms,
        } => {
            let duration = *duration_ms as f32 / 1000.0;
            let ratio = *end_hz / *start_hz;
            let phase =
                2.0 * PI * *start_hz * duration / ratio.ln() * (ratio.powf(time / duration) - 1.0);
            let value = phase.sin();
            (value, value)
        }
        StimulusDescriptor::ToneSequence {
            frequencies_hz,
            tone_duration_ms,
        } => {
            let step_ms = *tone_duration_ms + 150;
            let elapsed_ms = time * 1000.0;
            let step = (elapsed_ms / step_ms as f32) as usize;
            let local_ms = elapsed_ms % step_ms as f32;
            if local_ms > *tone_duration_ms as f32 {
                (0.0, 0.0)
            } else if let Some(frequency) = frequencies_hz.get(step) {
                let value = (2.0 * PI * frequency * time).sin();
                (value, value)
            } else {
                (0.0, 0.0)
            }
        }
    };
    (left * envelope, right * envelope)
}

fn dense_tone(time: f32, low_hz: f32, high_hz: f32) -> f32 {
    const COUNT: usize = 12;
    let mut sum = 0.0;
    for index in 0..COUNT {
        let progress = index as f32 / (COUNT - 1) as f32;
        let frequency = low_hz * (high_hz / low_hz).powf(progress);
        let phase = index as f32 * 1.618_034;
        sum += (2.0 * PI * frequency * time + phase).sin() / COUNT as f32;
    }
    (sum * 2.4).clamp(-1.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_signal_is_isolated() {
        let descriptor = StimulusDescriptor::ChannelNoise {
            side: "left".into(),
            duration_ms: 1_200,
        };
        let (left, right) = render_sample(&descriptor, 12_000, 57_600, 48_000.0);
        assert_ne!(left, 0.0);
        assert_eq!(right, 0.0);
    }

    #[test]
    fn polarity_inverts_right_channel() {
        let descriptor = StimulusDescriptor::PolarityNoise {
            phase: PhaseChoice::OutOfPhase,
            duration_ms: 2_000,
        };
        let (left, right) = render_sample(&descriptor, 20_000, 96_000, 48_000.0);
        assert!((left + right).abs() < 1e-6);
    }

    #[test]
    fn sweep_reaches_endpoints() {
        let descriptor = StimulusDescriptor::LogSweep {
            start_hz: 20.0,
            end_hz: 16_000.0,
            duration_ms: 40_000,
        };
        assert_eq!(descriptor.frequency_at(0.0), Some(20.0));
        assert!((descriptor.frequency_at(40_000.0).unwrap() - 16_000.0).abs() < 0.01);
    }

    #[test]
    fn envelope_starts_silent_and_never_clips() {
        let descriptor = StimulusDescriptor::CalibrationNoise { duration_ms: 2_000 };
        assert_eq!(render_sample(&descriptor, 0, 96_000, 48_000.0), (0.0, 0.0));
        for index in (0..96_000).step_by(997) {
            let (left, right) = render_sample(&descriptor, index, 96_000, 48_000.0);
            assert!(left.abs() <= 1.0 && right.abs() <= 1.0);
        }
    }
}
