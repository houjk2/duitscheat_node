#!/usr/bin/env node
/**
 * ============================================================
 *   German → Dutch Background Audio Interpreter  (Node.js)
 * ============================================================
 *
 * Usage:
 *   node interpreter.js                  — auto-detect loopback
 *   node interpreter.js --device 1       — force device index
 *   node interpreter.js --list           — list audio devices
 *   node interpreter.js --threshold 0.02 — adjust sensitivity
 *   node interpreter.js --model small    — whisper model size
 *
 * All output goes to the terminal AND interpreter.log
 * ============================================================
 */

'use strict';

const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const https     = require('https');
const http      = require('http');
const { spawn } = require('child_process');

// ─── CLI args (no extra dep needed) ──────────────────────────────────────────
const args = {};
process.argv.slice(2).forEach((v, i, arr) => {
  if (v.startsWith('--')) {
    const key = v.slice(2);
    const next = arr[i + 1];
    args[key] = (!next || next.startsWith('--')) ? true : next;
  }
});

const DEVICE_ARG  = args.device    != null ? parseInt(args.device) : null;
const LIST_MODE   = args.list      === true;
const THRESHOLD   = parseFloat(args.threshold ?? '0.012');
const MODEL_SIZE  = args.model ?? 'medium';  // tiny / base / small / medium

