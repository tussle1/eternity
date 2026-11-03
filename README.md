# WOSU — Advanced Live Enhancement Suite + Custom Autoplay

A **single-file, installable Tampermonkey userscript** for [`https://wosu.dino.icu/`](https://wosu.dino.icu/).
It adds a premium, Neverlose-inspired overlay to the real WOSU website: live beatmap
visualization and object tracking, audio-clock synchronization, a beatmap analyzer,
performance monitoring, a drag-and-drop HUD editor, configuration management,
notifications and 31 advanced modules — plus an **independent Custom Autoplay engine**
with configurable humanization and randomization.

**This is not a standalone app, an external dashboard, a replay viewer or a mockup.**
Everything shown is derived from WOSU's own runtime data — its decoded `.osu` files,
its Web Audio clock, its frame loop, its IndexedDB library and its settings. There are
no sample/fake values and no placeholder buttons.

> **The autoplay is your own, not the site's.** The Custom Autoplay engine never enables
> or calls WOSU's built-in Auto mod / `AutoPlayer`. It reads the same decoded beatmap and
> audio clock the live suite uses, detects every circle, slider and spinner, and drives
> the game by synthesizing ordinary keyboard and pointer events through the page's normal
> input path. Humanization (timing jitter, aim scatter, cursor speed/smoothing, hold
> times, spinner RPM) and randomization (seeded, reproducible) are fully configurable.
> It does **not** write scores, manipulate the online API, bypass anything, or make any
> network calls. Use it only where automation is permitted.

| Deliverable | File |
| --- | --- |
| Complete userscript | [`wosu-enhancement.user.js`](./wosu-enhancement.user.js) |
| Installation instructions | this README |

---

## 1. Requirements

* A **Chromium-based browser** (Chrome, Edge, Brave, Vivaldi, Opera) with WebGL/WebGPU
  enabled — WOSU itself requires it.
* **Tampermonkey** (recommended) or Violentmonkey. The script requests only
  `GM_getValue`, `GM_setValue`, `GM_deleteValue`, `GM_listValues`,
  `GM_registerMenuCommand`, `GM_addStyle` and `unsafeWindow`.
* No account, no backend, no local server, no API key, no build step and no external
  runtime dependencies.

The header declares `@match https://wosu.dino.icu/*` and `@run-at document-start`, so
the runtime hooks are installed **before** WOSU's ES modules boot.

## 2. Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser and enable it
   (Chrome → `chrome://extensions` → allow site access / developer mode if asked).
2. Download [`wosu-enhancement.user.js`](./wosu-enhancement.user.js) (GitHub: **Raw** →
   save as `wosu-enhancement.user.js`), or clone this repository.
3. Install it in either of two ways:
   * **Drag & drop** the `.user.js` file onto a browser window. Tampermonkey opens an
     install tab — click **Install**.
   * Or open **Tampermonkey → Dashboard → Utilities → Import from file**, choose the
     file; or **Dashboard → + (New script)**, paste the whole file and press
     `Ctrl+S`.
4. Confirm the script is **enabled** and that its `@match` is
   `https://wosu.dino.icu/*`.
5. Open <https://wosu.dino.icu/> and **reload the page once** after installing.
6. Press **Right Shift**. The menu opens. A small **W** launcher button also sits in the
   bottom-right corner; Tampermonkey's extension menu has shortcuts to the Dashboard,
   Debug Console, statistics export and configuration backup.

> The script initializes automatically when WOSU loads. Reloads and history/hash
> navigation are handled; a single `window.__WOSU_ENHANCE_SUITE__` guard prevents
> duplicate initialization.

### Updating

Replace the script contents in Tampermonkey and reload the WOSU tab. Settings are kept
(they are stored under the `wosu-enhance.*` Tampermonkey storage keys). To start from a
clean slate use **Settings → Reset configuration** or **Reset everything**.

### Uninstalling

Tampermonkey → Dashboard → delete the script, then reload WOSU. Optionally remove its
stored values (`wosu-enhance.config`, `wosu-enhance.configs`,
`wosu-enhance.session`) from Tampermonkey's storage.

---

## 3. First-run verification

* **Right Shift** opens/closes the menu; the sidebar switches between 16 sections.
* **Autoplay** section (or **F9**) arms the independent Custom Autoplay engine. With the
  site Auto mod **off**, start any map and the engine plays it using your configured
  humanization/randomization. The Dashboard, Live Tracking, Analyzer, Timeline, Audio,
  Inspector, Performance, Session, History, Configurations, Modules, Debug and Settings
  sections all work exactly as before.
* Load/play any beatmap in WOSU. The **Dashboard** immediately shows the real song,
  artist, mapper, difficulty, BPM, playback time, duration, progress, current object,
  objects remaining, circle/slider/spinner counts, tracking status, audio sync status,
  FPS, frame time and active configuration.
* **Live Tracking** / **Visuals** draw circles, approach rings, slider paths, ticks,
  repeats, spinner progress, labels, IDs, timestamps, trails, distance indicators,
  density heatmap and a crosshair over WOSU's 512×384 playfield.
* **Audio Analysis** shows the real `AudioContext` clock, playback rate, decoder delay,
  WOSU's global/per-beatmap offsets, drift, waveform, spectrum and timing points.
* **Debug Console → Integration diagnostics** reports the status of every verified
  integration seam. Items shown as *warn* simply mean that the corresponding WOSU
  feature has not been used yet in this tab (for example, no audio source started, no
  IndexedDB library, or no online API response captured).

---

## 4. Interface

### Sections (16)

| Section | Purpose |
| --- | --- |
| Dashboard | Live overview, progress, session snapshot, quick actions |
| Autoplay | Independent custom autoplay: arm/start/stop, presets, timing/aim/cursor/key humanization, per-object behavior, seeded randomization, live plan |
| Live Tracking | Upcoming objects, sequence numbers, positions, timestamps, slider paths, spinner progress, spacing, density, timeline |
| Visuals | Circle/approach/slider/spinner indicators, labels, IDs, trails, colors, outlines, transparency, minimal/full HUD, crosshair, color presets |
| HUD Editor | Drag, resize, show/hide, recolor, transparency, text size, save/load/reset/preview HUD profiles |
| Beatmap Analyzer | Total/circle/slider/spinner counts, BPM distribution, timing-point overview, density graph, difficulty info, duration, spacing, progression, high-density sections, section analysis |
| Timeline | Interactive beatmap timeline (hover, click to inspect, drag to pan, scroll to zoom), BPM graph, timing inspector, drift graph, object preview, live event log |
| Audio Analysis | Playback position, BPM/timing points, offsets, drift, pause/resume/seek/speed events, waveform, spectrum, timing info, sync warnings |
| Object Inspector | Any hit object's real properties; slider curve/tick/path and spinner progress; difficulty comparison; beatmap search |
| Performance | Live FPS, frame-time graph, FPS history, memory (Chrome), rendering time, tracking update rate, warnings, lightweight mode, history, intervals |
| Session Statistics | Session counters, live event log, bookmarks, statistics export, compact mode, configuration backup |
| Playback History | Songs loaded this session/across reloads, favorites, library diagnostics |
| Configurations | Create/rename/duplicate/delete/import/export/autosave/default, separate visual and performance configs, descriptions |
| Module Manager | Individually enable/disable all 31 modules, jump to each module's panel |
| Debug Console | Errors, page errors, probe errors, runtime state, decoded beatmap cache, integration diagnostics |
| Settings | Themes, custom accents, UI scale, opacity, compact/collapsed layout, hide menu, auto theme, keybinds, notifications, data & backup |

### Modules (31)

Custom Autoplay · Beatmap Timeline · BPM Graph · Timing Inspector · Object Inspector · Slider Inspector ·
Spinner Inspector · Difficulty Comparison · Session Statistics · Playback History ·
Favorite Beatmaps · Beatmap Search Panel · Custom Crosshair · Color Presets · HUD
Profiles · Object Density Heatmap · Audio Waveform · Timing Drift Graph · Live Event
Log · Debug Console · Module Manager · Custom Notifications · Keyboard Shortcut Editor ·
Compact Mode · Statistics Export · Automatic Theme Switching · Object Preview Panel ·
Beatmap Section Bookmarks · Configuration Backup · Integration Diagnostics ·
Performance Presets.

Disabling a module stops its behavior (drawing, notifications, auto-theme, HUD
profiles, etc.) and hides its panel; the Module Manager itself stays available so it
can be re-enabled.

### Default keyboard shortcuts

| Action | Key |
| --- | --- |
| Open / close menu | `Right Shift` |
| Arm / disarm custom autoplay | `F9` |
| Open autoplay section | `Alt+A` |
| Toggle HUD / visuals | `F6` / `F7` |
| Cycle performance preset / compact mode | `F8` / `Alt+C` |
| Next / previous section | `Alt+]` / `Alt+[` |
| Bookmark / favorite / export stats | `Alt+B` / `Alt+F` / `Alt+S` |
| Cycle theme / lightweight / crosshair | `Alt+T` / `Alt+L` / `Alt+X` |
| Debug console / reset HUD / focus search | `Alt+D` / `Alt+R` / `Alt+K` |

All shortcuts are editable in **Settings → Keyboard shortcut editor** (click a key,
press the new combination, `Esc` cancels). Menu shortcuts only fire on their exact
combination. The separate **Custom Autoplay** engine is the only part that synthesizes
gameplay input, and its synthetic events are tagged so they never trigger menu shortcuts.

### Notifications, persistence and customization

Toasts are configurable (position, duration, max visible, radius, blur, accent color,
per-event toggles) and cover beatmap detected/changed, song started/paused/resumed,
sync lost/restored, config loaded, performance warnings and tracking
initialized/unavailable. Themes: Neverlose, Midnight, Carbon, Crimson, Aurora (+ a
bright/day theme configurable for automatic switching). Settings, HUD layouts,
configurations, favorites, bookmarks, history and event logs persist through
Tampermonkey storage with a `localStorage` fallback. **Settings → Data &
configuration** exports/imports a single full backup file.

---

## 5. Custom Autoplay engine

The autoplay is a self-contained input layer inside the userscript. It is **independent
of WOSU's Auto mod** — it does not select `AT`, does not call `AutoPlayer`, and does not
touch the site's replay/auto code paths.

### How it plays

1. **Detect** — it uses the suite's existing `TextDecoder` hook to capture the real
   `.osu` file WOSU decodes, then the faithful parser/processing ports build the playable
   beatmap (circles, slider paths/ticks/repeats, spinners, stacking, HR flip, CS/AR/OD).
2. **Clock** — it reads the same Web Audio song clock (interpolated between probe ticks)
   that the live HUD uses, so hits land on the music at any playback rate (DT/HT/NC/DC).
3. **Plan** — on run start it builds a per-object plan: press time, aim point, key choice,
   hold duration, slider follow and spinner orbit, with humanization sampled from a
   seeded RNG (mulberry32 + Gaussian/uniform).
4. **Drive** — a 2 ms scheduler plus the frame loop synthesize normal `KeyboardEvent`
   presses (WOSU's own K1/K2 keys, read from its settings) and absolute `PointerEvent`
   moves. Pen-style pointer events steer the gameplay cursor even when WOSU has the mouse
   pointer-locked (high-precision / confine), because only mouse pointers are replaced by
   the lock's virtual cursor. The game's normal `GameplayInput` judges the presses.

### Controls (Autoplay section)

| Group | What you can configure |
| --- | --- |
| Engine | Arm/disarm, auto start, pause while menu open, block when site Auto (AT) is on, master humanize switch, start/stop/rebuild |
| Presets | Robot (perfect), Human (default), Relaxed, Legit-looking |
| Timing | Global hit offset, jitter σ, jitter clamp (capped to the hit window), Gaussian/uniform distribution |
| Aim | Aim error (px), aim error (% of circle radius), cursor micro-jitter |
| Cursor | Max speed (px/s), smoothing, robotic snap |
| Keys & holds | Alternate/random/K1/K2, circle hold time + jitter, optional key-code overrides |
| Per-object | Enable circles/sliders/spinners, intentional miss chance, slider follow + follow error + early release, spinner RPM/jitter/radius/direction |
| Seed | Randomize each run or fixed reproducible seed |

Safety behavior: held keys are released on pause, menu open (optional), tab hide, window
blur, disarm and `destroy()`. Presses that fall outside the miss window after a lag spike
or seek are dropped rather than fired late. If the site Auto mod (`AT`) is selected the
engine refuses to run (the site disables normal input in that mode) and tells you why.

### Boundaries

The engine only synthesizes local input events. It does **not** write scores, call the
online API, alter replays, bypass anti-cheat, or send any data off the machine. Whether a
play is eligible for online submission is entirely WOSU's own decision; the suite does
not interfere with it.

---

## 6. How it integrates with WOSU (verified against the source)

WOSU is a Vite/TypeScript/PixiJS application rendered into one canvas. `src/main.ts`
only exposes `window.game` in **development** builds, so the production site has no
exported game object. This suite therefore attaches to stable, verified runtime seams
instead of inventing internal APIs:

| Seam | WOSU source |
| --- | --- |
| `TextDecoder.prototype.decode` (`.osu` text) | `src/beatmap/archive.ts` → `OszArchive.readText` |
| `AudioBufferSourceNode.start/stop` | `src/audio/MusicTrack.ts` → `startSource` |
| `AudioContext.createAnalyser`, `decodeAudioData` | `src/audio/AudioEngine.ts`, `src/audio/MusicTrack.ts` |
| `MessagePort.postMessage` / `onmessage` (`inputTime`) | `public/vendor/SignalsmithStretch.mjs` |
| `Response.prototype.text` | `src/online/*` → `fetchJson` |
| `HTMLMediaElement.play/pause` | `src/audio/PreviewPlayer.ts` |
| `requestAnimationFrame` | `src/app/FrameLoop.ts` |
| IndexedDB `webosu` v2 (`sets`, `blobs`) | `src/storage/idb.ts`, `src/beatmap/Library.ts` |
| `localStorage['webosu.settings.v2']`, `lastBeatmap` | `src/settings/Settings.ts`, `src/screens/select/SongSelectScreen.ts` |
| `localStorage['wosu.beatmapOffsets.v1']` | `src/storage/BeatmapOffsets.ts` |

Beatmap parsing, control-point folding, Bézier/Catmull/arc slider paths, slider tick
generation, stacking, combo numbering, difficulty attributes (`preempt`, hit windows,
circle radius) and the 512×384 playfield transform are faithful ports of
`src/beatmap/{parser,processing,curves,controlPoints,difficulty}.ts` and
`src/screens/play/PlayerScreen.ts`. They are ports rather than imports because a
userscript cannot reach Vite ES-module internals.

The audio clock is computed from the real source:
`songTime = (offset + (ctx.currentTime − when) × rate) × 1000 − (decoderDelay + globalOffset + beatmapOffset) × rate − manualOffset`,
with the time-stretch worklet's `inputTime` messages as the fallback path.

### Boundaries

The live tracking/analysis layer is read-only. The optional Custom Autoplay engine adds
**local input synthesis only**: no online score manipulation, no anti-cheat bypass, no
network requests of its own, no data leaving the browser. All original page APIs keep
working (the hooks call through to the original functions), and errors are caught so they
cannot break gameplay. A `destroy()` cleanup releases held keys and removes the overlay,
timers and probe state; `__WOSU_ENHANCE_SUITE__.api` exposes diagnostics and autoplay
controls for troubleshooting.

---

## 7. Troubleshooting

| Symptom | What to check |
| --- | --- |
| Menu does not open | Script enabled? `@match` correct? Hard-reload the WOSU tab. Try the **W** launcher. Rebind the menu key in Settings. |
| Autoplay does nothing | Is it armed (F9 / Autoplay section)? Is the site **Auto mod (AT) off**? The engine blocks itself while AT is on. Is a beatmap decoded (Dashboard shows objects)? Check **Debug → Integration diagnostics** for the autoplay rows. |
| Autoplay misses notes | Lower timing jitter / aim error, raise cursor speed, or use the Robot preset. Ensure WOSU's K1/K2 keys match (Autoplay → Keys shows the effective codes). |
| Dashboard shows `—` | WOSU has not decoded a beatmap in this tab yet. Select/start a difficulty; the suite reads WOSU's own decodes and IndexedDB library, it never downloads maps. |
| Audio sync shows `IDLE` | No long audio source has started. Start playback; the **Audio Analysis** section lists the detected source, offsets and drift. |
| Diagnostics show *warn* | The corresponding WOSU feature has not run yet (no analyser, no IDB library, no online API response, etc.). This is expected on a fresh page. |
| Overlay is heavy | **Performance → Performance presets → Low Overhead**, or enable *Lightweight rendering* and raise the UI/canvas intervals. Long sessions keep bounded histories (all arrays are capped). |
| Layout looks wrong after changing many settings | **Settings → Reset configuration** (keeps saved configurations) or **Reset everything** (clears all stored data). |
| WOSU behaves differently | Disable the suite in Tampermonkey and reload to confirm. Report the **Debug Console → Integration diagnostics** output. |

### Validation performed

* `node --check wosu-enhancement.user.js` — syntax valid.
* A headless DOM harness (jsdom) exercised the Custom Autoplay engine: plan building and
  sorting, seeded reproducibility, synthetic keydown/keyup/pen-pointer emission, correct
  K1/K2 codes, per-type counters, no stuck keys, Robot preset zero-jitter/exact-aim,
  Human preset jitter, site-Auto blocking, disarm release, section/module registration
  and diagnostics rows — 22 assertions passed.
* The original live-suite harness (jsdom + fake IndexedDB + fake Web Audio) exercised:
  boot/duplicate-init guard, all 16 sections, 31 modules, every control class and
  77 button actions, real `TextDecoder`/`Response`/`AudioBufferSourceNode`/
  `decodeAudioData`/`requestAnimationFrame`/`MessagePort` hooks, a real WOSU `.osu`
  test fixture, a hand-built `.osz` archive read through IndexedDB, analysis math,
  the audio clock with mods/offsets, keybind capture, notifications, diagnostics,
  configuration persistence across reload, malformed input, and `destroy()` cleanup.
  All 81 assertions passed with zero uncaught errors.
* The userscript contains no external URLs, no `eval`, no network calls and no
  generated/fake data.
