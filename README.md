# 🎙️ German → Dutch Background Audio Interpreter (Node.js)

Captures system audio (browser tabs, videos, calls), detects German speech,
translates it to Dutch, and plays the Dutch audio through your speakers —
completely silent in the background. No GUI required.

---

## How it works

```
Browser audio
     │
     ▼  loopback capture (naudiodon / PortAudio)
     │
     ▼  VAD + silence detection
     │
     ▼  @xenova/transformers Whisper  →  German text
     │
     ▼  Google Translate (DE → NL)   →  Dutch text
     │
     ▼  Google TTS + ffplay           →  🔊 Dutch speech
```

---

## Requirements

| Requirement      | Version  | Notes                                  |
|------------------|----------|----------------------------------------|
| Node.js          | ≥ 18     | https://nodejs.org                     |
| npm              | ≥ 8      | Comes with Node.js                     |
| ffmpeg           | any      | For audio playback (ffplay)            |
| Build tools      | —        | For compiling naudiodon (see below)    |
| Loopback device  | —        | To capture browser audio               |
| Internet         | —        | For Google Translate + TTS + model dl  |

---

## Step 1 — Install Node.js

Download the LTS version from https://nodejs.org and install it.

Verify:
```
node --version    # should be v18 or newer
npm --version
```

---

## Step 2 — Install ffmpeg

`ffplay` (part of ffmpeg) is used to play the Dutch audio.

### Windows
1. Download from https://www.gyan.dev/ffmpeg/builds/ (essentials build)
2. Extract and place `ffmpeg.exe`, `ffplay.exe`, `ffprobe.exe` in `C:\ffmpeg\bin\`
3. Add `C:\ffmpeg\bin` to your system PATH
4. Open a new terminal and verify: `ffplay -version`

### macOS
```bash
brew install ffmpeg
```

### Linux
```bash
sudo apt install ffmpeg
```

---

## Step 3 — Install build tools (for naudiodon)

`naudiodon` is a native Node.js addon that wraps PortAudio. It needs to be
compiled on your machine during `npm install`.

### Windows

**Option A — Automatic (recommended):**
```
npm install --global --production windows-build-tools
```
> Run this in an **Administrator** PowerShell. This installs Visual Studio
> Build Tools and Python automatically.

**Option B — Manual:**
1. Install Visual Studio 2022 Build Tools from
   https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
2. In the installer, select: **"Desktop development with C++"**
3. Also install: https://nodejs.org/en/download (includes node-gyp)

### macOS
```bash
xcode-select --install
```

### Linux (Ubuntu/Debian)
```bash
sudo apt install build-essential libasound2-dev
```

---

## Step 4 — Install project dependencies

```bash
cd german-dutch-interpreter
npm install
```

This will:
- Compile `naudiodon` (the native audio addon)
- Install `@xenova/transformers` (Whisper ONNX runtime)
- Install `@vitalets/google-translate-api`

The Whisper ONNX model (~300–460 MB depending on size) is downloaded
automatically on **first run**, not during `npm install`.

---

## Step 5 — Set up system audio capture (loopback)

The program must hear what your browser is playing. You need a loopback device.

### Windows — Stereo Mix

1. Right-click speaker icon → **Sounds** → **Recording** tab
2. Right-click empty area → **Show Disabled Devices**
3. Right-click **Stereo Mix** → **Enable**
4. Right-click **Stereo Mix** → **Set as Default Device**

If Stereo Mix is missing, install **VB-Audio Virtual Cable** (free):
https://vb-audio.com/Cable/
- Set your browser output to **CABLE Input**
- The interpreter will capture from **CABLE Output**
- To still hear audio yourself: enable "Listen to this device" on CABLE Output

### macOS — BlackHole

```bash
brew install blackhole-2ch
```

1. Open **Audio MIDI Setup** → click **+** → **Create Multi-Output Device**
2. Check both **BlackHole 2ch** and your speakers/headphones
3. Set the Multi-Output Device as your system default output
4. The interpreter will auto-detect BlackHole as the capture device

### Linux — PulseAudio / PipeWire

Works automatically — the monitor source is auto-detected. No setup needed.

Verify:
```bash
pactl list short sources | grep monitor
```

---

## Step 6 — Find your device index

```bash
node interpreter.js --list
```

Example output:
```
 IDX  SAMPLERATE    TYPE        NAME
────────────────────────────────────────────────────────────────────────
   1  44100      Hz  LOOPBACK    Stereo Mix (Realtek(R) Audio)
   3  44100      Hz  input       Microphone (USB Audio Device)