// ─── Logger ───────────────────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, 'interpreter.log');
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function logLine(level, msg) {
  const ts  = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const line = `${ts} [${level.toUpperCase()}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

const log = {
  info:  (m) => logLine('INFO',    m),
  warn:  (m) => logLine('WARNING', m),
  error: (m) => logLine('ERROR',   m),
  debug: (m) => logLine('DEBUG',   m),
};

// ─── Constants ────────────────────────────────────────────────────────────────
const WHISPER_RATE         = 16_000;
const CHANNELS             = 1;
const MIN_SPEECH_SEC       = 0.6;
const MAX_SPEECH_SEC       = 45;
const SILENCE_TO_FLUSH_SEC = 1.5;

const WHISPER_MODEL_MAP = {
  tiny:   'Xenova/whisper-tiny',
  base:   'Xenova/whisper-base',
  small:  'Xenova/whisper-small',
  medium: 'Xenova/whisper-medium',
};
const WHISPER_MODEL_ID = WHISPER_MODEL_MAP[MODEL_SIZE] ?? WHISPER_MODEL_MAP.medium;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Linear-interpolation resample Float32Array src_rate → dst_rate */
function resample(samples, srcRate, dstRate) {
  if (srcRate === dstRate) return samples;
  const ratio     = srcRate / dstRate;
  const outLen    = Math.floor(samples.length / ratio);
  const out       = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos  = i * ratio;
    const idx  = Math.floor(pos);
    const frac = pos - idx;
    const a    = samples[idx]     ?? 0;
    const b    = samples[idx + 1] ?? 0;
    out[i]     = a + frac * (b - a);
  }
  return out;
}

/** Convert Float32Array → 16-bit PCM Buffer */
function float32ToInt16Buffer(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return buf;
}

/** Write a minimal WAV file header + PCM data */
function writeWav(filePath, pcmBuf, sampleRate) {
  const numChannels  = 1;
  const bitsPerSamp  = 16;
  const byteRate     = sampleRate * numChannels * (bitsPerSamp / 8);
  const blockAlign   = numChannels * (bitsPerSamp / 8);
  const dataLen      = pcmBuf.length;
  const header       = Buffer.alloc(44);

  header.write('RIFF',           0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE',           8);
  header.write('fmt ',          12);
  header.writeUInt32LE(16,      16);  // PCM chunk size
  header.writeUInt16LE(1,       20);  // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate,  24);
  header.writeUInt32LE(byteRate,    28);
  header.writeUInt16LE(blockAlign,  32);
  header.writeUInt16LE(bitsPerSamp, 34);
  header.write('data',          36);
  header.writeUInt32LE(dataLen, 40);

  fs.writeFileSync(filePath, Buffer.concat([header, pcmBuf]));
}

// ─── Device helpers ──────────────────────────────────────────────────────────
function getDevices() {
  const pa = require('naudiodon');
  return pa.getDevices();
}

function listDevices() {
  const devices = getDevices();
  console.log('\n IDX  SAMPLERATE    TYPE        NAME');
  console.log('─'.repeat(72));
  for (const d of devices) {
    if (d.maxInputChannels < 1) continue;
    const kw = ['monitor','loopback','stereo mix','what u hear',
                'wave out','blackhole','soundflower','cable'];
    const tag = kw.some(k => d.name.toLowerCase().includes(k)) ? 'LOOPBACK' : 'input';
    console.log(
      `  ${String(d.id).padStart(2)}  ${String(d.defaultSampleRate).padEnd(10)} Hz  ${tag.padEnd(10)}  ${d.name}`
    );
  }
  console.log();
}

function findLoopbackDevice(forced) {
  if (forced != null) return forced;

  const devices = getDevices();
  const kw = ['monitor','loopback','stereo mix','what u hear',
               'wave out mix','blackhole','soundflower','cable'];
  for (const d of devices) {
    if (d.maxInputChannels < 1) continue;
    if (kw.some(k => d.name.toLowerCase().includes(k))) {
      log.info(`Auto-selected loopback device [${d.id}]: ${d.name}`);
      return d.id;
    }
  }

  const env = process.env.INTERP_DEVICE;
  if (env != null) {
    const idx = parseInt(env);
    if (!isNaN(idx)) return idx;
  }

  log.warn('━'.repeat(60));
  log.warn('  No loopback device found — using OS default input.');
  log.warn('  Run:  node interpreter.js --list   to see all devices');
  log.warn('  Then: node interpreter.js --device INDEX');
  log.warn('  Windows: enable Stereo Mix in Recording settings');
  log.warn('  macOS:   brew install blackhole-2ch');
  log.warn('━'.repeat(60));
  return -1;  // -1 = portaudio default
}

function getDeviceSampleRate(deviceId) {
  const devices = getDevices();
  if (deviceId == null || deviceId === -1) {
    // default device
    const def = devices.find(d => d.maxInputChannels > 0);
    return def ? def.defaultSampleRate : 44100;
  }
  const d = devices.find(d => d.id === deviceId);
  return d ? d.defaultSampleRate : 44100;
}

// ─── Audio Capture ────────────────────────────────────────────────────────────
class AudioCapture {
  constructor(deviceId, threshold) {
    this.deviceId        = deviceId;
    this.threshold       = threshold;
    this.captureRate     = 44100;
    this.onSegment       = null;    // callback(Float32Array)

    this._recording      = false;
    this._speechBuf      = [];      // float samples at captureRate
    this._silenceSec     = 0;
    this._stream         = null;
    this._framesTotal    = 0;
    this._levelLogTimer  = 0;
  }

  start() {
    const pa = require('naudiodon');

    this.captureRate = getDeviceSampleRate(this.deviceId);
    const devInfo    = getDevices().find(d => d.id === this.deviceId);
    const devName    = devInfo ? devInfo.name : 'default';

    log.info(`Opening device [${this.deviceId}] "${devName}" @ ${this.captureRate} Hz`);

    this._stream = new pa.AudioIO({
      inOptions: {
        channelCount : CHANNELS,
        sampleFormat : pa.SampleFormat32Bit,
        sampleRate   : this.captureRate,
        deviceId     : this.deviceId ?? -1,
        closeOnError : false,
      },
    });

    this._stream.on('data', (buf) => this._handleChunk(buf));
    this._stream.on('error', (err) => log.error(`Audio stream error: ${err.message}`));
    this._stream.start();

    log.info(`Audio capture started. Threshold: ${this.threshold}`);
  }

  stop() {
    if (this._stream) {
      try { this._stream.quit(); } catch (_) {}
      log.info('Audio capture stopped.');
    }
  }

  _handleChunk(buf) {
    // naudiodon SampleFormat32Bit → Float32Array
    const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    const level   = rms(samples);

    // Level meter every 3 s
    this._framesTotal += samples.length;
    const elapsed = this._framesTotal / this.captureRate;
    if (elapsed - this._levelLogTimer >= 3) {
      this._levelLogTimer = elapsed;
      const bar   = '█'.repeat(Math.min(40, Math.floor(level * 800)));
      const label = this._recording ? 'SPEECH' : 'silence';
      log.info(`Level: ${level.toFixed(4)}  |${bar.padEnd(40)}|  [${label}]`);
    }

    if (level > this.threshold) {
      this._silenceSec = 0;
      if (!this._recording) {
        this._recording = true;
        this._speechBuf = [];
        log.info(`▶ Speech detected (RMS=${level.toFixed(4)}) — recording …`);
      }
      for (let i = 0; i < samples.length; i++) this._speechBuf.push(samples[i]);

    } else {
      if (this._recording) {
        this._silenceSec += samples.length / this.captureRate;
        for (let i = 0; i < samples.length; i++) this._speechBuf.push(samples[i]);
        if (this._silenceSec >= SILENCE_TO_FLUSH_SEC) {
          this._flush('silence');
        }
      }
    }

    if (this._recording && this._speechBuf.length / this.captureRate >= MAX_SPEECH_SEC) {
      this._flush('max-duration');
    }
  }

  _flush(reason) {
    const duration = this._speechBuf.length / this.captureRate;
    if (duration >= MIN_SPEECH_SEC) {
      log.info(`■ Segment ready (${reason}, ${duration.toFixed(1)}s) — sending to pipeline`);
      const segment = new Float32Array(this._speechBuf);
      if (this.onSegment) this.onSegment(segment);
    } else {
      log.debug(`  Segment discarded (${reason}, ${duration.toFixed(2)}s < min)`);
    }
    this._recording  = false;
    this._speechBuf  = [];
    this._silenceSec = 0;
  }
}

// ─── STT: Whisper via @xenova/transformers ────────────────────────────────────
let whisperPipeline = null;

async function loadWhisper() {
  log.info(`Loading Whisper '${MODEL_SIZE}' (${WHISPER_MODEL_ID}) …`);
  log.info('  First run downloads the ONNX model — please wait.');
  const { pipeline, env } = require('@xenova/transformers');
  env.allowLocalModels = true;
  whisperPipeline = await pipeline('automatic-speech-recognition', WHISPER_MODEL_ID, {
    quantized: true,
  });
  log.info('Whisper ready ✔');
}

async function transcribe(rawSamples, captureRate) {
  // Resample to 16 kHz
  const samples16k = resample(rawSamples, captureRate, WHISPER_RATE);

  const result = await whisperPipeline(samples16k, {
    language   : 'german',
    task       : 'transcribe',
    chunk_length_s : 30,
    stride_length_s: 5,
  });

  const text = (result.text ?? '').trim();
  log.info(`STT [DE]: ${JSON.stringify(text)}`);
  return text;
}

// ─── Translation: Google Translate ───────────────────────────────────────────
async function translateDeNl(text) {
  if (!text) return '';
  const { translate } = require('@vitalets/google-translate-api');
  const res    = await translate(text, { from: 'de', to: 'nl' });
  const nlText = res.text ?? '';
  log.info(`TRANS [NL]: ${JSON.stringify(nlText)}`);
  return nlText;
}

// ─── TTS: Google TTS → MP3 → ffplay ─────────────────────────────────────────
function downloadTTS(text, lang, destPath) {
  return new Promise((resolve, reject) => {
    // Same endpoint gTTS uses
    const encoded = encodeURIComponent(text);
    const url     = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${lang}&client=tw-ob&ttsspeed=0.9`;
    const file    = fs.createWriteStream(destPath);

    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`TTS HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', reject);
  });
}

function playAudio(filePath) {
  return new Promise((resolve, reject) => {
    // Use ffplay (included with ffmpeg which user already has)
    const player = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath]);
    player.on('close', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`ffplay exited with code ${code}`));
    });
    player.on('error', (err) => {
      // ffplay not found — try system fallback
      log.warn(`ffplay failed: ${err.message} — trying system fallback`);
      playFallback(filePath).then(resolve).catch(reject);
    });
  });
}

function playFallback(filePath) {
  return new Promise((resolve, reject) => {
    let cmd, cmdArgs;
    if (process.platform === 'win32') {
      // Windows Media Player via PowerShell
      cmd     = 'powershell';
      cmdArgs = ['-c', `(New-Object Media.SoundPlayer).PlaySync() # nop; Start-Process -Wait "${filePath}"`];
    } else if (process.platform === 'darwin') {
      cmd = 'afplay'; cmdArgs = [filePath];
    } else {
      cmd = 'aplay'; cmdArgs = [filePath];
    }
    const p = spawn(cmd, cmdArgs);
    p.on('close', resolve);
    p.on('error', reject);
  });
}

