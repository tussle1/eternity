# WOSU — Advanced Live Enhancement Suite

A **single-file, installable Tampermonkey userscript** for [`https://wosu.dino.icu/`](https://wosu.dino.icu/).
It adds a premium, Neverlose-inspired overlay to the real WOSU website: live beatmap
visualization and object tracking, audio-clock synchronization, a beatmap analyzer,
performance monitoring, a drag-and-drop HUD editor, configuration management,
notifications and 30 advanced modules.

**This is not a standalone app, an external dashboard, a replay viewer, an autoplay
preview, or a mockup.** Everything shown is derived from WOSU's own runtime data —
its decoded `.osu` files, its Web Audio clock, its frame loop, its IndexedDB library
and its settings. There are no sample/fake values and no placeholder buttons.

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

* **Right Shift** opens/closes the menu; the sidebar switches between 15 sections.
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

### Sections (15)

| Section | Purpose |
| --- | --- |
| Dashboard | Live overview, progress, session snapshot, quick actions |
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
| Module Manager | Individually enable/disable all 30 modules, jump to each module's panel |
| Debug Console | Errors, page errors, probe errors, runtime state, decoded beatmap cache, integration diagnostics |
| Settings | Themes, custom accents, UI scale, opacity, compact/collapsed layout, hide menu, auto theme, keybinds, notifications, data & backup |

### Modules (30)

Beatmap Timeline · BPM Graph · Timing Inspector · Object Inspector · Slider Inspector ·
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
| Toggle HUD / visuals | `F6` / `F7` |
| Cycle performance preset / compact mode | `F8` / `Alt+C` |
| Next / previous section | `Alt+]` / `Alt+[` |
| Bookmark / favorite / export stats | `Alt+B` / `Alt+F` / `Alt+S` |
| Cycle theme / lightweight / crosshair | `Alt+T` / `Alt+L` / `Alt+X` |
| Debug console / reset HUD / focus search | `Alt+D` / `Alt+R` / `Alt+K` |

All shortcuts are editable in **Settings → Keyboard shortcut editor** (click a key,
press the new combination, `Esc` cancels). Shortcuts only fire on their exact
combination; they never synthesize gameplay input.

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

## 5. How it integrates with WOSU (verified against the source)

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

Strictly read-only: **no automated gameplay input, no online score manipulation, no
anti-cheat bypass, no network requests of its own, no data leaving the browser.** All
original page APIs keep working (the hooks call through to the original functions), and
errors are caught so they cannot break gameplay. A `destroy()` cleanup removes the
overlay, timers and probe state; `__WOSU_ENHANCE_SUITE__.api` exposes read-only
diagnostics for troubleshooting.

---

## 6. Troubleshooting

| Symptom | What to check |
| --- | --- |
| Menu does not open | Script enabled? `@match` correct? Hard-reload the WOSU tab. Try the **W** launcher. Rebind the menu key in Settings. |
| Dashboard shows `—` | WOSU has not decoded a beatmap in this tab yet. Select/start a difficulty; the suite reads WOSU's own decodes and IndexedDB library, it never downloads maps. |
| Audio sync shows `IDLE` | No long audio source has started. Start playback; the **Audio Analysis** section lists the detected source, offsets and drift. |
| Diagnostics show *warn* | The corresponding WOSU feature has not run yet (no analyser, no IDB library, no online API response, etc.). This is expected on a fresh page. |
| Overlay is heavy | **Performance → Performance presets → Low Overhead**, or enable *Lightweight rendering* and raise the UI/canvas intervals. Long sessions keep bounded histories (all arrays are capped). |
| Layout looks wrong after changing many settings | **Settings → Reset configuration** (keeps saved configurations) or **Reset everything** (clears all stored data). |
| WOSU behaves differently | Disable the suite in Tampermonkey and reload to confirm. Report the **Debug Console → Integration diagnostics** output. |

### Validation performed

* `node --check wosu-enhancement.user.js` — syntax valid.
* A headless DOM harness (jsdom + fake IndexedDB + fake Web Audio) exercised:
  boot/duplicate-init guard, all 15 sections, 30 modules, every control class and
  77 button actions, real `TextDecoder`/`Response`/`AudioBufferSourceNode`/
  `decodeAudioData`/`requestAnimationFrame`/`MessagePort` hooks, a real WOSU `.osu`
  test fixture, a hand-built `.osz` archive read through IndexedDB, analysis math,
  the audio clock with mods/offsets, keybind capture, notifications, diagnostics,
  configuration persistence across reload, malformed input, and `destroy()` cleanup.
  All 81 assertions passed with zero uncaught errors.
* The userscript contains no external URLs, no `eval`, no network calls and no
  generated/fake data.