```

---

## Step 7 — Run the interpreter

### Foreground (see all output, Ctrl+C to stop):
```bash
node interpreter.js --device 1
```

### Windows background:
```
start.bat start
start.bat log      ← watch live output
start.bat stop     ← stop it
```

### Linux/macOS background:
```bash
bash start.sh start
bash start.sh log
bash start.sh stop
```

---

## Whisper model sizes

| Flag            | Model   | Size   | Speed   | Accuracy |
|-----------------|---------|--------|---------|----------|
| `--model tiny`  | tiny    | ~75 MB | fastest | low      |
| `--model base`  | base    | ~145 MB| fast    | ok       |
| `--model small` | small   | ~245 MB| good    | good     |
| `--model medium`| medium  | ~460 MB| slower  | best     |

Default is `medium`. For faster response on slower machines, use `small`:
```
node interpreter.js --device 1 --model small
```

---

## All command-line options

| Option              | Default    | Description                            |
|---------------------|------------|----------------------------------------|
| `--device INDEX`    | auto       | Audio input device index               |
| `--list`            | —          | List all input devices and exit        |
| `--model SIZE`      | `medium`   | Whisper model: tiny/base/small/medium  |
| `--threshold VALUE` | `0.012`    | RMS silence threshold (0.001–0.1)      |

---

## Tuning the silence threshold

If the interpreter triggers on background noise (music, ambient sound):
```
node interpreter.js --device 1 --threshold 0.03
```

If it misses quiet speech:
```
node interpreter.js --device 1 --threshold 0.006
```

The level meter in the output shows the current RMS. Set the threshold just
above the background noise level.

---

## Run on startup

### Windows — Task Scheduler
1. Open Task Scheduler → Create Basic Task
2. Trigger: **When I log on**
3. Action: **Start a program** → `node.exe`
4. Arguments: `C:\path\to\interpreter.js --device 1`
5. "Start in": `C:\path\to\`

### macOS — launchd
Create `~/Library/LaunchAgents/com.interpreter.german-dutch.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.interpreter.german-dutch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/interpreter.js</string>
    <string>--device</string><string>1</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/path/to/interpreter.log</string>
  <key>StandardErrorPath</key><string>/path/to/interpreter.log</string>
</dict></plist>
```
```bash
launchctl load ~/Library/LaunchAgents/com.interpreter.german-dutch.plist
```

### Linux — systemd
```ini
# ~/.config/systemd/user/german-dutch.service
[Unit]
Description=German-Dutch Audio Interpreter
After=network.target pulseaudio.service

[Service]
ExecStart=/usr/bin/node /path/to/interpreter.js --device 1
Restart=on-failure
StandardOutput=append:/path/to/interpreter.log
StandardError=append:/path/to/interpreter.log

[Install]
WantedBy=default.target
```
```bash
systemctl --user enable --now german-dutch
```

---

## What you should see in the terminal

```
2026-03-11 21:05:00 [INFO] German→Dutch Interpreter (Node.js) — starting up
2026-03-11 21:05:00 [INFO] Loading Whisper 'medium' …
2026-03-11 21:05:18 [INFO] Whisper ready ✔
2026-03-11 21:05:18 [INFO] Translator ready ✔
2026-03-11 21:05:18 [INFO] Audio capture started [1] Stereo Mix @ 44100 Hz
2026-03-11 21:05:21 [INFO] Level: 0.0312  |████████████           |  [silence]
2026-03-11 21:05:24 [INFO] ▶ Speech detected (RMS=0.0421) — recording …
2026-03-11 21:05:28 [INFO] ■ Segment ready (silence, 4.1s) — sending to pipeline
2026-03-11 21:05:30 [INFO] STT [DE]: "Guten Morgen, wie geht es Ihnen?"
2026-03-11 21:05:30 [INFO] TRANS [NL]: "Goedemorgen, hoe gaat het met u?"
2026-03-11 21:05:30 [INFO] --- DE: Guten Morgen, wie geht es Ihnen?
2026-03-11 21:05:30 [INFO] --- NL: Goedemorgen, hoe gaat het met u?
2026-03-11 21:05:30 [INFO] Playing Dutch audio …
2026-03-11 21:05:32 [INFO] Playback done ✔
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails on naudiodon | Install build tools (Step 3) |
| `Invalid device` error | Run `--list` and use a valid index |
| Level shows `0.0000` | Wrong device — set up loopback (Step 5) |
| `ffplay: command not found` | Install ffmpeg and add to PATH |
| Slow transcription | Use `--model small` instead of medium |
| Translation fails | Check internet connection |
| Triggers on background noise | Increase `--threshold` |
| Misses quiet speech | Decrease `--threshold` |

---

## File overview

```
german-dutch-interpreter/
├── interpreter.js     ← Main program
├── package.json       ← Dependencies
├── start.bat          ← Windows background runner
├── start.sh           ← Linux/macOS background runner
└── README.md          ← This file
```