async function speak(nlText) {
  if (!nlText) return;
  const tmpFile = path.join(os.tmpdir(), `interp_tts_${Date.now()}.mp3`);
  try {
    await downloadTTS(nlText, 'nl', tmpFile);
    log.info('Playing Dutch audio …');
    await playAudio(tmpFile);
    log.info('Playback done ✔');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

// ─── Processing queue ────────────────────────────────────────────────────────
// Process one segment at a time (don't overlap Whisper calls)
let isProcessing  = false;
const segQueue    = [];

async function enqueue(segment, captureRate) {
  segQueue.push({ segment, captureRate });
  if (!isProcessing) processNext();
}

async function processNext() {
  if (segQueue.length === 0) { isProcessing = false; return; }
  isProcessing = true;
  const { segment, captureRate } = segQueue.shift();
  try {
    const de = await transcribe(segment, captureRate);
    if (!de) { log.info('  (No speech found — skipping)'); }
    else {
      const nl = await translateDeNl(de);
      if (nl) {
        log.info(`--- DE: ${de}`);
        log.info(`--- NL: ${nl}`);
        await speak(nl);
      }
    }
  } catch (err) {
    log.error(`Pipeline error: ${err.message}`);
  }
  processNext();
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (LIST_MODE) {
    listDevices();
    process.exit(0);
  }

  log.info('='.repeat(60));
  log.info('  German→Dutch Interpreter  (Node.js)  —  starting up');
  log.info('='.repeat(60));
  log.info(`Log: ${LOG_FILE}`);
  log.info(`Whisper model: ${MODEL_SIZE} (${WHISPER_MODEL_ID})`);

  // Load Whisper first (slow, do before opening audio)
  await loadWhisper();

  // Warm-up translator
  log.info('Loading translator DE→NL …');
  try {
    await translateDeNl('Hallo');
    log.info('Translator ready ✔');
  } catch (err) {
    log.warn(`Translator warm-up failed (${err.message}) — will retry on first use`);
  }

  // Find and open device
  const deviceId = findLoopbackDevice(DEVICE_ARG);
  const capture  = new AudioCapture(deviceId, THRESHOLD);

  capture.onSegment = (segment) => enqueue(segment, capture.captureRate);
  capture.start();

  // Graceful shutdown
  function shutdown() {
    log.info('Shutting down …');
    capture.stop();
    process.exit(0);
  }
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  log.info('');
  log.info('━'.repeat(60));
  log.info('  RUNNING — listening for German speech');
  log.info('  Audio level printed every 3 s.');
  log.info(`  0.0000 level = wrong device. Run --list to check.`);
  log.info('  Press Ctrl+C to stop.');
  log.info('━'.repeat(60));
  log.info('');
}

main().catch((err) => {
  log.error(`Fatal: ${err.message}`);
  log.error(err.stack);
  process.exit(1);
});
