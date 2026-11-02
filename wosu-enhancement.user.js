// ==UserScript==
// @name         WOSU — Advanced Live Enhancement Suite
// @namespace    https://github.com/tussle1/eternity
// @version      1.0.0
// @description  Live beatmap tracking, audio synchronization, analysis, HUD editor and performance monitoring for wosu.dino.icu. Read-only integration: no gameplay input, no score manipulation.
// @author       Arena
// @match        https://wosu.dino.icu/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        unsafeWindow
// @noframes
// @license      MIT
// @homepageURL   https://github.com/tussle1/eternity
// ==/UserScript==
/*
 * INSTALL (Chromium + Tampermonkey):
 *   1. Drag this .user.js onto a browser window, or paste it into a new
 *      Tampermonkey script (Dashboard -> "+", then Ctrl+S).
 *   2. Confirm @match https://wosu.dino.icu/* and reload the WOSU tab.
 *   3. Press Right Shift to open the menu. See README.md for full docs.
 *
 * WOSU — Advanced Live Enhancement Suite
 * ---------------------------------------------------------------------------
 * Verified against https://github.com/mostlime12195/wosu (main @ 949537f).
 *
 * WOSU ships as a single Vite ES-module bundle. `src/main.ts` only exposes
 * `window.game` in DEV builds, so production has NO exported game object.
 * This suite therefore attaches to verified, stable runtime seams instead of
 * inventing internal APIs:
 *
 *   seam                                  source
 *   ------------------------------------  ---------------------------------
 *   TextDecoder.prototype.decode         src/beatmap/archive.ts::readText
 *   AudioBufferSourceNode.start/stop     src/audio/MusicTrack.ts::startSource
 *   AudioContext.createAnalyser          src/audio/AudioEngine.ts::build
 *   AudioWorklet MessagePort messages    public/vendor/SignalsmithStretch.mjs
 *   Response.prototype.text              src/online/BeatmapApi.ts::fetchJson
 *   requestAnimationFrame                src/app/FrameLoop.ts
 *   IndexedDB "webosu" (sets / blobs)    src/storage/idb.ts
 *   localStorage webosu.settings.v2      src/settings/Settings.ts
 *   localStorage wosu.beatmapOffsets.v1  src/storage/BeatmapOffsets.ts
 *
 * Beatmap parsing, control-point folding, slider paths, slider timing,
 * stacking, combo numbering, difficulty attributes and the playfield
 * transform are faithful ports of src/beatmap/{parser,processing,curves,
 * controlPoints,difficulty}.ts and src/screens/play/PlayerScreen.ts. They are
 * ports (not imports) because a userscript cannot reach ES-module internals.
 *
 * Everything is read-only. No automated input, no score writes, no network
 * calls of our own, no external dependencies.
 */
(function () {
    'use strict';
    if (window.__WOSU_ENHANCE_SUITE__) return;

    // =======================================================================
    // 0. Small utilities
    // =======================================================================
    const VERSION = '1.0.0';
    const NS = 'wosu-enhance';
    const now = () => Date.now();
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
    const lerp = (a, b, t) => a + (b - a) * t;
    const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
    const round = (v, d = 1) => { const p = Math.pow(10, d); return Math.round(v * p) / p; };
    const pad2 = n => String(Math.floor(n)).padStart(2, '0');
    const uid = () => 'c' + now().toString(36) + Math.random().toString(36).slice(2, 7);
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const clone = v => { try { return JSON.parse(JSON.stringify(v)); } catch { return v; } };
    function mergeDeep(base, over) {
        if (!isObj(over)) return clone(base);
        const out = clone(base);
        for (const k of Object.keys(over)) {
            if (isObj(out[k]) && isObj(over[k])) out[k] = mergeDeep(out[k], over[k]);
            else if (over[k] !== undefined) out[k] = clone(over[k]);
        }
        return out;
    }
    function getPath(o, path) { return path.split('.').reduce((a, k) => a == null ? undefined : a[k], o); }
    function setPath(o, path, value) {
        const parts = path.split('.'); const last = parts.pop();
        let t = o; for (const k of parts) { if (!isObj(t[k])) t[k] = {}; t = t[k]; }
        t[last] = value;
    }
    function fmtTime(ms, sign) {
        if (!Number.isFinite(ms)) return '--:--';
        const neg = ms < 0; let s = Math.floor(Math.abs(ms) / 1000);
        const m = Math.floor(s / 60); s -= m * 60;
        return (neg ? '-' : (sign && ms > 0 ? '+' : '')) + m + ':' + pad2(s);
    }
    function fmtTimePrecise(ms) {
        if (!Number.isFinite(ms)) return '--:--.--';
        const neg = ms < 0; let t = Math.abs(ms);
        const m = Math.floor(t / 60000); t -= m * 60000;
        const s = Math.floor(t / 1000); const cs = Math.floor((t - s * 1000) / 10);
        return (neg ? '-' : '') + m + ':' + pad2(s) + '.' + pad2(cs);
    }
    function fmtNum(v, d = 0) { return Number.isFinite(v) ? v.toFixed(d) : '—'; }
    function fmtBytes(v) {
        if (!Number.isFinite(v)) return '—';
        if (v < 1024) return v + ' B';
        if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
        return (v / 1048576).toFixed(1) + ' MB';
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function hashString(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
    function download(name, data, type) {
        try {
            const blob = new Blob([data], { type: type || 'application/json' });
            let url = null;
            if (typeof URL.createObjectURL === 'function') { try { url = URL.createObjectURL(blob); } catch { /* fall through */ } }
            if (!url) url = 'data:' + (type || 'application/json') + ';charset=utf-8,' + encodeURIComponent(String(data));
            const a = document.createElement('a'); a.href = url; a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            if (url.indexOf('blob:') === 0 && typeof URL.revokeObjectURL === 'function') setTimeout(() => URL.revokeObjectURL(url), 5000);
            return true;
        } catch (e) { logError('download', e); return false; }
    }
    function pickFile(accept) {
        return new Promise(resolve => {
            const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept || 'application/json,.json';
            inp.style.display = 'none'; document.body.appendChild(inp);
            inp.addEventListener('change', () => {
                const f = inp.files && inp.files[0]; inp.remove();
                if (!f) return resolve(null);
                const fr = new FileReader();
                fr.onload = () => resolve({ name: f.name, text: String(fr.result || '') });
                fr.onerror = () => resolve(null); fr.readAsText(f);
            });
            inp.addEventListener('cancel', () => { if (inp.parentNode) inp.remove(); resolve(null); });
            inp.click();
        });
    }
    function safeParse(text, fallback) { try { return JSON.parse(text); } catch { return fallback; } }

    // =======================================================================
    // 1. Persistent storage (Tampermonkey GM_* with a localStorage fallback)
    // =======================================================================
    const Store = (() => {
        const gm = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
        const prefix = NS + '.';
        return {
            mode: gm ? 'GM' : 'localStorage',
            get(key, def) {
                try {
                    const raw = gm ? GM_getValue(prefix + key, undefined) : localStorage.getItem(prefix + key);
                    if (raw === undefined || raw === null || raw === '') return def;
                    if (typeof raw === 'string') return safeParse(raw, def);
                    return raw;
                } catch { return def; }
            },
            set(key, value) {
                try {
                    const raw = JSON.stringify(value);
                    if (gm) GM_setValue(prefix + key, raw); else localStorage.setItem(prefix + key, raw);
                    return true;
                } catch (e) { logError('Store.set:' + key, e); return false; }
            },
            del(key) {
                try { if (gm) GM_deleteValue(prefix + key); else localStorage.removeItem(prefix + key); } catch { /* ignore */ }
            },
            keys() {
                try {
                    if (gm) return (typeof GM_listValues === 'function' ? GM_listValues() : []).filter(k => k.indexOf(prefix) === 0).map(k => k.slice(prefix.length));
                    return Object.keys(localStorage).filter(k => k.indexOf(prefix) === 0).map(k => k.slice(prefix.length));
                } catch { return []; }
            }
        };
    })();

    // =======================================================================
    // 2. Defaults, themes, module + section registries
    // =======================================================================
    const THEMES = {
        neverlose: { name: 'Neverlose', bg: '#0b0b11', panel: '#101019', panel2: '#151521', line: '#26263a', text: '#e8e6f2', sub: '#8987a3', accent: '#a970ff', accent2: '#5ad1ff', good: '#7ee787', warn: '#ffcc66', bad: '#ff6b81' },
        midnight: { name: 'Midnight', bg: '#070d18', panel: '#0c1524', panel2: '#111e33', line: '#20334d', text: '#e4f0ff', sub: '#8299b8', accent: '#4aa8ff', accent2: '#48e0c0', good: '#66e0a3', warn: '#ffc857', bad: '#ff6b6b' },
        carbon: { name: 'Carbon', bg: '#0a0a0a', panel: '#111111', panel2: '#181818', line: '#2b2b2b', text: '#ececec', sub: '#8d8d8d', accent: '#e0e0e0', accent2: '#9a9a9a', good: '#8bd88b', warn: '#e8c46a', bad: '#e87575' },
        crimson: { name: 'Crimson', bg: '#10080b', panel: '#180d12', panel2: '#21131a', line: '#3a202b', text: '#f6e9ee', sub: '#a98b96', accent: '#ff4d6d', accent2: '#ff9e6d', good: '#7ee787', warn: '#ffcc66', bad: '#ff6b81' },
        aurora: { name: 'Aurora', bg: '#07110f', panel: '#0c1a18', panel2: '#112622', line: '#1e3d36', text: '#e2f6ef', sub: '#83a99f', accent: '#39e6a8', accent2: '#68b8ff', good: '#66e0a3', warn: '#ffc857', bad: '#ff6b81' },
        violet: { name: 'Violet Storm', bg: '#0a0714', panel: '#120c20', panel2: '#1a1230', line: '#30214d', text: '#efe9ff', sub: '#9b8dbc', accent: '#c07bff', accent2: '#ff77c8', good: '#7ee787', warn: '#ffcc66', bad: '#ff6b81' }
    };
    const THEME_KEYS = Object.keys(THEMES);

    const SECTIONS = [
        { id: 'dashboard', name: 'Dashboard', icon: '◈' },
        { id: 'tracking', name: 'Live Tracking', icon: '◎' },
        { id: 'visuals', name: 'Visuals', icon: '✦' },
        { id: 'hud', name: 'HUD Editor', icon: '▣' },
        { id: 'analyzer', name: 'Beatmap Analyzer', icon: '◫' },
        { id: 'timeline', name: 'Timeline', icon: '⌁' },
        { id: 'audio', name: 'Audio Analysis', icon: '≋' },
        { id: 'inspector', name: 'Object Inspector', icon: '⊕' },
        { id: 'performance', name: 'Performance', icon: '▤' },
        { id: 'session', name: 'Session Statistics', icon: '⧗' },
        { id: 'history', name: 'Playback History', icon: '↺' },
        { id: 'configs', name: 'Configurations', icon: '⛭' },
        { id: 'modules', name: 'Module Manager', icon: '⊞' },
        { id: 'debug', name: 'Debug Console', icon: '⌘' },
        { id: 'settings', name: 'Settings', icon: '⚙' }
    ];

    const MODULES = [
        { id: 'beatmapTimeline', name: 'Beatmap Timeline', desc: 'Interactive timeline of upcoming hit objects.', group: 'Analysis' },
        { id: 'bpmGraph', name: 'BPM Graph', desc: 'BPM changes across the whole song.', group: 'Analysis' },
        { id: 'timingInspector', name: 'Timing Inspector', desc: 'Detailed timing-point information.', group: 'Analysis' },
        { id: 'objectInspector', name: 'Object Inspector', desc: 'Select and inspect hit-object properties.', group: 'Analysis' },
        { id: 'sliderInspector', name: 'Slider Inspector', desc: 'Slider duration, curve and tick data.', group: 'Analysis' },
        { id: 'spinnerInspector', name: 'Spinner Inspector', desc: 'Spinner timing and live progress.', group: 'Analysis' },
        { id: 'difficultyComparison', name: 'Difficulty Comparison', desc: 'Compare the current set\'s difficulties.', group: 'Library' },
        { id: 'sessionStats', name: 'Session Statistics', desc: 'Session duration, plays, FPS and counters.', group: 'Session' },
        { id: 'playbackHistory', name: 'Playback History', desc: 'Recently loaded songs.', group: 'Session' },
        { id: 'favoriteBeatmaps', name: 'Favorite Beatmaps', desc: 'Save and recall beatmaps.', group: 'Session' },
        { id: 'beatmapSearch', name: 'Beatmap Search Panel', desc: 'Search library and live site listing data.', group: 'Library' },
        { id: 'customCrosshair', name: 'Custom Crosshair', desc: 'Adjustable playfield crosshair.', group: 'Visual' },
        { id: 'colorPresets', name: 'Color Presets', desc: 'Save and switch visual color schemes.', group: 'Visual' },
        { id: 'hudProfiles', name: 'HUD Profiles', desc: 'Multiple independent HUD arrangements.', group: 'HUD' },
        { id: 'densityHeatmap', name: 'Object Density Heatmap', desc: 'Visualize dense beatmap sections.', group: 'Analysis' },
        { id: 'audioWaveform', name: 'Audio Waveform', desc: 'Full-song and live waveform from real audio.', group: 'Audio' },
        { id: 'timingDriftGraph', name: 'Timing Drift Graph', desc: 'Audio clock drift over time.', group: 'Audio' },
        { id: 'liveEventLog', name: 'Live Event Log', desc: 'Record game and tracking events.', group: 'Diagnostics' },
        { id: 'debugConsole', name: 'Debug Console', desc: 'Errors, runtime state and diagnostics.', group: 'Diagnostics' },
        { id: 'moduleManager', name: 'Module Manager', desc: 'Enable/disable individual modules.', group: 'System' },
        { id: 'customNotifications', name: 'Custom Notifications', desc: 'Notification appearance and timing.', group: 'System' },
        { id: 'shortcutEditor', name: 'Keyboard Shortcut Editor', desc: 'Assign custom keybinds.', group: 'System' },
        { id: 'compactMode', name: 'Compact Mode', desc: 'Minimal interface for smaller screens.', group: 'System' },
        { id: 'statsExport', name: 'Statistics Export', desc: 'Export session and beatmap statistics.', group: 'Session' },
        { id: 'autoTheme', name: 'Automatic Theme Switching', desc: 'Switch themes from saved preferences.', group: 'System' },
        { id: 'objectPreview', name: 'Object Preview Panel', desc: 'Inspect the next several objects.', group: 'Analysis' },
        { id: 'sectionBookmarks', name: 'Beatmap Section Bookmarks', desc: 'Save interesting timestamps.', group: 'Session' },
        { id: 'configBackup', name: 'Configuration Backup', desc: 'Export all saved settings to one file.', group: 'System' },
        { id: 'integrationDiagnostics', name: 'Integration Diagnostics', desc: 'Find missing/changed WOSU runtime parts.', group: 'Diagnostics' },
        { id: 'performancePresets', name: 'Performance Presets', desc: 'Low-overhead, balanced, detailed modes.', group: 'Performance' }
    ];
    const MODULE_IDS = MODULES.map(m => m.id);

    const HUD_DEFS = [
        { id: 'song', name: 'Song Info', x: 1.2, y: 2.0, w: 300, h: 70, color: '#e9d5ff', opacity: 0.86, font: 13, visible: true },
        { id: 'clock', name: 'Playback Time', x: 1.2, y: 11.0, w: 230, h: 62, color: '#ffffff', opacity: 0.86, font: 15, visible: true },
        { id: 'objects', name: 'Object Counter', x: 1.2, y: 19.0, w: 230, h: 72, color: '#8be9fd', opacity: 0.86, font: 13, visible: true },
        { id: 'fps', name: 'FPS / Frame Time', x: 78.0, y: 2.0, w: 210, h: 66, color: '#7ee787', opacity: 0.86, font: 13, visible: true },
        { id: 'sync', name: 'Audio Sync', x: 78.0, y: 11.0, w: 210, h: 78, color: '#ffd166', opacity: 0.86, font: 13, visible: true },
        { id: 'progress', name: 'Song Progress', x: 25.0, y: 94.0, w: 50, h: 46, color: '#c07bff', opacity: 0.9, font: 12, visible: true },
        { id: 'currentObject', name: 'Current Object', x: 1.2, y: 28.0, w: 250, h: 84, color: '#ff8ab5', opacity: 0.86, font: 13, visible: false },
        { id: 'bpm', name: 'BPM / Timing', x: 78.0, y: 21.0, w: 210, h: 66, color: '#a970ff', opacity: 0.86, font: 13, visible: false },
        { id: 'density', name: 'Object Density', x: 1.2, y: 38.0, w: 230, h: 60, color: '#68b8ff', opacity: 0.86, font: 13, visible: false },
        { id: 'warnings', name: 'Warnings', x: 35.0, y: 2.0, w: 300, h: 56, color: '#ff6b81', opacity: 0.9, font: 13, visible: false }
    ];

    const DEFAULT_KEYBINDS = {
        menu: 'ShiftRight', toggleHud: 'F6', toggleVisuals: 'F7', cyclePreset: 'F8',
        compact: 'Alt+KeyC', nextSection: 'Alt+BracketRight', prevSection: 'Alt+BracketLeft',
        bookmark: 'Alt+KeyB', favorite: 'Alt+KeyF', exportStats: 'Alt+KeyS',
        cycleTheme: 'Alt+KeyT', toggleLightweight: 'Alt+KeyL', toggleCrosshair: 'Alt+KeyX',
        openDebug: 'Alt+KeyD', resetHud: 'Alt+KeyR', openSearch: 'Alt+KeyK'
    };
    const BIND_ACTIONS = [
        { id: 'menu', name: 'Open / close menu' }, { id: 'toggleHud', name: 'Show / hide HUD' },
        { id: 'toggleVisuals', name: 'Toggle visual overlay' }, { id: 'cyclePreset', name: 'Cycle performance preset' },
        { id: 'compact', name: 'Compact mode' }, { id: 'nextSection', name: 'Next sidebar section' },
        { id: 'prevSection', name: 'Previous sidebar section' }, { id: 'bookmark', name: 'Add section bookmark' },
        { id: 'favorite', name: 'Toggle favorite beatmap' }, { id: 'exportStats', name: 'Export statistics' },
        { id: 'cycleTheme', name: 'Cycle theme' }, { id: 'toggleLightweight', name: 'Lightweight rendering' },
        { id: 'toggleCrosshair', name: 'Toggle crosshair' }, { id: 'openDebug', name: 'Open debug console' },
        { id: 'resetHud', name: 'Reset HUD positions' }, { id: 'openSearch', name: 'Focus settings search' }
    ];
    const NOTIFY_TYPES = [
        { id: 'beatmapDetected', name: 'Beatmap detected' }, { id: 'songStarted', name: 'Song started' },
        { id: 'songPaused', name: 'Song paused' }, { id: 'songResumed', name: 'Song resumed' },
        { id: 'beatmapChanged', name: 'Beatmap changed' }, { id: 'syncLost', name: 'Synchronization lost' },
        { id: 'syncRestored', name: 'Synchronization restored' }, { id: 'configLoaded', name: 'Configuration loaded' },
        { id: 'performance', name: 'Performance warning' }, { id: 'trackingInit', name: 'Tracking initialized' },
        { id: 'trackingUnavailable', name: 'Tracking unavailable' }, { id: 'info', name: 'General information' }
    ];

    const DEFAULTS = {
        version: 1,
        theme: 'neverlose', accent: '', accent2: '', uiScale: 1, opacity: 0.96,
        compact: false, sidebarCollapsed: false, hideMenu: false, menuOpen: false,
        menuRect: { x: 0, y: 0, w: 1060, h: 660 }, activeSection: 'dashboard',
        autoTheme: { enabled: false, mode: 'time', dayTheme: 'midnight', nightTheme: 'neverlose', dayStart: 7, nightStart: 19 },
        keybinds: clone(DEFAULT_KEYBINDS),
        notify: { enabled: true, duration: 3800, position: 'top-right', max: 5, radius: 8, blur: 16, opacity: 0.97, customColor: '', types: Object.fromEntries(NOTIFY_TYPES.map(n => [n.id, true])) },
        modules: Object.fromEntries(MODULE_IDS.map(id => [id, true])),
        visuals: {
            enabled: true, minimalHud: false, fullHud: true, trackingRange: 2200, upcomingCount: 8,
            circles: true, approach: true, sliderPaths: true, spinner: true, labels: true, ids: true,
            trails: true, upcoming: true, distance: true, infoPanels: true, densityOverlay: true,
            highlightUpcoming: true, showTimestamps: true, useComboColors: true, outlines: 1.8, alpha: 0.9, style: 'neon',
            objectTrailLength: 260, trailWidth: 1.4, labelSize: 11, showVisibility: true,
            colors: { circle: '#ff5fa2', slider: '#6be5ff', spinner: '#ffd166', approach: '#ffffff', trail: '#a970ff', upcoming: '#7ee787' },
            crosshair: { enabled: false, size: 18, thickness: 2, gap: 5, color: '#ffffff', dot: true, center: true }
        },
        perf: { preset: 'balanced', updateIntervalMs: 100, canvasIntervalMs: 16, historyLength: 120, warnFps: 45, warnFrameMs: 25, lightweight: false, showWarnings: true },
        audio: { showWaveform: true, showSpectrum: true, warnDriftMs: 35, offsetManualMs: 0, driftWindow: 120, showTimingInfo: true },
        hud: { enabled: true, editMode: false, preview: false, activeProfile: 'default', profiles: {}, selected: 'song', elements: Object.fromEntries(HUD_DEFS.map(d => [d.id, clone(d)])) },
        timeline: { windowMs: 14000, zoom: 1, showLabels: true, showBookmarks: true },
        analyzer: { sectionSec: 15, topSections: 6, useAnalysisTarget: true },
        session: { logLimit: 400, diagnostics: true }
    };
    const PERF_PRESETS = {
        low: { name: 'Low Overhead', patch: { perf: { lightweight: true, updateIntervalMs: 250, canvasIntervalMs: 50, historyLength: 60 }, visuals: { trackingRange: 900, upcomingCount: 3, trails: false, infoPanels: false, densityOverlay: false, sliderPaths: false, labels: false } } },
        balanced: { name: 'Balanced', patch: { perf: { lightweight: false, updateIntervalMs: 100, canvasIntervalMs: 24, historyLength: 120 }, visuals: { trackingRange: 2200, upcomingCount: 8, trails: true, infoPanels: true, densityOverlay: true, sliderPaths: true, labels: true } } },
        detailed: { name: 'Detailed', patch: { perf: { lightweight: false, updateIntervalMs: 50, canvasIntervalMs: 16, historyLength: 240 }, visuals: { trackingRange: 4000, upcomingCount: 16, trails: true, infoPanels: true, densityOverlay: true, sliderPaths: true, labels: true, distance: true } } }
    };

    let cfg = mergeDeep(DEFAULTS, Store.get('config', {}));
    cfg.hud.elements = mergeDeep(DEFAULTS.hud.elements, cfg.hud.elements || {});
    cfg.keybinds = mergeDeep(DEFAULT_KEYBINDS, cfg.keybinds || {});
    cfg.notify.types = mergeDeep(DEFAULTS.notify.types, cfg.notify.types || {});
    cfg.modules = mergeDeep(DEFAULTS.modules, cfg.modules || {});
    if (!THEMES[cfg.theme]) cfg.theme = 'neverlose';

    let configs = Store.get('configs', null);
    if (!configs || !Array.isArray(configs.list) || !configs.list.length) {
        const defCfg = { id: 'default', name: 'Default', description: 'Built-in baseline configuration', type: 'full', createdAt: now(), settings: clone(DEFAULTS) };
        configs = { list: [defCfg], activeId: 'default', visualId: 'default', performanceId: 'default' };
    }
    let session = mergeDeep({
        startedAt: now(), plays: 0, beatmapsLoaded: 0, notifications: 0, favorites: [], history: [],
        bookmarks: [], colorPresets: [], eventLog: [], errors: [], stats: { framesObserved: 0, playMs: 0, objectsTracked: 0, maxObjectsOnScreen: 0 }
    }, Store.get('session', {}));

    let saveTimer = null;
    function saveConfig() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            Store.set('config', cfg);
            // keep the active configuration's snapshot in sync automatically
            const c = configs.list.find(x => x.id === configs.activeId);
            if (c && c.type === 'full') c.settings = clone(cfg);
            Store.set('configs', configs);
        }, 350);
    }
    function saveSession() { Store.set('session', session); }
    function saveConfigs() { Store.set('configs', configs); }
    function cfgSaveNow() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } Store.set('config', cfg); }

    // =======================================================================
    // 3. Runtime state
    // =======================================================================
    const R = {
        booted: false, bootAt: now(), probeMode: 'none', probeInstalled: false,
        site: { settings: null, offsets: null, lastBeatmap: '', uiScale: 1, mods: [], modSettings: {}, audioOffset: 0, beatmapOffset: 0, userOffsetMs: 0, rate: 1, hr: false, key: '', file: '' },
        lib: { sets: [], dbOk: false, lastRead: 0, blobs: new Map(), parsed: new Map(), error: '' },
        beatmaps: new Map(), beatmap: null, beatmapKey: '', analysisBeatmap: null, analysisKey: '',
        recentDecodeAt: 0, lastDecoderBeatmap: null, beatmapSource: '',
        audio: {
            ctxTime: 0, ctxState: 'unknown', sampleRate: 0, outputLatencyMs: 0, baseLatencyMs: 0,
            active: null, previous: null, worklet: { inputTime: 0, rate: 1, active: false, updatedAt: 0 },
            decode: null, peaks: null, startOffsetMs: 0, songTime: -1, duration: 0, rate: 1,
            playing: false, inPlay: false, pausedSongTime: 0, offsetMs: 0, driftMs: 0,
            predicted: 0, lastPredictAt: 0, driftHistory: [], lastEvent: 'idle', lastEventAt: 0,
            analyser: null, wave: null, spectrum: null, levels: { rms: 0, peak: 0, bass: 0, mid: 0, treble: 0 },
            lastStart: null, playStartedAt: 0, media: null, syncLost: false
        },
        perf: { frames: 0, frameRate: 0, frameTime: 16.7, ownFps: 0, ownFrameMs: 16.7, renderMs: 0, trackingHz: 0, history: [], fpsHistory: [], frameHistory: [], renderHistory: [], warn: '', lastFrameAt: 0, updateCount: 0, updateAt: now() },
        online: { results: [], lastUrl: '', count: 0 },
        tracking: { status: 'waiting', lastUpdate: 0, currentIndex: -1, visible: 0, drawn: 0, density: 0, spacing: 0, nextObjects: [], selectedIndex: -1, inspectedTime: 0 },
        integration: {}, errors: [], pageErrors: [], notifications: [], ui: { built: false, menu: null, sections: {}, active: 'dashboard', search: '', graphCanvases: [] },
        hud: { built: false, layer: null, widgets: new Map(), drag: null },
        visual: { canvas: null, ctx: null, dpr: 1, w: 0, h: 0, lastDraw: 0, transform: null, canvasEl: null },
        searchIndex: [], lastSettingsPoll: 0, lastLibPoll: 0, lastThemeCheck: 0,
        probe: { hooks: {}, osuCount: 0, apiCount: 0, decodeCount: 0, errors: [] },
        activeConfigName: '', analysisCache: new Map(), timelineHover: -1
    };

    function moduleOn(id) { return !!cfg.modules[id]; }

    function logEvent(type, message, extra) {
        const e = { at: now(), type, message, extra: extra || null };
        session.eventLog.push(e);
        const max = finite(cfg.session.logLimit, 400);
        if (session.eventLog.length > max) session.eventLog.splice(0, session.eventLog.length - max);
        if (type === 'error' || type === 'pageError') {
            R.pageErrors.push(e);
            if (R.pageErrors.length > 100) R.pageErrors.shift();
        }
        if (session.eventLog.length % 8 === 0) saveSession();
        if (R.ui.built && cfg.activeSection === 'debug') refreshActiveSection(true);
    }
    function logError(label, e) {
        const msg = (e && (e.stack || e.message)) || String(e);
        const short = String(msg).split('\n').slice(0, 3).join(' | ');
        R.errors.push({ at: now(), label, message: short });
        if (R.errors.length > 120) R.errors.shift();
        logEvent('error', '[' + label + '] ' + short);
    }
    function notify(type, title, message, duration) {
        if (!cfg.notify.enabled || !moduleOn('customNotifications') || cfg.notify.types[type] === false) return;
        const n = { id: uid(), type, title, message, at: now(), duration: duration || finite(cfg.notify.duration, 3800) };
        R.notifications.push(n);
        session.notifications++;
        logEvent('notification', title + (message ? ' — ' + message : ''));
        renderNotifications();
        setTimeout(() => { const i = R.notifications.indexOf(n); if (i >= 0) { R.notifications.splice(i, 1); renderNotifications(); } }, n.duration);
        if (R.notifications.length > finite(cfg.notify.max, 5)) R.notifications.shift();
    }

    // =======================================================================
    // 4. Runtime probe (installed into the page world before WOSU boots)
    // =======================================================================
    /* Self-contained: no references to the userscript scope. Used both via
       unsafeWindow patching and (fallback) as an injected <script> body. */
    function installProbe(win, emit) {
        if (!win || win.__WO_PROBE__) return win && win.__WO_PROBE__;
        var P = win.__WO_PROBE__ = {
            installedAt: Date.now(), hooks: {}, contexts: [], analysers: [], sources: [], active: null,
            frameCount: 0, frameTimes: [], lastFrameTs: 0, frameRate: 0,
            worklet: { inputTime: 0, rate: 1, active: false, updatedAt: 0 },
            decode: null, startOffsetMs: 0, media: null, osuCount: 0, apiCount: 0, decodeCount: 0,
            errors: [], lastEvents: [], analyserData: null
        };
        var send = function (type, payload) { try { emit(type, payload); } catch (e) { /* never break the page */ } };
        var err = function (label, e) {
            var m = String((e && (e.message || e.stack)) || e).slice(0, 400);
            P.errors.push({ at: Date.now(), label: label, message: m });
            if (P.errors.length > 40) P.errors.shift();
            send('error', { label: label, message: m });
        };
        var pushEvent = function (type, data) {
            var e = { type: type, at: Date.now(), data: data };
            P.lastEvents.push(e); if (P.lastEvents.length > 24) P.lastEvents.shift();
            send('event', e);
        };
        var seenCtx = function (ctx) {
            if (!ctx) return null;
            if (P.contexts.indexOf(ctx) === -1) {
                P.contexts.push(ctx); if (P.contexts.length > 6) P.contexts.shift();
                pushEvent('audioContext', { sampleRate: ctx.sampleRate || 0, state: ctx.state || 'unknown' });
            }
            return ctx;
        };

        // ---- .osu decode: src/beatmap/archive.ts OszArchive.readText ----
        try {
            var TD = win.TextDecoder;
            if (TD && TD.prototype && TD.prototype.decode) {
                var origDecode = TD.prototype.decode;
                TD.prototype.decode = function (input, options) {
                    var out = origDecode.call(this, input, options);
                    try {
                        if (typeof out === 'string' && out.length > 120 && out.length < 8000000) {
                            var head = out.charCodeAt(0) === 0xfeff ? out.slice(1, 40) : out.slice(0, 40);
                            if (/^osu file format v\d+/i.test(head)) {
                                P.osuCount++;
                                send('osu', { text: out, at: Date.now(), index: P.osuCount });
                            }
                        }
                    } catch (e) { /* ignore */ }
                    return out;
                };
                P.hooks.textDecoder = true;
            }
        } catch (e) { err('hook TextDecoder', e); }

        // ---- Audio buffer sources: src/audio/MusicTrack.ts::startSource ----
        try {
            var ABS = win.AudioBufferSourceNode;
            if (ABS && ABS.prototype) {
                var origStart = ABS.prototype.start;
                var origStop = ABS.prototype.stop;
                ABS.prototype.start = function (when, offset, duration) {
                    var res = origStart.apply(this, arguments);
                    try {
                        var ctx = seenCtx(this.context);
                        var buf = this.buffer;
                        var bufDur = buf ? Number(buf.duration) || 0 : 0;
                        var w = typeof when === 'number' && isFinite(when) ? when : (ctx ? ctx.currentTime : 0);
                        var off = typeof offset === 'number' && isFinite(offset) ? offset : 0;
                        var rate = this.playbackRate ? Number(this.playbackRate.value) || 1 : 1;
                        var rec = {
                            node: this, ctx: ctx, when: w, offset: off, rate: rate, duration: bufDur,
                            startedAt: Date.now(), ctxAtStart: ctx ? ctx.currentTime : 0,
                            sampleRate: ctx ? ctx.sampleRate : 0, stopped: false, natural: false
                        };
                        if (bufDur >= 5) {
                            P.active = rec; P.sources.push(rec);
                            if (P.sources.length > 24) P.sources.shift();
                            pushEvent('sourceStart', {
                                when: w, offset: off, rate: rate, duration: bufDur,
                                ctxAtStart: ctx ? ctx.currentTime : 0, scheduled: w - (ctx ? ctx.currentTime : 0)
                            });
                        } else {
                            P.analyserData = P.analyserData || null;
                        }
                    } catch (e) { err('capture sourceStart', e); }
                    return res;
                };
                ABS.prototype.stop = function () {
                    var res;
                    try { res = origStop.apply(this, arguments); } catch (e) { throw e; }
                    try {
                        var rec = null;
                        for (var i = P.sources.length - 1; i >= 0; i--) if (P.sources[i].node === this) { rec = P.sources[i]; break; }
                        if (rec && !rec.stopped && rec.duration >= 5) {
                            rec.stopped = true;
                            rec.stoppedAt = rec.ctx ? rec.ctx.currentTime : 0;
                            pushEvent('sourceStop', { ctxAtStop: rec.stoppedAt, duration: rec.duration });
                        }
                    } catch (e) { err('capture sourceStop', e); }
                    return res;
                };
                P.hooks.bufferSource = true;
            }
        } catch (e) { err('hook AudioBufferSourceNode', e); }

        // ---- decoded music buffers: waveform + leading silence ----
        try {
            var BAC = win.BaseAudioContext || (win.AudioContext && win.AudioContext.prototype);
            if (BAC && BAC.prototype && BAC.prototype.decodeAudioData) {
                var origDecodeAudio = BAC.prototype.decodeAudioData;
                var captured = new WeakSet();
                BAC.prototype.decodeAudioData = function (data, ok, fail) {
                    var self = this;
                    seenCtx(self);
                    var done = false;
                    var handle = function (decoded) {
                        if (done || !decoded || captured.has(decoded)) return;
                        done = true; captured.add(decoded);
                        try {
                            var dur = Number(decoded.duration) || 0;
                            if (dur > 10) {
                                P.decodeCount++;
                                var ch = decoded.getChannelData(0);
                                var len = ch.length, sr = decoded.sampleRate || 44100;
                                var buckets = 512, peaks = new Array(buckets);
                                var step = Math.max(1, Math.floor(len / buckets));
                                for (var b = 0; b < buckets; b++) {
                                    var s = b * step, e2 = Math.min(len, s + step), peak = 0;
                                    for (var i = s; i < e2; i += 4) { var v = ch[i] < 0 ? -ch[i] : ch[i]; if (v > peak) peak = v; }
                                    peaks[b] = Math.round(Math.min(1, peak) * 1000) / 1000;
                                }
                                var silence = 0, lim = Math.min(len, Math.floor(sr * 0.4));
                                for (var j = 0; j < lim; j++) { if ((ch[j] < 0 ? -ch[j] : ch[j]) > 0.0025) { silence = j; break; } }
                                var leadMs = Math.round(silence / sr * 1000);
                                P.startOffsetMs = leadMs;
                                P.decode = { duration: dur, channels: decoded.numberOfChannels || 1, sampleRate: sr, leadingSilenceMs: leadMs };
                                send('decode', { duration: dur, channels: decoded.numberOfChannels || 1, sampleRate: sr, leadingSilenceMs: leadMs, peaks: peaks });
                            }
                        } catch (e2) { err('analyse decoded audio', e2); }
                    };
                    var wrappedOk = typeof ok === 'function' ? function (d) { handle(d); ok(d); } : undefined;
                    var ret;
                    try { ret = origDecodeAudio.call(this, data, wrappedOk, fail); } catch (e) { throw e; }
                    if (ret && typeof ret.then === 'function') {
                        ret.then(function (d) { handle(d); }, function () { /* handled by page */ });
                    }
                    return ret;
                };
                P.hooks.decodeAudioData = true;
            }
        } catch (e) { err('hook decodeAudioData', e); }

        // ---- music analyser: src/audio/AudioEngine.ts::build ----
        try {
            var CAC = win.AudioContext || win.webkitAudioContext;
            if (CAC && CAC.prototype && CAC.prototype.createAnalyser) {
                var origAnalyser = CAC.prototype.createAnalyser;
                CAC.prototype.createAnalyser = function () {
                    var node = origAnalyser.apply(this, arguments);
                    try { seenCtx(this); P.analysers.push(node); if (P.analysers.length > 6) P.analysers.shift(); P.hooks.analyser = true; } catch (e) { /* ignore */ }
                    return node;
                };
                var origCreateBuffer = CAC.prototype.createBufferSource;
                if (origCreateBuffer) CAC.prototype.createBufferSource = function () { seenCtx(this); return origCreateBuffer.apply(this, arguments); };
            }
            if (CAC && CAC.prototype) {
                ['suspend', 'resume', 'close'].forEach(function (name) {
                    var orig = CAC.prototype[name];
                    if (!orig) return;
                    CAC.prototype[name] = function () {
                        var res;
                        try { res = orig.apply(this, arguments); } catch (e) { throw e; }
                        try { seenCtx(this); pushEvent('ctx' + name, { state: this.state }); } catch (e) { /* ignore */ }
                        return res;
                    };
                });
                P.hooks.audioContext = true;
            }
        } catch (e) { err('hook AudioContext', e); }

        // ---- pitch-preserving worklet (SignalsmithStretch) ----
        try {
            var MP = win.MessagePort;
            if (MP && MP.prototype) {
                var origPost = MP.prototype.postMessage;
                MP.prototype.postMessage = function (msg, transfer) {
                    try {
                        if (Array.isArray(msg) && typeof msg[1] === 'string') {
                            if (msg[1] === 'start') {
                                P.worklet.active = true; P.worklet.updatedAt = Date.now();
                                if (typeof msg[5] === 'number') P.worklet.rate = msg[5];
                                pushEvent('workletStart', { when: msg[2], offset: msg[3], rate: msg[5], semitones: msg[6] });
                            } else if (msg[1] === 'stop') {
                                P.worklet.active = false;
                                pushEvent('workletStop', { when: msg[2] });
                            } else if (msg[1] === 'setRate' && typeof msg[2] === 'number') {
                                P.worklet.rate = msg[2];
                            }
                        }
                    } catch (e) { /* ignore */ }
                    return origPost.call(this, msg, transfer);
                };
                var desc = Object.getOwnPropertyDescriptor(MP.prototype, 'onmessage');
                if (desc && desc.get && desc.set) {
                    Object.defineProperty(MP.prototype, 'onmessage', {
                        configurable: true, enumerable: desc.enumerable,
                        get: function () { return desc.get.call(this); },
                        set: function (fn) {
                            var self = this;
                            return desc.set.call(this, typeof fn === 'function' ? function (ev) {
                                try {
                                    var d = ev && ev.data;
                                    if (Array.isArray(d) && d[0] === 'time' && typeof d[1] === 'number') {
                                        P.worklet.inputTime = d[1]; P.worklet.active = true; P.worklet.updatedAt = Date.now();
                                    }
                                } catch (e) { /* ignore */ }
                                return fn.call(self, ev);
                            } : fn);
                        }
                    });
                }
                P.hooks.worklet = true;
            }
        } catch (e) { err('hook MessagePort', e); }

        // ---- online beatmap API responses: src/online/BeatmapApi.ts ----
        try {
            var Resp = win.Response;
            if (Resp && Resp.prototype && Resp.prototype.text) {
                var origText = Resp.prototype.text;
                Resp.prototype.text = function () {
                    var self = this;
                    return origText.call(this).then(function (txt) {
                        try {
                            var url = self.url || '';
                            if (url && /(sayobot|catboy|nerinyan|mino|beatmap|\/api\/)/i.test(url) && typeof txt === 'string' && txt.length < 900000) {
                                P.apiCount++;
                                send('api', { url: url, text: txt, at: Date.now(), index: P.apiCount });
                            }
                        } catch (e) { /* ignore */ }
                        return txt;
                    });
                };
                P.hooks.responseText = true;
            }
        } catch (e) { err('hook Response.text', e); }

        // ---- HTMLAudioElement previews: src/audio/PreviewPlayer.ts ----
        try {
            var HME = win.HTMLMediaElement;
            if (HME && HME.prototype) {
                var origPlay = HME.prototype.play;
                HME.prototype.play = function () {
                    var res;
                    try { res = origPlay.apply(this, arguments); } catch (e) { throw e; }
                    try { send('media', { state: 'playing', src: this.src || '', currentTime: this.currentTime || 0, duration: this.duration || 0, at: Date.now() }); } catch (e) { /* ignore */ }
                    return res;
                };
                var origPause = HME.prototype.pause;
                HME.prototype.pause = function () {
                    try { send('media', { state: 'paused', src: this.src || '', currentTime: this.currentTime || 0, duration: this.duration || 0, at: Date.now() }); } catch (e) { /* ignore */ }
                    return origPause.apply(this, arguments);
                };
                P.hooks.media = true;
            }
        } catch (e) { err('hook HTMLMediaElement', e); }

        // ---- frame loop: src/app/FrameLoop.ts ----
        try {
            var origRAF = win.requestAnimationFrame;
            if (origRAF) {
                win.requestAnimationFrame = function (cb) {
                    return origRAF.call(win, function (ts) {
                        P.frameCount++;
                        if (P.lastFrameTs) {
                            var d = ts - P.lastFrameTs;
                            if (d > 0 && d < 2000) {
                                P.frameTimes.push(d);
                                if (P.frameTimes.length > 90) P.frameTimes.shift();
                            }
                        }
                        P.lastFrameTs = ts;
                        try { return cb(ts); } catch (e) { err('rAF callback', e); throw e; }
                    });
                };
                P.hooks.raf = true;
            }
        } catch (e) { err('hook requestAnimationFrame', e); }

        // ---- page errors ----
        try {
            win.addEventListener('error', function (ev) {
                send('pageError', { message: String(ev.message || 'error').slice(0, 300), source: String(ev.filename || ''), line: ev.lineno || 0, at: Date.now() });
            });
            win.addEventListener('unhandledrejection', function (ev) {
                var reason = ev.reason;
                send('pageError', { message: String((reason && (reason.message || reason)) || 'unhandled rejection').slice(0, 300), source: 'promise', line: 0, at: Date.now() });
            });
            if (win.console && win.console.error) {
                var origErr = win.console.error;
                win.console.error = function () {
                    try {
                        var parts = Array.prototype.slice.call(arguments, 0, 4).map(function (x) { return String(x && x.message ? x.message : x).slice(0, 220); });
                        send('consoleError', { message: parts.join(' '), at: Date.now() });
                    } catch (e) { /* ignore */ }
                    return origErr.apply(this, arguments);
                };
            }
            P.hooks.errors = true;
        } catch (e) { err('hook errors', e); }

        // ---- periodic state ----
        var stateTimer = win.setInterval(function () {
            try {
                var ctx = null;
                if (P.active && P.active.ctx) ctx = P.active.ctx;
                for (var i = P.contexts.length - 1; i >= 0; i--) if (P.contexts[i] && P.contexts[i].state !== 'closed') { ctx = P.contexts[i]; break; }
                var ctxTime = ctx ? ctx.currentTime : 0;
                var ft = P.frameTimes.slice(-60);
                var avg = ft.length ? ft.reduce(function (a, b) { return a + b; }, 0) / ft.length : 0;
                P.frameRate = avg > 0 ? 1000 / avg : 0;
                var active = null;
                if (P.active) {
                    var a = P.active;
                    var naturalEnd = a.duration > 0 && ctxTime > a.when + (a.duration - a.offset) / Math.max(0.01, a.rate);
                    if (a.stopped || naturalEnd) {
                        if (naturalEnd && !a.stopped) { a.stopped = true; a.natural = true; pushEvent('sourceEnd', { duration: a.duration }); }
                        active = null;
                    } else {
                        var pr = a.node && a.node.playbackRate ? Number(a.node.playbackRate.value) : a.rate;
                        if (isFinite(pr) && pr > 0.01) a.rate = pr;
                        active = {
                            when: a.when, offset: a.offset, rate: a.rate, duration: a.duration,
                            startedAt: a.startedAt, ctxAtStart: a.ctxAtStart, scheduled: a.when - a.ctxAtStart
                        };
                    }
                }
                var an = null;
                var node = P.analysers.length ? P.analysers[P.analysers.length - 1] : null;
                if (node && node.fftSize) {
                    try {
                        var bins = node.frequencyBinCount || 1024;
                        var freq = new Uint8Array(bins);
                        node.getByteFrequencyData(freq);
                        var spectrum = new Array(32), wave = new Array(64);
                        for (var s = 0; s < 32; s++) {
                            var from = Math.floor(Math.pow(s / 32, 1.7) * bins), to = Math.max(from + 1, Math.floor(Math.pow((s + 1) / 32, 1.7) * bins));
                            var sum = 0; for (var q = from; q < to && q < bins; q++) sum += freq[q];
                            spectrum[s] = Math.round(sum / Math.max(1, to - from) / 255 * 1000) / 1000;
                        }
                        var td = new Uint8Array(node.fftSize || 2048);
                        node.getByteTimeDomainData(td);
                        var peak = 0, sumSq = 0;
                        for (var w = 0; w < 64; w++) {
                            var p = td[Math.floor(w * td.length / 64)] - 128;
                            wave[w] = Math.round(p / 128 * 1000) / 1000;
                            peak = Math.max(peak, Math.abs(p) / 128); sumSq += (p / 128) * (p / 128);
                        }
                        var bass = spectrum.slice(0, 6).reduce(function (x, y) { return x + y; }, 0) / 6;
                        var mid = spectrum.slice(6, 18).reduce(function (x, y) { return x + y; }, 0) / 12;
                        var treble = spectrum.slice(18, 32).reduce(function (x, y) { return x + y; }, 0) / 14;
                        an = { wave: wave, spectrum: spectrum, rms: Math.sqrt(sumSq / 64), peak: peak, bass: bass, mid: mid, treble: treble };
                    } catch (e) { /* analyser may be gone */ }
                }
                send('state', {
                    at: Date.now(), ctxTime: ctxTime, ctxState: ctx ? ctx.state : 'unknown',
                    sampleRate: ctx ? ctx.sampleRate : 0,
                    outputLatencyMs: ctx && isFinite(ctx.outputLatency) ? ctx.outputLatency * 1000 : 0,
                    baseLatencyMs: ctx && isFinite(ctx.baseLatency) ? ctx.baseLatency * 1000 : 0,
                    active: active, worklet: { inputTime: P.worklet.inputTime, rate: P.worklet.rate, active: P.worklet.active && Date.now() - P.worklet.updatedAt < 600, updatedAt: P.worklet.updatedAt },
                    frames: P.frameCount, frameRate: P.frameRate, frameTime: avg,
                    analyser: an, decode: P.decode, startOffsetMs: P.startOffsetMs, media: P.media,
                    hooks: P.hooks, osuCount: P.osuCount, apiCount: P.apiCount, decodeCount: P.decodeCount,
                    errors: P.errors.slice(-4)
                });
            } catch (e) { err('probe tick', e); }
        }, 50);
        P.stateTimer = stateTimer;
        send('ready', { at: Date.now(), hooks: P.hooks });
        return P;
    }

    function onProbe(type, payload) {
        switch (type) {
            case 'ready':
                R.probeInstalled = true;
                R.probe.hooks = payload.hooks || {};
                logEvent('probe', 'Runtime probe attached (' + R.probeMode + ')');
                break;
            case 'osu':
                R.probe.osuCount = payload.index;
                onDecodedOsu(payload.text, payload.at);
                break;
            case 'decode':
                R.probe.decodeCount++;
                R.audio.decode = { duration: payload.duration, channels: payload.channels, sampleRate: payload.sampleRate, leadingSilenceMs: payload.leadingSilenceMs };
                R.audio.peaks = payload.peaks;
                R.audio.startOffsetMs = payload.leadingSilenceMs;
                logEvent('audio', 'Decoded music buffer: ' + fmtTime(payload.duration * 1000) + ', ' + payload.channels + 'ch @ ' + payload.sampleRate + ' Hz');
                break;
            case 'api':
                R.probe.apiCount = payload.index;
                onApiResponse(payload.url, payload.text);
                break;
            case 'state':
                updateAudioState(payload);
                updatePerfState(payload);
                break;
            case 'event':
                onProbeEvent(payload);
                break;
            case 'media':
                R.audio.media = payload;
                break;
            case 'error':
                R.probe.errors.push({ at: now(), label: payload.label, message: payload.message });
                if (R.probe.errors.length > 40) R.probe.errors.shift();
                logError('probe:' + payload.label, payload.message);
                break;
            case 'pageError':
                R.pageErrors.push({ at: now(), message: payload.message, source: payload.source, line: payload.line });
                if (R.pageErrors.length > 100) R.pageErrors.shift();
                logEvent('pageError', 'WOSU: ' + payload.message);
                break;
            case 'consoleError':
                logEvent('console', payload.message);
                break;
        }
    }

    function initProbe() {
        var uw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : null;
        if (uw && uw.TextDecoder && uw.AudioBufferSourceNode) {
            try {
                installProbe(uw, onProbe);
                R.probeMode = 'unsafeWindow';
                return;
            } catch (e) { logError('unsafeWindow probe', e); }
        }
        // Fallback: inject a classic script so the hooks live in the page world.
        try {
            var src = '(' + installProbe.toString() + ')(window, function(t,p){ window.postMessage({ source:"wo-probe", type:t, payload:p }, "*"); });';
            var s = document.createElement('script');
            s.textContent = src;
            s.setAttribute('data-wo-probe', '1');
            (document.documentElement || document.head || document.body || document).appendChild(s);
            window.addEventListener('message', function (ev) {
                var d = ev.data;
                if (!d || d.source !== 'wo-probe' || !ev.source || ev.origin !== location.origin) return;
                try { onProbe(d.type, d.payload); } catch (e) { logError('probe message', e); }
            });
            R.probeMode = 'injected';
        } catch (e) { logError('inject probe', e); R.probeMode = 'failed'; }
    }

    // =======================================================================
    // 5. Beatmap parsing — faithful port of src/beatmap/parser.ts
    // =======================================================================
    function readKeyValue(line, into) { const i = line.indexOf(':'); if (i > 0) into[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    function num(v, fallback) { if (v === undefined || String(v).trim() === '') return fallback; const n = Number(v); return Number.isFinite(n) ? n : fallback; }
    function clampVal(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function toSampleSet(n) { n = Math.trunc(num(n, 0)); return n >= 0 && n <= 3 ? n : 0; }
    function splitCsv(line) {
        if (line.indexOf('"') === -1) return line.split(',');
        const out = []; let cur = '', quoted = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { quoted = !quoted; cur += ch; }
            else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
            else cur += ch;
        }
        out.push(cur); return out;
    }
    function unquote(s) { s = String(s).trim(); if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1); return s.replace(/\\/g, '/'); }
    function parseHitSample(s) {
        const p = String(s || '').split(':');
        return { normalSet: toSampleSet(p[0]), additionSet: toSampleSet(p[1]), index: Math.trunc(num(p[2], 0)), volume: clampVal(num(p[3], 0), 0, 100), filename: (p[4] || '').trim() };
    }
    function parseOsu(text) {
        if (typeof text !== 'string') return { formatVersion: 14, general: {}, metadata: {}, difficulty: {}, events: { breaks: [] }, timingPoints: [], colours: [], hitObjects: [], comboColors: [] };
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        const lines = text.split(/\r\n|\r|\n/);
        let formatVersion = 14, section = '', sawHeader = false;
        const general = {}, metadata = {}, difficulty = {}, eventRows = [], timingRows = [], colourRows = [], objectRows = [];
        for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith('//')) continue;
            if (!sawHeader) {
                sawHeader = true;
                const m = /^osu file format v(\d+)/i.exec(line);
                if (m) { formatVersion = Number(m[1]); continue; }
            }
            if (line.startsWith('[') && line.endsWith(']')) { section = line.slice(1, -1); continue; }
            switch (section) {
                case 'General': readKeyValue(line, general); break;
                case 'Metadata': readKeyValue(line, metadata); break;
                case 'Difficulty': readKeyValue(line, difficulty); break;
                case 'Events': eventRows.push(line); break;
                case 'TimingPoints': timingRows.push(line); break;
                case 'Colours': { const i = line.indexOf(':'); if (i > 0) colourRows.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); break; }
                case 'HitObjects': objectRows.push(line); break;
            }
        }
        const set = String(general.SampleSet || '').toLowerCase();
        const gen = {
            audioFilename: general.AudioFilename || '', audioLeadIn: Math.max(0, num(general.AudioLeadIn, 0)),
            previewTime: num(general.PreviewTime, -1), countdown: num(general.Countdown, 1),
            countdownOffset: Math.trunc(num(general.CountdownOffset, 0)),
            sampleSet: set === 'soft' ? 2 : set === 'drum' ? 3 : 1,
            stackLeniency: clampVal(num(general.StackLeniency, 0.7), 0, 1),
            mode: Math.trunc(num(general.Mode, 0)),
            letterboxInBreaks: general.LetterboxInBreaks === '1', widescreenStoryboard: general.WidescreenStoryboard === '1'
        };
        const title = metadata.Title || '', artist = metadata.Artist || '';
        const meta = {
            title, titleUnicode: metadata.TitleUnicode || title, artist, artistUnicode: metadata.ArtistUnicode || artist,
            creator: metadata.Creator || '', version: metadata.Version || '', source: metadata.Source || '', tags: metadata.Tags || '',
            beatmapId: Math.trunc(num(metadata.BeatmapID, 0)), beatmapSetId: Math.trunc(num(metadata.BeatmapSetID, -1))
        };
        const od = clampVal(num(difficulty.OverallDifficulty, 5), 0, 10);
        const hasOd = difficulty.OverallDifficulty !== undefined;
        const diff = {
            overallDifficulty: od, approachRate: clampVal(num(difficulty.ApproachRate, od), 0, 10),
            hpDrainRate: clampVal(num(difficulty.HPDrainRate, hasOd ? od : 5), 0, 10),
            circleSize: clampVal(num(difficulty.CircleSize, hasOd ? od : 5), 0, 10),
            sliderMultiplier: clampVal(num(difficulty.SliderMultiplier, 1.4) || 1.4, 0.4, 3.6),
            sliderTickRate: clampVal(num(difficulty.SliderTickRate, 1) || 1, 0.5, 8)
        };
        const events = { backgroundFile: null, video: null, breaks: [] };
        for (const row of eventRows) {
            const f = splitCsv(row), type = f[0].trim();
            if ((type === '0' || type === 'Background') && !events.backgroundFile && f.length >= 3) events.backgroundFile = unquote(f[2]) || null;
            else if ((type === '1' || type === 'Video') && !events.video && f.length >= 3) events.video = { filename: unquote(f[2]), offset: num(f[1], 0) };
            else if ((type === '2' || type === 'Break') && f.length >= 3) {
                const a = Number(f[1]), b = Number(f[2]);
                if (Number.isFinite(a) && Number.isFinite(b) && b > a) events.breaks.push({ startTime: a, endTime: b });
            }
        }
        events.breaks.sort((a, b) => a.startTime - b.startTime);
        const comboColors = [], colourMap = {};
        for (const [key, value] of colourRows) {
            const p = value.split(',').map(s => Number(s.trim()));
            if (p.length < 3 || p.slice(0, 3).some(n => !Number.isFinite(n))) continue;
            const c = i => clampVal(Math.round(p[i]), 0, 255);
            const color = (c(0) << 16) | (c(1) << 8) | c(2);
            if (key === 'SliderTrackOverride') colourMap.trackOverride = color;
            else if (key === 'SliderBorder') colourMap.border = color;
            else { const m = /^Combo(\d+)$/i.exec(key); if (m) comboColors.push([Number(m[1]), color]); }
        }
        comboColors.sort((a, b) => a[0] - b[0]);
        const timingPoints = [];
        for (const row of timingRows) {
            const p = row.split(',');
            if (p.length < 2) continue;
            const time = Number(p[0]); let beatLength = Number(p[1]);
            let uninherited = p.length >= 7 ? p[6].trim() !== '0' : true;
            const noTicks = Number.isNaN(beatLength) && !uninherited;
            if (noTicks) beatLength = -100;
            if (!Number.isFinite(time) || !Number.isFinite(beatLength)) continue;
            if (beatLength < 0) uninherited = false;
            const effects = Math.trunc(num(p[7], 0));
            const clamped = uninherited ? clampVal(beatLength, 6, 60000) : beatLength;
            const tp = {
                time, beatLength: clamped, meter: Math.max(1, Math.trunc(num(p[2], 4)) || 4),
                sampleSet: toSampleSet(p[3]), sampleIndex: Math.trunc(num(p[4], 0)),
                volume: clampVal(num(p[5], 100), 0, 100), uninherited,
                kiai: (effects & 1) !== 0, omitFirstBarLine: (effects & 8) !== 0
            };
            if (clamped !== beatLength && beatLength > 0) tp.rawBeatLength = beatLength;
            if (noTicks) tp.generateTicks = false;
            timingPoints.push(tp);
        }
        const hitObjects = [];
        for (const row of objectRows) {
            const p = row.split(',');
            if (p.length < 4) continue;
            const x = Number(p[0]), y = Number(p[1]), time = Number(p[2]), type = Math.trunc(num(p[3], 0));
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(time)) continue;
            if (Math.abs(x) > 131072 || Math.abs(y) > 131072) continue;
            const base = { x, y, time, newCombo: (type & 4) !== 0, comboSkip: (type >> 4) & 7, hitSound: Math.trunc(num(p[4], 0)) & 15 };
            if (type & 1) hitObjects.push({ kind: 'circle', ...base, hitSample: parseHitSample(p[5]) });
            else if (type & 2) {
                if (p.length < 6) continue;
                const parts = String(p[5] || '').split('|');
                let curveType = 'B'; const controlPoints = [];
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim(); if (!part) continue;
                    if (i === 0 && /^[BLPC]$/i.test(part)) { curveType = part.toUpperCase(); continue; }
                    const xy = part.split(':'), px = Number(xy[0]), py = Number(xy[1]);
                    if (Number.isFinite(px) && Number.isFinite(py)) controlPoints.push({ x: px, y: py });
                }
                let slides = Math.trunc(num(p[6], 1)); if (!(slides >= 1)) slides = 1; slides = Math.min(slides, 9000);
                let pixelLength = num(p[7], 0); if (pixelLength > 131072) continue; if (!(pixelLength >= 0)) pixelLength = 0;
                const hitSample = parseHitSample(p[10]);
                const nodes = slides + 1, edgeSounds = [], edgeSets = [];
                const soundParts = p[8] ? p[8].split('|') : [], setParts = p[9] ? p[9].split('|') : [];
                for (let i = 0; i < nodes; i++) {
                    edgeSounds.push(i < soundParts.length ? Math.trunc(num(soundParts[i], 0)) & 15 : base.hitSound);
                    if (i < setParts.length) {
                        const s = setParts[i].split(':');
                        edgeSets.push({ normalSet: toSampleSet(s[0]), additionSet: toSampleSet(s[1]) });
                    } else edgeSets.push({ normalSet: hitSample.normalSet, additionSet: hitSample.additionSet });
                }
                hitObjects.push({ kind: 'slider', ...base, hitSample, curveType, controlPoints, slides, pixelLength, edgeSounds, edgeSets });
            } else if (type & 8) {
                let endTime = Number(p[5]); if (!Number.isFinite(endTime)) continue; if (endTime < time) endTime = time + 1;
                hitObjects.push({ kind: 'spinner', ...base, endTime, hitSample: parseHitSample(p[6]) });
            }
        }
        hitObjects.sort((a, b) => a.time - b.time);
        return {
            formatVersion, general: gen, metadata: meta, difficulty: diff, events, timingPoints,
            comboColors: comboColors.map(c => c[1]), sliderTrackOverride: colourMap.trackOverride ?? null,
            sliderBorder: colourMap.border ?? null, hitObjects
        };
    }

    // =======================================================================
    // 6. Slider geometry — port of src/beatmap/curves.ts
    // =======================================================================
    const V = (x, y) => ({ x, y });
    const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    function bezierApprox(points, steps) {
        if (points.length < 2) return points.length ? [V(points[0].x, points[0].y)] : [];
        const n = points.length, out = [];
        for (let s = 0; s <= steps; s++) {
            const t = s / steps, work = points.map(p => V(p.x, p.y));
            for (let k = 1; k < n; k++) for (let i = 0; i < n - k; i++) {
                work[i].x = work[i].x + (work[i + 1].x - work[i].x) * t;
                work[i].y = work[i].y + (work[i + 1].y - work[i].y) * t;
            }
            out.push(work[0]);
        }
        return out;
    }
    function catmullApprox(points, detail) {
        const out = [], n = points.length;
        if (n === 0) return out;
        if (n === 1) return [V(points[0].x, points[0].y)];
        for (let i = 0; i < n - 1; i++) {
            const v1 = i > 0 ? points[i - 1] : points[i], v2 = points[i], v3 = points[i + 1];
            const v4 = i < n - 2 ? points[i + 2] : V(2 * v3.x - v2.x, 2 * v3.y - v2.y);
            for (let c = 0; c <= detail; c++) {
                const t = c / detail, t2 = t * t, t3 = t2 * t;
                out.push(V(
                    0.5 * (2 * v2.x + (-v1.x + v3.x) * t + (2 * v1.x - 5 * v2.x + 4 * v3.x - v4.x) * t2 + (-v1.x + 3 * v2.x - 3 * v3.x + v4.x) * t3),
                    0.5 * (2 * v2.y + (-v1.y + v3.y) * t + (2 * v1.y - 5 * v2.y + 4 * v3.y - v4.y) * t2 + (-v1.y + 3 * v2.y - 3 * v3.y + v4.y) * t3)
                ));
            }
        }
        return out;
    }
    function circularArc(cp) {
        if (cp.length !== 3) return null;
        const [a, b, c] = cp;
        const cross = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
        if (Math.abs(cross) <= 1e-3) return null;
        const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
        if (Math.abs(d) < 1e-9) return null;
        const aSq = a.x * a.x + a.y * a.y, bSq = b.x * b.x + b.y * b.y, cSq = c.x * c.x + c.y * c.y;
        const centre = V((aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d, (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d);
        const radius = Math.hypot(a.x - centre.x, a.y - centre.y);
        if (!Number.isFinite(radius) || radius > 1e5) return null;
        const start = Math.atan2(a.y - centre.y, a.x - centre.x);
        let end = Math.atan2(c.y - centre.y, c.x - centre.x);
        while (end < start) end += 2 * Math.PI;
        let direction = 1, range = end - start;
        const ox = c.y - a.y, oy = -(c.x - a.x);
        if (ox * (b.x - a.x) + oy * (b.y - a.y) < 0) { direction = -1; range = 2 * Math.PI - range; }
        const count = Math.max(2, Math.min(999, Math.ceil(range / (2 * Math.acos(1 - 0.1 / Math.max(0.1, radius))))));
        const out = [];
        for (let i = 0; i < count; i++) {
            const th = start + direction * (i / (count - 1)) * range;
            out.push(V(centre.x + Math.cos(th) * radius, centre.y + Math.sin(th) * radius));
        }
        return out;
    }
    function approxSegment(type, cp) {
        if (type === 'L') return cp.map(p => V(p.x, p.y));
        if (type === 'P' && cp.length === 3) { const arc = circularArc(cp); if (arc && arc.length) return arc; }
        if (type === 'C') return catmullApprox(cp, 50);
        return bezierApprox(cp, 60);
    }
    const samePoint = (a, b) => a.x === b.x && a.y === b.y;
    function calculatePath(head, type, cps) {
        const vertices = [V(head.x, head.y), ...cps.map(p => V(p.x, p.y))];
        if (vertices.length < 2) return vertices;
        let segments;
        if (type === 'L') segments = [vertices];
        else {
            segments = []; let start = 0;
            for (let i = 1; i < vertices.length; i++) {
                if (samePoint(vertices[i], vertices[i - 1])) { if (i - start >= 2) segments.push(vertices.slice(start, i)); start = i; }
            }
            if (vertices.length - start >= 2) segments.push(vertices.slice(start));
        }
        const path = [];
        for (const seg of segments) {
            const sub = approxSegment(type, seg);
            let j = 0;
            if (path.length && sub.length && samePoint(path[path.length - 1], sub[0])) j = 1;
            for (; j < sub.length; j++) if (Number.isFinite(sub[j].x) && Number.isFinite(sub[j].y)) path.push(sub[j]);
        }
        return path;
    }
    function makePath(raw, length) {
        return {
            points: raw, length,
            pointAt(t) {
                const pts = raw; if (!(t > 0)) return V(pts[0].x, pts[0].y);
                const last = pts[pts.length - 1]; if (t >= 1) return V(last.x, last.y);
                let lo = 0, hi = pts.length - 1;
                while (hi - lo > 1) { const mid = (lo + hi + 1) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
                const a = pts[lo], b = pts[lo + 1] || a, span = b.t - a.t;
                const u = span > 1e-12 ? (t - a.t) / span : 0;
                return V(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
            }
        };
    }
    function createSliderPath(head, type, cps, pixelLength) {
        const path = calculatePath(head, type, cps);
        const degenerate = () => makePath([{ x: head.x, y: head.y, t: 0 }, { x: head.x, y: head.y, t: 1 }], 0);
        if (path.length < 2) return degenerate();
        const cumulative = [0]; let calculated = 0;
        for (let i = 0; i < path.length - 1; i++) { calculated += dist2(path[i], path[i + 1]); cumulative.push(calculated); }
        const expected = pixelLength > 0 && Number.isFinite(pixelLength) ? pixelLength : null;
        if (expected !== null && calculated !== expected) {
            const n = path.length, lastTwoEqual = samePoint(path[n - 1], path[n - 2]);
            if (!(lastTwoEqual && expected > calculated)) {
                cumulative.pop(); let end = path.length - 1;
                if (calculated > expected) {
                    while (cumulative.length && cumulative[cumulative.length - 1] >= expected) { cumulative.pop(); path.splice(end--, 1); }
                }
                if (end <= 0) return degenerate();
                const from = path[end - 1], d = dist2(from, path[end]);
                const dir = d > 1e-9 ? V((path[end].x - from.x) / d, (path[end].y - from.y) / d) : V(0, 0);
                const remaining = expected - cumulative[cumulative.length - 1];
                path[end] = V(from.x + dir.x * remaining, from.y + dir.y * remaining);
                cumulative.push(expected);
            }
        }
        const length = cumulative[cumulative.length - 1];
        if (!(length > 1e-9)) return degenerate();
        const points = [];
        for (let i = 0; i < path.length; i++) {
            const t = Math.min(1, cumulative[i] / length), prev = points[points.length - 1];
            if (prev && Math.abs(path[i].x - prev.x) < 1e-9 && Math.abs(path[i].y - prev.y) < 1e-9) continue;
            points.push({ x: path[i].x, y: path[i].y, t });
        }
        if (points.length < 2) return degenerate();
        points[0].t = 0; points[points.length - 1].t = 1;
        return makePath(points, length);
    }

    // =======================================================================
    // 7. Playable beatmap — port of src/beatmap/processing.ts + controlPoints.ts
    // =======================================================================
    function sliderVelocityOf(bl) { if (!Number.isFinite(bl) || bl >= 0) return 1; const sv = -100 / bl; return sv < 0.1 ? 0.1 : sv > 10 ? 10 : sv; }
    function buildControlPoints(points, defaultSet) {
        const fallbackSet = defaultSet || 1;
        if (!points.length) return [{ time: 0, beatLength: 500, sliderVelocity: 1, meter: 4, sampleSet: fallbackSet, sampleIndex: 0, volume: 100, kiai: false }];
        const sorted = points.map((p, i) => ({ p, i })).sort((a, b) => a.p.time - b.p.time || Number(b.p.uninherited) - Number(a.p.uninherited) || a.i - b.i).map(e => e.p);
        const firstRed = sorted.find(p => p.uninherited);
        let beatLength = firstRed ? firstRed.beatLength : 500, meter = firstRed ? firstRed.meter : 4, sliderVelocity = 1, generateTicks = true, rawBeatLength = firstRed && firstRed.rawBeatLength;
        const out = [];
        for (const p of sorted) {
            if (p.uninherited) { beatLength = p.beatLength; meter = p.meter; sliderVelocity = 1; generateTicks = true; rawBeatLength = p.rawBeatLength; }
            else { sliderVelocity = sliderVelocityOf(p.beatLength); generateTicks = p.generateTicks !== false; }
            const cp = { time: p.time, beatLength, sliderVelocity, meter, sampleSet: p.sampleSet || fallbackSet, sampleIndex: p.sampleIndex, volume: p.volume, kiai: p.kiai, generateTicks, rawBeatLength };
            if (out.length && out[out.length - 1].time === cp.time) out[out.length - 1] = cp; else out.push(cp);
        }
        return out;
    }
    function cpAt(points, time) {
        if (!points.length) return { beatLength: 500, sliderVelocity: 1, meter: 4, kiai: false, volume: 100, sampleSet: 1 };
        let lo = 0, hi = points.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (points[mid].time <= time) lo = mid; else hi = mid - 1; }
        return points[lo].time <= time ? points[lo] : points[0];
    }
    function preemptFor(ar) { return ar < 5 ? 1200 + (600 * (5 - ar)) / 5 : 1200 - (750 * (ar - 5)) / 5; }
    function difficultyAttributes(d) {
        const preempt = preemptFor(d.ar), scale = (1 - (0.7 * (d.cs - 5)) / 5) / 2;
        return { cs: d.cs, ar: d.ar, od: d.od, hp: d.hp, circleRadius: 54.4 - 4.48 * d.cs, preempt, fadeIn: 400 * Math.min(1, preempt / 450), window300: 80 - 6 * d.od, window100: 140 - 8 * d.od, window50: 200 - 10 * d.od, stackOffset: -6.4 * scale };
    }
    function adjustDifficulty(d, mods, modSettings) {
        const out = { ...d };
        if (mods.includes('DA')) {
            const s = (modSettings && modSettings.DA) || {};
            for (const k of ['cs', 'ar', 'od', 'hp']) if (typeof s[k] === 'number' && Number.isFinite(s[k])) out[k] = s[k];
        } else if (mods.includes('HR')) { out.cs = Math.min(out.cs * 1.3, 10); out.ar = Math.min(out.ar * 1.4, 10); out.od = Math.min(out.od * 1.4, 10); out.hp = Math.min(out.hp * 1.4, 10); }
        else if (mods.includes('EZ')) { out.cs *= 0.5; out.ar *= 0.5; out.od *= 0.5; out.hp *= 0.5; }
        return out;
    }
    function computeCombos(objects) {
        const out = new Array(objects.length);
        let colorIndex = 0, comboNumber = 0, forceNewCombo = true, pendingSkip = 0;
        for (let i = 0; i < objects.length; i++) {
            const o = objects[i];
            if (o.kind === 'spinner') {
                if (o.newCombo) pendingSkip += o.comboSkip;
                forceNewCombo = true; comboNumber++;
                out[i] = { newCombo: false, comboNumber, comboColorIndex: colorIndex, lastInCombo: false };
                continue;
            }
            const nc = o.newCombo || forceNewCombo;
            if (nc) { colorIndex += 1 + o.comboSkip + pendingSkip; comboNumber = 0; }
            forceNewCombo = false; pendingSkip = 0; comboNumber++;
            out[i] = { newCombo: nc, comboNumber, comboColorIndex: colorIndex, lastInCombo: false };
        }
        for (let i = 0; i < out.length; i++) out[i].lastInCombo = i === out.length - 1 || out[i + 1].newCombo;
        return out;
    }
    const STACK_DISTANCE = 3;
    function applyStacking(items, preempt, leniency) {
        const threshold = preempt * leniency; let extended = 0;
        for (let i = items.length - 1; i > 0; i--) {
            let n = i, objectI = items[i];
            if (objectI.stackHeight !== 0 || objectI.kind === 'spinner') continue;
            if (objectI.kind === 'circle') {
                while (--n >= 0) {
                    const objectN = items[n];
                    if (objectN.kind === 'spinner') continue;
                    if (objectI.time - objectN.endTime > threshold) break;
                    if (n < extended) { objectN.stackHeight = 0; extended = n; }
                    if (objectN.kind === 'slider' && Math.hypot(objectN.endX - objectI.x, objectN.endY - objectI.y) < STACK_DISTANCE) {
                        const offset = objectI.stackHeight - objectN.stackHeight + 1;
                        for (let j = n + 1; j <= i; j++) if (Math.hypot(objectN.endX - items[j].x, objectN.endY - items[j].y) < STACK_DISTANCE) items[j].stackHeight -= offset;
                        break;
                    }
                    if (Math.hypot(objectN.x - objectI.x, objectN.y - objectI.y) < STACK_DISTANCE) { objectN.stackHeight = objectI.stackHeight + 1; objectI = objectN; }
                }
            } else if (objectI.kind === 'slider') {
                while (--n >= 0) {
                    const objectN = items[n];
                    if (objectN.kind === 'spinner') continue;
                    if (objectI.time - objectN.time > threshold) break;
                    if (Math.hypot(objectN.endX - objectI.x, objectN.endY - objectI.y) < STACK_DISTANCE) { objectN.stackHeight = objectI.stackHeight + 1; objectI = objectN; }
                }
            }
        }
    }
    function generateSliderEvents(startTime, spanDuration, velocity, tickDistance, totalDistance, slides) {
        const events = [];
        const length = Math.min(100000, totalDistance);
        const tickDist = Math.min(Math.max(tickDistance, 0), length);
        const minDistanceFromEnd = velocity * 10;
        for (let span = 0; span < slides; span++) {
            const spanStart = startTime + span * spanDuration, reversed = span % 2 === 1;
            const ticks = [];
            if (tickDist > 0) for (let d = tickDist; d <= length; d += tickDist) {
                if (d >= length - minDistanceFromEnd) break;
                const progress = d / length;
                ticks.push({ kind: 'tick', time: spanStart + (reversed ? 1 - progress : progress) * spanDuration, spanIndex: span, pathProgress: progress });
            }
            if (reversed) ticks.reverse();
            for (const t of ticks) events.push(t);
            if (span < slides - 1) events.push({ kind: 'repeat', time: spanStart + spanDuration, spanIndex: span, pathProgress: (span + 1) % 2 });
        }
        const total = slides * spanDuration;
        const tailTime = Math.max(startTime + total / 2, startTime + (slides - 1) * spanDuration + spanDuration - 36);
        events.push({ kind: 'tail', time: tailTime, spanIndex: slides - 1, pathProgress: slides % 2 });
        events.sort((a, b) => a.time - b.time);
        return events;
    }
    function buildPlayable(data, mods, modSettings) {
        const adjusted = adjustDifficulty({ cs: data.difficulty.circleSize, ar: data.difficulty.approachRate, od: data.difficulty.overallDifficulty, hp: data.difficulty.hpDrainRate }, mods || [], modSettings || {});
        const difficulty = difficultyAttributes(adjusted);
        const cps = buildControlPoints(data.timingPoints, data.general.sampleSet);
        const flip = (mods || []).includes('HR');
        const flipY = y => flip ? 384 - y : y;
        const objects = data.hitObjects;
        const geometry = new Array(objects.length), items = new Array(objects.length);
        for (let i = 0; i < objects.length; i++) {
            const o = objects[i], head = V(o.x, flipY(o.y)), control = cpAt(cps, o.time);
            let path = null, timing = null, endTime = o.time, slides = 1;
            if (o.kind === 'slider') {
                const c = (o.controlPoints || []).map(p => V(p.x, flipY(p.y)));
                path = createSliderPath(head, o.curveType || 'B', c, o.pixelLength || 0);
                slides = Math.abs(path.length) <= 1e-7 ? 1 : (o.slides || 1);
                const scoringDistance = 100 * data.difficulty.sliderMultiplier * control.sliderVelocity;
                const beatLength = control.beatLength || 500;
                const velocity = scoringDistance / beatLength;
                const spanDuration = velocity > 0 ? path.length / velocity : 0;
                const tickDistance = control.generateTicks === false ? Infinity : scoringDistance / data.difficulty.sliderTickRate;
                timing = { velocity, spanDuration, duration: spanDuration * slides, tickDistance };
                endTime = o.time + timing.duration;
            } else if (o.kind === 'spinner') endTime = Math.max(o.endTime || o.time + 1, o.time + 1);
            geometry[i] = { head, path, timing, endTime, slides };
            const end = path ? path.pointAt(slides % 2 === 1 ? 1 : 0) : head;
            items[i] = { kind: o.kind, time: o.time, endTime, x: head.x, y: head.y, endX: end.x, endY: end.y, stackHeight: 0 };
        }
        if (data.formatVersion >= 6) applyStacking(items, difficulty.preempt, data.general.stackLeniency);
        const combos = computeCombos(objects);
        const playable = new Array(objects.length);
        for (let i = 0; i < objects.length; i++) {
            const o = objects[i], g = geometry[i], combo = combos[i];
            const stackHeight = o.kind === 'spinner' ? 0 : items[i].stackHeight;
            const offset = stackHeight * difficulty.stackOffset;
            const base = {
                index: i, kind: o.kind, x: g.head.x + offset, y: g.head.y + offset,
                rawX: o.x, rawY: o.y, time: o.time, endTime: g.endTime, stackHeight,
                newCombo: combo.newCombo, comboNumber: combo.comboNumber, comboColorIndex: combo.comboColorIndex,
                lastInCombo: combo.lastInCombo, hitSound: o.hitSound, hitSample: o.hitSample,
                control: cpAt(cps, o.time), curveType: o.curveType || null, rawControlPoints: o.controlPoints || []
            };
            if (o.kind === 'slider' && g.path && g.timing) {
                const shifted = makePath(g.path.points.map(p => ({ x: p.x + offset, y: p.y + offset, t: p.t })), g.path.length);
                const descriptors = generateSliderEvents(o.time, g.timing.spanDuration, g.timing.velocity, g.timing.tickDistance, shifted.length, g.slides);
                const events = descriptors.map(d => { const p = shifted.pointAt(d.pathProgress); return { kind: d.kind, time: d.time, spanIndex: d.spanIndex, pathProgress: d.pathProgress, x: p.x, y: p.y }; });
                const end = shifted.pointAt(g.slides % 2 === 1 ? 1 : 0);
                Object.assign(base, {
                    path: shifted, slides: g.slides, spanDuration: g.timing.spanDuration, duration: g.timing.duration,
                    endX: end.x, endY: end.y, events, tickDistance: g.timing.tickDistance, velocity: g.timing.velocity,
                    ticks: events.filter(e => e.kind === 'tick').length, pixelLength: o.pixelLength || 0
                });
            } else if (o.kind === 'spinner') Object.assign(base, { duration: g.endTime - o.time, x: 256, y: 192 });
            playable[i] = base;
        }
        const comboColors = data.comboColors.length ? data.comboColors : [0x609f9f, 0xc0c0c0, 0x80ffff, 0x8bbfde];
        return {
            data, difficulty, objects: playable, controlPoints: cps, breaks: data.events.breaks,
            comboColors, startTime: playable.length ? playable[0].time : 0,
            endTime: playable.length ? Math.max(...playable.map(o => o.endTime)) : 0,
            mods: (mods || []).slice(), rate: R.site.rate || 1
        };
    }

    // =======================================================================
    // 8. Analyzer — derived statistics from real object data
    // =======================================================================
    function computeAnalysis(pb) {
        if (!pb) return null;
        const objs = pb.objects, total = objs.length;
        const counts = { circles: 0, sliders: 0, spinners: 0 };
        const COUNT_KEY = { circle: 'circles', slider: 'sliders', spinner: 'spinners' };
        for (const o of objs) counts[COUNT_KEY[o.kind] || 'circles']++;
        const sectionSec = clamp(finite(cfg.analyzer.sectionSec, 15), 2, 120);
        const songDuration = Math.max(pb.endTime, finite(R.audio.duration, pb.endTime), 1);
        const sectionCount = Math.max(1, Math.ceil(songDuration / (sectionSec * 1000)));
        const sections = Array.from({ length: sectionCount }, (_, i) => ({ index: i, start: i * sectionSec * 1000, end: (i + 1) * sectionSec * 1000, count: 0, circles: 0, sliders: 0, spinners: 0, spacing: 0, spacingSum: 0, spacingCount: 0 }));
        const spacings = [];
        for (let i = 0; i < total; i++) {
            const o = objs[i];
            const s = sections[clamp(Math.floor(o.time / (sectionSec * 1000)), 0, sectionCount - 1)];
            s.count++; s[COUNT_KEY[o.kind] || 'circles']++;
            if (i > 0) {
                const d = Math.hypot(o.x - objs[i - 1].x, o.y - objs[i - 1].y);
                if (Number.isFinite(d)) { spacings.push(d); s.spacingSum += d; s.spacingCount++; }
            }
        }
        for (const s of sections) {
            s.spacing = s.spacingCount ? s.spacingSum / s.spacingCount : 0;
            s.density = s.count / sectionSec;
            s.progression = round(s.density * (1 + Math.min(2, s.spacing / 300)), 2);
        }
        const sortedSpacing = spacings.slice().sort((a, b) => a - b);
        const pct = p => sortedSpacing.length ? sortedSpacing[clamp(Math.floor(sortedSpacing.length * p), 0, sortedSpacing.length - 1)] : 0;
        const spacing = { min: sortedSpacing[0] || 0, max: sortedSpacing[sortedSpacing.length - 1] || 0, avg: spacings.length ? spacings.reduce((a, b) => a + b, 0) / spacings.length : 0, p50: pct(0.5), p90: pct(0.9), samples: spacings.length };
        const bpmRows = pb.data.timingPoints.filter(t => t.uninherited && t.beatLength > 0);
        const bpmMin = bpmRows.length ? Math.min(...bpmRows.map(t => 60000 / t.beatLength)) : 120;
        const bpmMax = bpmRows.length ? Math.max(...bpmRows.map(t => 60000 / t.beatLength)) : 120;
        const bpmDistribution = [];
        for (let i = 0; i < bpmRows.length; i++) {
            const t = bpmRows[i], end = i + 1 < bpmRows.length ? bpmRows[i + 1].time : songDuration;
            bpmDistribution.push({ time: t.time, end, bpm: 60000 / t.beatLength, ms: Math.max(0, end - t.time) });
        }
        const timingPoints = pb.data.timingPoints.map((t, i) => ({
            index: i, time: t.time, beatLength: t.beatLength, bpm: t.uninherited && t.beatLength > 0 ? 60000 / t.beatLength : null,
            sv: sliderVelocityOf(t.beatLength), meter: t.meter, kiai: t.kiai, uninherited: t.uninherited,
            volume: t.volume, sampleSet: t.sampleSet, effective: cpAt(pb.controlPoints, t.time)
        }));
        const top = sections.slice().filter(s => s.count > 0).sort((a, b) => b.density - a.density).slice(0, clamp(finite(cfg.analyzer.topSections, 6), 1, 30));
        const intervals = [];
        for (let i = 1; i < Math.min(total, 400); i++) intervals.push(objs[i].time - objs[i - 1].time);
        const sliderStats = { count: counts.sliders, totalDuration: 0, maxDuration: 0, avgDuration: 0, totalTicks: 0, curves: {} };
        const spinnerStats = { count: counts.spinners, totalDuration: 0, maxDuration: 0 };
        for (const o of objs) {
            if (o.kind === 'slider') {
                sliderStats.totalDuration += o.duration; sliderStats.maxDuration = Math.max(sliderStats.maxDuration, o.duration);
                sliderStats.totalTicks += o.ticks || 0;
                sliderStats.curves[o.curveType || 'B'] = (sliderStats.curves[o.curveType || 'B'] || 0) + 1;
            } else if (o.kind === 'spinner') { spinnerStats.totalDuration += o.duration; spinnerStats.maxDuration = Math.max(spinnerStats.maxDuration, o.duration); }
        }
        sliderStats.avgDuration = counts.sliders ? sliderStats.totalDuration / counts.sliders : 0;
        const stars = currentDiffSummary() ? currentDiffSummary().stars : null;
        return {
            total, ...counts, counts, bpmMin, bpmMax, bpmAvg: bpmDistribution.length ? bpmDistribution.reduce((a, b) => a + b.bpm * b.ms, 0) / Math.max(1, bpmDistribution.reduce((a, b) => a + b.ms, 0)) : 120,
            bpmDistribution, timingPoints, sections, spacing, highDensity: top, intervals,
            songDuration, startTime: pb.startTime, endTime: pb.endTime, difficulty: pb.difficulty,
            metadata: pb.data.metadata, general: pb.data.general, stars, breaks: pb.breaks,
            comboColors: pb.comboColors, maxCombo: Math.max(0, ...objs.map(o => o.comboNumber || 0)),
            sliderStats, spinnerStats, sectionSec, sectionCount
        };
    }
    function currentDiffSummary() {
        const set = R.lib.sets.find(s => s.key === R.site.key);
        if (!set || !R.site.file) return null;
        return (set.difficulties || []).find(d => d.file === R.site.file) || null;
    }
    function analysis() {
        const target = R.analysisBeatmap || R.beatmap;
        if (!target) return null;
        const key = target === R.beatmap ? R.beatmapKey : R.analysisKey;
        let a = R.analysisCache.get(key);
        if (!a || a.songDuration < finite(R.audio.duration, 0) - 2000 || a.sectionSec !== cfg.analyzer.sectionSec) {
            a = computeAnalysis(target); R.analysisCache.set(key, a);
            if (R.analysisCache.size > 8) R.analysisCache.delete(R.analysisCache.keys().next().value);
        }
        return a;
    }

    // =======================================================================
    // 9. Website data: settings, IndexedDB library, .osz extraction
    // =======================================================================
    function readSiteSettings() {
        let raw = null, offsets = null;
        try { raw = localStorage.getItem('webosu.settings.v2'); } catch { /* private mode */ }
        try { offsets = localStorage.getItem('wosu.beatmapOffsets.v1'); } catch { /* ignore */ }
        const parsed = raw ? safeParse(raw, null) : null;
        if (!parsed && !R.site.settings) return false;
        R.site.settings = parsed || R.site.settings || {};
        R.site.offsets = offsets ? safeParse(offsets, {}) : (R.site.offsets || {});
        const s = R.site.settings;
        R.site.mods = Array.isArray(s.selectedMods) ? s.selectedMods.slice() : [];
        R.site.modSettings = isObj(s.modSettings) ? s.modSettings : {};
        R.site.uiScale = clamp(finite(s.uiScale, 1), 0.8, 1.6);
        R.site.audioOffset = finite(s.audioOffset, 0);
        R.site.rate = modRate(R.site.mods, R.site.modSettings);
        R.site.hr = R.site.mods.includes('HR');
        const lb = String(s.lastBeatmap || '');
        if (lb !== R.site.lastBeatmap) {
            R.site.lastBeatmap = lb;
            const parts = lb.split('|');
            R.site.key = parts[0] || ''; R.site.file = parts.slice(1).join('|') || '';
            logEvent('selection', 'Selected beatmap changed: ' + (lb || '(none)'));
            if (R.site.key && R.site.file) void loadSelectedBeatmap(R.site.key, R.site.file);
            if (R.beatmap) reprocessBeatmap();
        }
        recalcOffsets();
        return true;
    }
    function modRate(mods, settings) {
        const order = ['HT', 'DC', 'DT', 'NC'];
        const found = order.find(a => mods.includes(a));
        if (!found) return 1;
        const v = finite(settings && settings[found] && settings[found].speedChange, found === 'DT' || found === 'NC' ? 1.5 : 0.75);
        return v > 0 ? v : 1;
    }
    function beatmapKeyOf(meta, set) {
        if (meta.beatmapId > 0) return 'bid:' + meta.beatmapId;
        return ('t:' + (set && set.onlineSetId > 0 ? set.onlineSetId : 0) + '|' + (set ? set.title : meta.title) + '|' + meta.version).toLowerCase();
    }
    function recalcOffsets() {
        const set = R.lib.sets.find(s => s.key === R.site.key);
        const diff = set && (set.difficulties || []).find(d => d.file === R.site.file);
        const meta = R.beatmap ? R.beatmap.data.metadata : (diff ? { beatmapId: diff.beatmapId, version: diff.version } : null);
        let bm = 0;
        if (meta && isObj(R.site.offsets)) bm = finite(R.site.offsets[beatmapKeyOf(meta, set)], 0);
        R.site.beatmapOffset = bm;
        R.site.userOffsetMs = (R.site.audioOffset + bm) * R.site.rate;
    }

    let dbPromise = null, dbPromiseAt = 0;
    function siteDb() {
        if (dbPromise && now() - dbPromiseAt < 8000) return dbPromise;
        dbPromiseAt = now();
        dbPromise = new Promise(resolve => {
            let done = false;
            const finish = v => { if (!done) { done = true; resolve(v); } };
            try {
                if (!window.indexedDB) return finish(null);
                let aborted = false;
                const req = indexedDB.open('webosu');
                req.onupgradeneeded = () => { aborted = true; try { req.transaction.abort(); } catch { /* ignore */ } };
                req.onsuccess = () => { const db = req.result; if (aborted) { db.close(); finish(null); } else finish(db); };
                req.onerror = () => finish(null);
                req.onblocked = () => finish(null);
                setTimeout(() => finish(null), 2500);
            } catch (e) { R.lib.error = String(e.message || e); finish(null); }
        });
        return dbPromise;
    }
    function idbGetAll(db, store) {
        return new Promise(resolve => {
            try {
                if (!db.objectStoreNames.contains(store)) return resolve([]);
                const tx = db.transaction(store, 'readonly');
                const req = tx.objectStore(store).getAll();
                req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                req.onerror = () => resolve([]);
            } catch { resolve([]); }
        });
    }
    function idbGet(db, store, key) {
        return new Promise(resolve => {
            try {
                if (!db.objectStoreNames.contains(store)) return resolve(null);
                const tx = db.transaction(store, 'readonly');
                const req = tx.objectStore(store).get(key);
                req.onsuccess = () => resolve(req.result ?? null);
                req.onerror = () => resolve(null);
            } catch { resolve(null); }
        });
    }
    async function loadLibrary() {
        const db = await siteDb();
        if (!db) { R.lib.dbOk = false; return; }
        const rows = await idbGetAll(db, 'sets');
        R.lib.dbOk = true;
        R.lib.sets = rows.filter(s => s && typeof s.key === 'string' && Array.isArray(s.difficulties));
        R.lib.lastRead = now();
        recalcOffsets();
        if (R.site.key && R.site.file && !R.beatmap) void loadSelectedBeatmap(R.site.key, R.site.file);
    }

    // ZIP reader (dependency-free; Chromium DecompressionStream 'deflate-raw')
    function zipEntries(bytes) {
        const u16 = (d, i) => d[i] | (d[i + 1] << 8);
        const u32 = (d, i) => (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0;
        let e = bytes.length - 22;
        const stop = Math.max(0, bytes.length - 65558);
        while (e >= stop && u32(bytes, e) !== 0x06054b50) e--;
        if (e < stop) return [];
        const count = u16(bytes, e + 10);
        let o = u32(bytes, e + 16);
        const out = [];
        const dec = new TextDecoder('utf-8');
        for (let i = 0; i < count && o + 46 <= bytes.length; i++) {
            if (u32(bytes, o) !== 0x02014b50) break;
            const method = u16(bytes, o + 10), comp = u32(bytes, o + 20), uncomp = u32(bytes, o + 24);
            const nameLen = u16(bytes, o + 28), extraLen = u16(bytes, o + 30), commentLen = u16(bytes, o + 32);
            const local = u32(bytes, o + 42);
            const name = dec.decode(bytes.subarray(o + 46, o + 46 + nameLen)).replace(/\\/g, '/');
            out.push({ name, method, comp, uncomp, local });
            o += 46 + nameLen + extraLen + commentLen;
        }
        return out;
    }
    async function inflateRaw(bytes) {
        if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unavailable');
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        const reader = stream.getReader();
        const chunks = []; let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); total += value.length;
        }
        const out = new Uint8Array(total); let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out;
    }
    async function extractOsu(blob, wanted) {
        // WOSU stores raw .osz archives in the IDB "blobs" store; accept the
        // Blob / ArrayBuffer / typed-array shapes that can come back from IDB.
        let buf;
        if (ArrayBuffer.isView(blob)) buf = new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength);
        else if (blob instanceof ArrayBuffer || Object.prototype.toString.call(blob) === '[object ArrayBuffer]') buf = new Uint8Array(blob);
        else if (blob && typeof blob.arrayBuffer === 'function') buf = new Uint8Array(await blob.arrayBuffer());
        else if (blob && typeof blob.size === 'number' && typeof blob.slice === 'function') buf = new Uint8Array(await new Response(blob).arrayBuffer());
        else throw new Error('Unsupported .osz archive value');
        const entries = zipEntries(buf);
        const dec = new TextDecoder('utf-8');
        const result = {};
        const names = wanted ? entries.filter(e => wanted.some(w => e.name === w || e.name.toLowerCase().endsWith('/' + w.toLowerCase()))) : entries.filter(e => /\.osu$/i.test(e.name));
        for (const entry of names.slice(0, 60)) {
            try {
                const h = entry.local;
                if (h + 30 > buf.length) continue;
                const nameLen = buf[h + 26] | (buf[h + 27] << 8), extraLen = buf[h + 28] | (buf[h + 29] << 8);
                const start = h + 30 + nameLen + extraLen;
                const compressed = buf.subarray(start, Math.min(buf.length, start + entry.comp));
                let raw;
                if (entry.method === 0) raw = compressed;
                else if (entry.method === 8) raw = await inflateRaw(compressed);
                else continue;
                result[entry.name] = dec.decode(raw);
            } catch (e) { logError('extract ' + entry.name, e); }
        }
        return result;
    }
    async function getSetBlob(key) {
        if (R.lib.blobs.has(key)) return R.lib.blobs.get(key);
        const db = await siteDb(); if (!db) return null;
        const blob = await idbGet(db, 'blobs', key);
        if (blob) { R.lib.blobs.set(key, blob); if (R.lib.blobs.size > 4) R.lib.blobs.delete(R.lib.blobs.keys().next().value); }
        return blob || null;
    }
    async function loadSelectedBeatmap(key, file) {
        try {
            const blob = await getSetBlob(key);
            if (!blob) { logEvent('library', 'Beatmap archive unavailable for ' + key + ' (using decoded data)'); return; }
            const texts = await extractOsu(blob, [file]);
            const text = texts[file] || texts[Object.keys(texts)[0]];
            if (!text) { logEvent('library', 'Difficulty file not found: ' + file); return; }
            const data = parseOsu(text);
            if (!data.hitObjects.length) return;
            registerBeatmap(data, 'library:' + key + '|' + file, file);
        } catch (e) { logError('loadSelectedBeatmap', e); }
    }
    async function loadDifficultyForAnalysis(key, file) {
        try {
            const blob = await getSetBlob(key); if (!blob) return false;
            const texts = await extractOsu(blob, [file]);
            const text = texts[file] || texts[Object.keys(texts)[0]];
            if (!text) return false;
            const data = parseOsu(text);
            const pb = buildPlayable(data, R.site.mods, R.site.modSettings);
            R.analysisBeatmap = pb; R.analysisKey = 'inspect:' + key + '|' + file;
            R.analysisCache.delete(R.analysisKey);
            notify('info', 'Analyzer target', data.metadata.title + ' [' + data.metadata.version + ']');
            refreshActiveSection(true);
            return true;
        } catch (e) { logError('loadDifficultyForAnalysis', e); return false; }
    }
    function beatmapKeyOfData(data, hint) {
        return (hint || '') + '|' + data.metadata.beatmapId + '|' + data.metadata.version + '|' + data.hitObjects.length + '|' + hashString(data.hitObjects.length + ':' + (data.hitObjects[0] ? data.hitObjects[0].time : 0) + ':' + data.metadata.title);
    }
    function onDecodedOsu(text, at) {
        // Only genuine .osu documents from WOSU's TextDecoder hook belong here.
        if (typeof text !== 'string' || text.length < 24) return;
        const head = text.charCodeAt(0) === 0xfeff ? text.slice(1, 40) : text.slice(0, 40);
        if (!/^osu file format v\d+/i.test(head)) return;
        let data;
        try { data = parseOsu(text); } catch (e) { logError('parseOsu', e); return; }
        if (!data.hitObjects.length) return;
        const key = beatmapKeyOfData(data, 'decode');
        if (!R.beatmaps.has(key)) {
            R.beatmaps.set(key, { data, key, at, source: 'decoder' });
            if (R.beatmaps.size > 14) R.beatmaps.delete(R.beatmaps.keys().next().value);
        }
        R.recentDecodeAt = at || now();
        R.lastDecoderBeatmap = { data, key };
        R.sessionBeatmapCount(data);
        if (!R.beatmap) registerBeatmap(data, 'decoder', key);
        else logEvent('beatmap', 'WOSU decoded ' + data.metadata.title + ' [' + data.metadata.version + '] (' + data.hitObjects.length + ' objects)');
    }
    function registerBeatmap(data, source, key) {
        const k = key || beatmapKeyOfData(data, source);
        const changed = R.beatmapKey && R.beatmapKey !== k;
        const pb = buildPlayable(data, R.site.mods, R.site.modSettings);
        R.beatmap = pb; R.beatmapKey = k; R.beatmapSource = source;
        R.analysisBeatmap = pb; R.analysisKey = k;
        R.analysisCache.delete(k);
        R.tracking.status = 'ready'; R.tracking.currentIndex = -1; R.tracking.selectedIndex = -1;
        session.beatmapsLoaded++;
        R.sessionBeatmapCount(data);
        recalcOffsets();
        logEvent('beatmap', 'Beatmap detected: ' + data.metadata.artist + ' — ' + data.metadata.title + ' [' + data.metadata.version + '] via ' + source);
        notify(changed ? 'beatmapChanged' : 'beatmapDetected', changed ? 'Beatmap changed' : 'Beatmap detected',
            data.metadata.artist + ' — ' + data.metadata.title + ' [' + data.metadata.version + '] · ' + data.hitObjects.length + ' objects');
        if (!changed) notify('trackingInit', 'Tracking initialized', pb.objects.length + ' objects · ' + fmtTime(pb.endTime) + ' · AR ' + round(pb.difficulty.ar, 1));
        recordHistory(data, source);
        refreshActiveSection(true);
    }
    R.sessionBeatmapCount = function (data) {
        const id = R.site.key ? R.site.key + '|' + data.metadata.version : data.metadata.title + '|' + data.metadata.version;
        if (!session.history.some(h => h.id === id)) {
            session.history.unshift({ id, at: now(), title: data.metadata.title, artist: data.metadata.artist, creator: data.metadata.creator, version: data.metadata.version, beatmapId: data.metadata.beatmapId, objects: data.hitObjects.length, key: R.site.key || '', file: R.site.file || '' });
            if (session.history.length > 100) session.history.pop();
            saveSession();
        }
    };
    function reprocessBeatmap() {
        if (!R.beatmap) return;
        try {
            R.beatmap = buildPlayable(R.beatmap.data, R.site.mods, R.site.modSettings);
            if (R.analysisBeatmap === R.beatmap || R.analysisKey === R.beatmapKey) { R.analysisBeatmap = R.beatmap; R.analysisCache.delete(R.beatmapKey); }
            logEvent('mods', 'Reprocessed beatmap for mods: ' + (R.site.mods.join('+') || 'None') + ' @ ' + R.site.rate + 'x');
            refreshActiveSection(true);
        } catch (e) { logError('reprocessBeatmap', e); }
    }
    function recordHistory(data, source) {
        const id = (R.site.key || data.metadata.title) + '|' + data.metadata.version;
        const found = session.history.find(h => h.id === id);
        if (found) { found.at = now(); found.objects = data.hitObjects.length; }
        else session.history.unshift({ id, at: now(), title: data.metadata.title, artist: data.metadata.artist, creator: data.metadata.creator, version: data.metadata.version, beatmapId: data.metadata.beatmapId, objects: data.hitObjects.length, key: R.site.key || '', file: R.site.file || '' });
        if (session.history.length > 100) session.history.pop();
        saveSession();
    }

    // ---- online API responses (real data fetched by WOSU itself) ----
    function onApiResponse(url, text) {
        R.online.lastUrl = url; R.online.count++;
        const json = safeParse(text, null);
        let rows = [];
        if (Array.isArray(json)) rows = json;
        else if (isObj(json)) {
            for (const k of ['data', 'beatmapsets', 'results', 'beatmaps', 'sets']) {
                if (Array.isArray(json[k])) { rows = json[k]; break; }
                if (isObj(json[k]) && Array.isArray(json[k].data)) { rows = json[k].data; break; }
            }
            if (!rows.length && isObj(json.data) && Array.isArray(json.data.bid_data)) rows = json.data.bid_data;
        }
        const added = [];
        for (const r of rows.slice(0, 120)) {
            if (!isObj(r)) continue;
            const sid = finite(r.sid ?? r.id ?? r.beatmapset_id ?? r.setId, 0);
            const title = String(r.title ?? r.titleU ?? ''), artist = String(r.artist ?? r.artistU ?? '');
            if (!title && !artist) continue;
            const diffs = Array.isArray(r.bid_data) ? r.bid_data.length : Array.isArray(r.beatmaps) ? r.beatmaps.length : Array.isArray(r.diffs) ? r.diffs.length : 0;
            const item = {
                sid, title, artist, creator: String(r.creator ?? r.mapper ?? ''), source: /sayobot/i.test(url) ? 'SayoBot' : /catboy|mino/i.test(url) ? 'Mino' : 'Online',
                approved: finite(r.approved, 0), playCount: finite(r.play_count ?? r.playcount, 0),
                bpm: finite(r.BPM ?? r.bpm, 0), stars: finite(r.star ?? r.difficulty_rating, 0) || null, diffs,
                url, at: now()
            };
            const key = item.sid + '|' + item.title + '|' + item.artist;
            const existing = R.online.results.findIndex(x => x.key === key);
            if (existing >= 0) R.online.results[existing] = { ...item, key };
            else added.push({ ...item, key });
        }
        R.online.results = added.concat(R.online.results).slice(0, 300);
        if (added.length) {
            logEvent('api', 'Captured ' + added.length + ' online beatmap rows from ' + (new URL(url, location.href).hostname || 'mirror'));
            if (cfg.activeSection === 'inspector' || cfg.activeSection === 'history') refreshActiveSection(true);
        }
    }

    // ---- audio clock + events ----
    function onProbeEvent(e) {
        const d = e.data || {};
        switch (e.type) {
            case 'sourceStart': {
                const scheduled = finite(d.scheduled, 0);
                const long = finite(d.duration, 0) >= 20;
                const prev = R.audio.lastStart;
                R.audio.lastStart = { at: e.at, offset: d.offset, rate: d.rate, duration: d.duration, scheduled };
                logEvent('audio', 'Audio source started @ ' + fmtTime(d.offset * 1000) + ' · ' + round(finite(d.rate, 1), 2) + 'x · ' + fmtTime(d.duration * 1000) + (scheduled > 0.03 ? ' (lead-in ' + Math.round(scheduled * 1000) + ' ms)' : ''));
                if (long) {
                    if (R.lastDecoderBeatmap && (now() - R.recentDecodeAt < 9000) && (scheduled > 0.03 || !R.beatmap || prev && Math.abs(prev.rate - d.rate) > 0.01)) {
                        if (R.beatmapKey !== R.lastDecoderBeatmap.key) registerBeatmap(R.lastDecoderBeatmap.data, 'decoder', R.lastDecoderBeatmap.key);
                    }
                    const newPlay = scheduled > 0.03 || (d.offset < 0.2 && (!prev || e.at - prev.at > 1500));
                    if (newPlay && R.beatmap) {
                        R.audio.inPlay = true; R.audio.playStartedAt = e.at;
                        session.plays++; saveSession();
                        notify('songStarted', 'Song started', R.beatmap.data.metadata.title + ' [' + R.beatmap.data.metadata.version + ']');
                        logEvent('play', 'Playback session started');
                    } else if (R.audio.inPlay && prev && d.offset > 0.2) {
                        notify('songResumed', 'Song resumed', 'Resumed at ' + fmtTime(d.offset * 1000));
                        logEvent('play', 'Playback resumed / seeked to ' + fmtTime(d.offset * 1000));
                    }
                    if (prev && Math.abs(prev.rate - d.rate) > 0.01) logEvent('audio', 'Playback speed changed: ' + round(prev.rate, 2) + 'x → ' + round(d.rate, 2) + 'x');
                    if (prev && Math.abs(d.offset * 1000 - R.audio.songTime) > 400) logEvent('audio', 'Seek detected → ' + fmtTime(d.offset * 1000));
                }
                break;
            }
            case 'sourceStop':
                R.audio.lastEvent = 'pause'; R.audio.lastEventAt = e.at;
                if (R.audio.inPlay && R.audio.playing) { notify('songPaused', 'Song paused', 'at ' + fmtTime(R.audio.songTime)); logEvent('play', 'Playback paused'); }
                break;
            case 'sourceEnd': R.audio.lastEvent = 'ended'; R.audio.lastEventAt = e.at; logEvent('audio', 'Audio source reached its natural end'); break;
            case 'workletStart': logEvent('audio', 'Pitch-preserving audio started at ' + round(finite(d.rate, 1), 2) + 'x'); break;
            case 'ctxsuspend': logEvent('audio', 'AudioContext suspended'); break;
            case 'ctxresume': logEvent('audio', 'AudioContext resumed'); break;
            case 'audioContext': logEvent('audio', 'WOSU AudioContext: ' + Math.round(finite(d.sampleRate, 0)) + ' Hz, ' + d.state); break;
        }
    }
    function updateAudioState(s) {
        const a = R.audio;
        a.ctxTime = finite(s.ctxTime, 0); a.ctxState = s.ctxState || 'unknown';
        a.sampleRate = finite(s.sampleRate, 0); a.outputLatencyMs = finite(s.outputLatencyMs, 0); a.baseLatencyMs = finite(s.baseLatencyMs, 0);
        a.startOffsetMs = finite(s.startOffsetMs, a.startOffsetMs);
        a.worklet = s.worklet || a.worklet;
        a.analyser = s.analyser; a.wave = s.analyser ? s.analyser.wave : a.wave; a.spectrum = s.analyser ? s.analyser.spectrum : a.spectrum;
        if (s.analyser) a.levels = { rms: s.analyser.rms, peak: s.analyser.peak, bass: s.analyser.bass, mid: s.analyser.mid, treble: s.analyser.treble };
        if (s.decode) a.decode = s.decode;
        R.probe.hooks = s.hooks || R.probe.hooks;
        R.probe.osuCount = finite(s.osuCount, R.probe.osuCount);
        R.probe.apiCount = finite(s.apiCount, R.probe.apiCount);
        R.probe.decodeCount = finite(s.decodeCount, R.probe.decodeCount);
        if (s.errors && s.errors.length) for (const er of s.errors) { if (!R.probe.errors.some(x => x.message === er.message && x.label === er.label)) R.probe.errors.push(er); }
        a.previous = a.active; a.active = s.active;
        const active = s.active;
        let songTime = a.pausedSongTime, duration = a.duration, rate = a.rate, playing = false;
        if (active) {
            rate = clamp(finite(active.rate, 1), 0.05, 8);
            const raw = finite(active.offset, 0) * 1000 + (a.ctxTime - finite(active.when, a.ctxTime)) * rate * 1000;
            const posOffset = a.startOffsetMs + R.site.userOffsetMs + finite(cfg.audio.offsetManualMs, 0);
            songTime = raw - posOffset;
            duration = finite(active.duration, 0) * 1000;
            playing = a.ctxState === 'running';
        } else if (a.worklet && a.worklet.active && (a.decode || duration > 10000)) {
            rate = clamp(finite(a.worklet.rate, 1), 0.05, 8);
            songTime = finite(a.worklet.inputTime, 0) * 1000 - a.startOffsetMs - R.site.userOffsetMs - finite(cfg.audio.offsetManualMs, 0);
            duration = a.decode ? a.decode.duration * 1000 : duration;
            playing = a.ctxState === 'running';
        } else if (a.media && a.media.state === 'playing') {
            rate = 1; songTime = finite(a.media.currentTime, 0) * 1000; duration = finite(a.media.duration, 0) * 1000; playing = true;
        }
        const wasPlaying = a.playing;
        a.songTime = songTime; a.duration = Math.max(duration, a.decode ? a.decode.duration * 1000 : 0, R.beatmap ? R.beatmap.endTime : 0);
        a.rate = rate; a.playing = playing;
        a.offsetMs = a.startOffsetMs + R.site.userOffsetMs + finite(cfg.audio.offsetManualMs, 0);
        if (playing) {
            if (!wasPlaying) { a.predicted = songTime; a.lastPredictAt = s.at; R.audio.syncLost = false; }
            else {
                const dt = Math.max(0, Math.min(500, s.at - a.lastPredictAt));
                a.predicted += dt * rate; a.lastPredictAt = s.at;
                a.driftMs = round(songTime - a.predicted, 2);
                a.driftHistory.push(a.driftMs);
                const max = clamp(finite(cfg.audio.driftWindow, 120), 20, 600);
                if (a.driftHistory.length > max) a.driftHistory.shift();
            }
            session.stats.playMs += Math.max(0, Math.min(250, s.at - (a.lastStateAt || s.at)));
            a.lastStateAt = s.at;
        } else if (wasPlaying) {
            a.pausedSongTime = songTime;
            a.predicted = songTime;
        }
        const driftAbs = Math.abs(a.driftMs);
        if (driftAbs > finite(cfg.audio.warnDriftMs, 35) && !a.syncLost) {
            a.syncLost = true;
            notify('syncLost', 'Synchronization lost', round(a.driftMs, 1) + ' ms drift');
            logEvent('sync', 'Sync drift exceeded threshold: ' + round(a.driftMs, 1) + ' ms');
        } else if (driftAbs < Math.max(4, finite(cfg.audio.warnDriftMs, 35) * 0.4) && a.syncLost) {
            a.syncLost = false;
            notify('syncRestored', 'Synchronization restored', 'Drift back within tolerance');
            logEvent('sync', 'Sync restored');
        }
        if (!a.inPlay && playing && R.beatmap && songTime > -2000 && songTime < a.duration) a.inPlay = true;
        if (a.inPlay && !playing && songTime > a.duration - 500) a.inPlay = false;
    }
    function updatePerfState(s) {
        const p = R.perf;
        p.frames = finite(s.frames, p.frames);
        p.frameRate = finite(s.frameRate, 0);
        p.frameTime = finite(s.frameTime, 16.7) || 16.7;
        const len = clamp(finite(cfg.perf.historyLength, 120), 20, 500);
        p.fpsHistory.push(p.frameRate); if (p.fpsHistory.length > len) p.fpsHistory.shift();
        p.frameHistory.push(p.frameTime); if (p.frameHistory.length > len) p.frameHistory.shift();
        p.history.push({ at: now(), fps: p.frameRate, frameMs: p.frameTime, song: R.audio.songTime, objects: R.tracking.drawn });
        if (p.history.length > len) p.history.shift();
        session.stats.framesObserved++;
        if (cfg.perf.showWarnings && p.frameRate > 0 && p.frameRate < finite(cfg.perf.warnFps, 45) && p.warn !== 'fps') {
            p.warn = 'fps'; notify('performance', 'Performance warning', Math.round(p.frameRate) + ' FPS (below ' + cfg.perf.warnFps + ')');
            logEvent('perf', 'Low FPS: ' + Math.round(p.frameRate));
            setTimeout(() => { if (p.warn === 'fps') p.warn = ''; }, 10000);
        } else if (cfg.perf.showWarnings && p.frameTime > finite(cfg.perf.warnFrameMs, 25) && p.warn !== 'frame') {
            p.warn = 'frame'; logEvent('perf', 'High frame time: ' + round(p.frameTime, 1) + ' ms');
            setTimeout(() => { if (p.warn === 'frame') p.warn = ''; }, 10000);
        }
    }

    // =======================================================================
    // 10. Visual overlay + HUD layer (DOM over the Pixi canvas)
    // =======================================================================
    function initVisualLayer() {
        if (R.visual.canvasEl) return;
        const canvas = document.createElement('canvas');
        canvas.id = 'wo-visual'; canvas.className = 'wo-visual';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(canvas);
        R.visual.canvasEl = canvas; R.visual.canvas = canvas; R.visual.ctx = canvas.getContext('2d');
        const hud = document.createElement('div');
        hud.id = 'wo-hud'; hud.className = 'wo-hud';
        document.body.appendChild(hud);
        R.hud.layer = hud; R.hud.built = true;
        buildHudWidgets();
        const toasts = document.createElement('div');
        toasts.id = 'wo-toasts'; toasts.className = 'wo-toasts';
        document.body.appendChild(toasts);
        resizeOverlay();
        window.addEventListener('resize', resizeOverlay, { passive: true });
        window.addEventListener('orientationchange', resizeOverlay, { passive: true });
        if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeOverlay, { passive: true });
        window.addEventListener('pointermove', e => { R.pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
        logEvent('visual', 'Visual canvas and HUD layer attached');
    }
    function resizeOverlay() {
        const v = R.visual;
        if (!v.canvasEl) return;
        const dpr = clamp(window.devicePixelRatio || 1, 0.5, cfg.perf.lightweight ? 1 : 2);
        const w = window.innerWidth, h = window.innerHeight;
        v.dpr = dpr; v.w = w; v.h = h;
        v.canvasEl.width = Math.max(1, Math.round(w * dpr));
        v.canvasEl.height = Math.max(1, Math.round(h * dpr));
        v.canvasEl.style.width = w + 'px'; v.canvasEl.style.height = h + 'px';
        v.transform = null;
    }
    function playfieldTransform() {
        if (R.visual.transform) return R.visual.transform;
        const vw = Math.max(1, Math.round((window.visualViewport && window.visualViewport.width) || window.innerWidth));
        const vh = Math.max(1, Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight));
        const auto = clamp(Math.min(vw / 1100, vh / 640), 0.6, 1);
        const ui = auto * clamp(finite(R.site.uiScale, 1), 0.8, 1.6);
        const lw = vw / ui, lh = vh / ui;
        const scale = Math.min(lw / 640, lh / 480);
        const x = (lw - 512 * scale) / 2, y = (lh - 384 * scale) / 2 + 8 * scale;
        R.visual.transform = { scale: scale * ui, x: x * ui, y: y * ui, ui, vw, vh, lw, lh };
        return R.visual.transform;
    }
    function toScreen(x, y) { const t = playfieldTransform(); return { x: t.x + x * t.scale, y: t.y + y * t.scale }; }
    function rgba(hex, alpha) {
        if (!hex || hex[0] !== '#' || (hex.length !== 7 && hex.length !== 4)) return hex || '#ffffff';
        let h = hex.slice(1);
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        const n = parseInt(h, 16);
        return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + clamp(alpha, 0, 1) + ')';
    }
    function lowerBound(objs, time) {
        let lo = 0, hi = objs.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (objs[mid].time < time) lo = mid + 1; else hi = mid; }
        return lo;
    }
    function activeObjectIndex(t) {
        const objs = R.beatmap ? R.beatmap.objects : [];
        let i = lowerBound(objs, t) - 1;
        while (i >= 0 && objs[i].endTime > t && objs[i].time <= t) return i;
        return i >= 0 ? i : -1;
    }
    function objectLabel(o) { return o.kind === 'circle' ? 'Circle' : o.kind === 'slider' ? 'Slider' : 'Spinner'; }

    function drawVisuals() {
        const v = R.visual, ctx = v.ctx;
        if (!ctx || document.hidden) return;
        const startDraw = performance.now();
        ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
        ctx.clearRect(0, 0, v.w, v.h);
        const vs = cfg.visuals;
        if (!vs.enabled || !R.beatmap || !R.beatmap.objects.length) { R.tracking.drawn = 0; return; }
        const t = R.audio.inPlay || R.audio.playing ? R.audio.songTime : Math.max(0, R.audio.songTime);
        const tr = playfieldTransform();
        const objs = R.beatmap.objects;
        const preempt = R.beatmap.difficulty.preempt || 1200;
        const fadeIn = R.beatmap.difficulty.fadeIn || 400;
        const radius = R.beatmap.difficulty.circleRadius || 32;
        const range = clamp(finite(vs.trackingRange, 2200), 200, 12000);
        const alphaBase = clamp(finite(vs.alpha, 0.9), 0.05, 1);
        const start = Math.max(0, lowerBound(objs, t - Math.max(preempt * 0.6, finite(vs.objectTrailLength, 260))));
        const end = Math.min(objs.length, lowerBound(objs, t + range) + 2);
        const cur = activeObjectIndex(t), next = lowerBound(objs, t + 1);
        const upcoming = [];
        let drawn = 0, visible = 0, spacingSum = 0, spacingCount = 0;
        const colors = vs.colors || {};
        const comboColors = R.beatmap.comboColors || [];
        const colorOf = o => {
            if (vs.useComboColors && comboColors.length) {
                const c = comboColors[o.comboColorIndex % comboColors.length];
                return '#' + c.toString(16).padStart(6, '0');
            }
            return colors[o.kind] || '#ffffff';
        };
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';

        // --- trails between recent objects ---
        if (vs.trails) {
            const trailMs = clamp(finite(vs.objectTrailLength, 260), 50, 4000);
            ctx.lineWidth = finite(vs.trailWidth, 1.4);
            for (let i = start; i < end; i++) {
                const o = objs[i], p = objs[i - 1];
                if (!p || o.time < t - trailMs || o.time > t + range) continue;
                const a = toScreen(p.x, p.y), b = toScreen(o.x, o.y);
                const age = clamp(1 - Math.abs(o.time - t) / trailMs, 0, 1);
                ctx.strokeStyle = rgba(colors.trail || '#a970ff', alphaBase * age * 0.65);
                ctx.setLineDash(vs.style === 'retro' ? [5, 5] : []);
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // --- distance indicators between visible objects ---
        if (vs.distance) {
            ctx.font = Math.round(finite(vs.labelSize, 11) * 0.9) + 'px ' + 'ui-monospace, monospace';
            ctx.textAlign = 'center';
            for (let i = start; i < end; i++) {
                const o = objs[i], p = objs[i - 1];
                if (!p || o.time - t > range || o.time < t - preempt * 0.4) continue;
                const d = Math.hypot(o.x - p.x, o.y - p.y);
                spacingSum += d; spacingCount++;
                const a = toScreen(p.x, p.y), b = toScreen(o.x, o.y);
                if (d < 8) continue;
                ctx.strokeStyle = rgba(colors.upcoming || '#7ee787', alphaBase * 0.28);
                ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
                if (vs.showTimestamps) {
                    ctx.fillStyle = rgba('#ffffff', alphaBase * 0.6);
                    ctx.fillText(Math.round(d) + 'px', (a.x + b.x) / 2, (a.y + b.y) / 2 - 5);
                }
            }
        }

        // --- slider paths ---
        if (vs.sliderPaths) {
            for (let i = start; i < end; i++) {
                const o = objs[i];
                if (o.kind !== 'slider' || !o.path || o.time - t > range || o.time < t - o.duration - 200) continue;
                const pts = o.path.points;
                if (!pts || pts.length < 2) continue;
                const age = o.endTime < t ? clamp(1 - (t - o.endTime) / 300, 0, 1) : 1;
                const a = alphaBase * 0.55 * age;
                ctx.beginPath();
                let p0 = toScreen(pts[0].x, pts[0].y); ctx.moveTo(p0.x, p0.y);
                for (let k = 1; k < pts.length; k++) { const p = toScreen(pts[k].x, pts[k].y); ctx.lineTo(p.x, p.y); }
                ctx.lineWidth = Math.max(2, radius * 1.55 * tr.scale);
                ctx.strokeStyle = rgba(colors.slider || '#6be5ff', a * 0.55); ctx.stroke();
                ctx.lineWidth = Math.max(1, finite(vs.outlines, 1.8));
                ctx.strokeStyle = rgba(colors.slider || '#6be5ff', a); ctx.stroke();
                if (!cfg.perf.lightweight && vs.labels) {
                    ctx.fillStyle = rgba('#ffffff', a * 0.9);
                    ctx.font = Math.round(finite(vs.labelSize, 11)) + 'px ui-monospace, monospace';
                    ctx.textAlign = 'left';
                    const tail = toScreen(pts[pts.length - 1].x, pts[pts.length - 1].y);
                    ctx.fillText('SLIDER ' + fmtTime(o.duration) + (o.slides > 1 ? ' ×' + o.slides : ''), tail.x + 8, tail.y);
                    // ticks / repeats
                    ctx.fillStyle = rgba(colors.spinner || '#ffd166', a);
                    for (const ev of (o.events || []).slice(0, 40)) {
                        if (ev.kind !== 'tick' && ev.kind !== 'repeat') continue;
                        const p = toScreen(ev.x, ev.y);
                        ctx.beginPath(); ctx.arc(p.x, p.y, ev.kind === 'repeat' ? 4 : 2, 0, Math.PI * 2); ctx.fill();
                    }
                }
                // live slider ball
                if (t >= o.time && t <= o.endTime && o.spanDuration > 0) {
                    let prog = (t - o.time) / o.spanDuration;
                    const m = prog % 2;
                    prog = m <= 1 ? m : 2 - m;
                    const bp = o.path.pointAt(clamp(prog, 0, 1));
                    const s = toScreen(bp.x, bp.y);
                    ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(3, radius * 0.45 * tr.scale), 0, Math.PI * 2);
                    ctx.fillStyle = rgba(colors.slider || '#6be5ff', alphaBase); ctx.fill();
                }
            }
        }

        // --- objects ---
        for (let i = start; i < end; i++) {
            const o = objs[i], dt = o.time - t;
            if (dt > range) break;
            if (dt < -Math.max(preempt * 0.35, o.duration || 0)) continue;
            const p = o.kind === 'spinner' ? toScreen(256, 192) : toScreen(o.x, o.y);
            const approach = clamp((preempt - dt) / preempt, 0, 1.6);
            let a = alphaBase * clamp((preempt - dt) / Math.max(1, fadeIn), 0, 1);
            if (dt < 0) a *= clamp(1 + dt / Math.max(1, preempt * 0.3), 0, 1);
            if (a < 0.02) continue;
            const isCurrent = i === cur || (o.endTime > t && o.time <= t);
            const isNext = i === next;
            const col = isCurrent && vs.highlightUpcoming ? '#ffffff' : isNext && vs.highlightUpcoming ? (colors.upcoming || '#7ee787') : colorOf(o);
            const r = Math.max(3, radius * tr.scale);
            const glow = vs.style === 'neon';
            ctx.save();
            if (glow) { ctx.shadowColor = rgba(col, a * 0.8); ctx.shadowBlur = cfg.perf.lightweight ? 0 : 12; }

            if (o.kind === 'spinner' && vs.spinner) {
                const sr = Math.min(tr.scale * 180, Math.min(v.w, v.h) * 0.22);
                const prog = clamp((t - o.time) / Math.max(1, o.duration), 0, 1);
                ctx.strokeStyle = rgba(colors.spinner || '#ffd166', a * 0.35);
                ctx.lineWidth = Math.max(2, r * 0.5);
                ctx.beginPath(); ctx.arc(p.x, p.y, sr, 0, Math.PI * 2); ctx.stroke();
                ctx.strokeStyle = rgba(colors.spinner || '#ffd166', a);
                ctx.lineWidth = Math.max(2, r * 0.28);
                ctx.beginPath(); ctx.arc(p.x, p.y, sr, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); ctx.stroke();
                if (vs.labels) {
                    ctx.fillStyle = rgba('#ffffff', a);
                    ctx.font = Math.round(finite(vs.labelSize, 11) + 2) + 'px ui-monospace, monospace'; ctx.textAlign = 'center';
                    ctx.fillText('SPINNER ' + Math.round(prog * 100) + '%', p.x, p.y - sr - 12);
                    ctx.fillText(fmtTime(o.duration) + ' · ' + fmtTime(Math.max(0, o.endTime - t)) + ' left', p.x, p.y + sr + 20);
                }
            } else {
                if (vs.circles) {
                    ctx.lineWidth = Math.max(1, finite(vs.outlines, 1.8));
                    if (vs.style === 'solid') {
                        ctx.fillStyle = rgba(col, a * 0.35); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
                    }
                    ctx.strokeStyle = rgba(col, a); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
                    if (vs.style === 'retro') {
                        ctx.setLineDash([4, 5]); ctx.strokeStyle = rgba(col, a * 0.6);
                        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.72, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
                    }
                    if (isCurrent || isNext) {
                        ctx.strokeStyle = rgba('#ffffff', a * 0.85); ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.arc(p.x, p.y, r + 5 + Math.sin(now() / 180) * 2, 0, Math.PI * 2); ctx.stroke();
                    }
                }
                if (vs.approach && dt > 0) {
                    const ar = r + r * 3 * clamp(1 - approach, 0, 1);
                    ctx.lineWidth = Math.max(1, finite(vs.outlines, 1.8) * 0.8);
                    ctx.strokeStyle = rgba(colors.approach || '#ffffff', a * 0.75);
                    ctx.beginPath(); ctx.arc(p.x, p.y, ar, 0, Math.PI * 2); ctx.stroke();
                }
                if (vs.labels) {
                    ctx.font = Math.round(finite(vs.labelSize, 11)) + 'px ui-monospace, monospace';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    const num = vs.ids ? String(o.comboNumber || (i + 1)) : '';
                    ctx.fillStyle = rgba('#ffffff', Math.min(1, a * 1.2));
                    if (num) ctx.fillText(num, p.x, p.y);
                    const tag = [];
                    if (vs.ids) tag.push('#' + (i + 1));
                    if (vs.showTimestamps) tag.push(fmtTime(o.time));
                    if (vs.showVisibility) tag.push(dt <= preempt && dt > -100 ? 'VIS' : 'queue');
                    if (tag.length) {
                        ctx.font = Math.round(Math.max(9, finite(vs.labelSize, 11) - 1)) + 'px ui-monospace, monospace';
                        ctx.fillStyle = rgba(col, Math.min(1, a * 1.1));
                        ctx.fillText(tag.join(' · '), p.x, p.y + r + 12);
                    }
                }
            }
            ctx.restore();
            if (dt <= preempt && dt > -100) visible++;
            drawn++;
            if (dt > 0 && upcoming.length < clamp(finite(vs.upcomingCount, 8), 0, 40)) upcoming.push(i);
        }

        // --- upcoming markers beyond the playfield window ---
        if (vs.upcoming && !cfg.perf.lightweight) {
            const from = Math.max(end - 1, lowerBound(objs, t + preempt));
            for (let i = from; i < Math.min(objs.length, from + 40); i++) {
                const o = objs[i]; if (o.time - t > range * 1.5) break;
                const p = o.kind === 'spinner' ? toScreen(256, 192) : toScreen(o.x, o.y);
                const a = alphaBase * clamp(1 - (o.time - t - preempt) / Math.max(1, range), 0.1, 0.8);
                ctx.fillStyle = rgba(colors.upcoming || '#7ee787', a);
                ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
                if (vs.ids && i < from + 8) {
                    ctx.fillStyle = rgba('#ffffff', a); ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center';
                    ctx.fillText(String(i + 1), p.x, p.y - 7);
                }
            }
        }

        // --- object information panels (current + next) ---
        if (vs.infoPanels && !cfg.perf.lightweight && (cur >= 0 || next < objs.length)) {
            const list = [];
            if (cur >= 0) list.push({ o: objs[cur], label: 'CURRENT' });
            if (next < objs.length && next !== cur) list.push({ o: objs[next], label: 'NEXT' });
            for (let k = 0; k < list.length; k++) {
                const { o, label } = list[k];
                const p = o.kind === 'spinner' ? toScreen(256, 192) : toScreen(o.x, o.y);
                const lines = [label + ' · ' + objectLabel(o), '#' + (o.index + 1) + ' · ' + fmtTime(o.time), 'pos ' + Math.round(o.x) + ',' + Math.round(o.y) + ' · combo ' + (o.comboNumber || 0), o.kind === 'slider' ? 'len ' + fmtTime(o.duration) + ' · ' + o.slides + ' slides' : o.kind === 'spinner' ? 'spin ' + fmtTime(o.duration) : 'AR ' + round(R.beatmap.difficulty.ar, 1)];
                const w = 178, h = 16 * lines.length + 12;
                const bx = clamp(p.x + radius * tr.scale + 14, 8, v.w - w - 8), by = clamp(p.y - h / 2 + k * 12, 8, v.h - h - 8);
                ctx.fillStyle = rgba('#0b0b11', alphaBase * 0.82);
                ctx.strokeStyle = rgba(colors.upcoming || '#7ee787', alphaBase * 0.7); ctx.lineWidth = 1;
                roundRect(ctx, bx, by, w, h, 6); ctx.fill(); ctx.stroke();
                ctx.textAlign = 'left'; ctx.textBaseline = 'top';
                ctx.font = '11px ui-monospace, monospace';
                lines.forEach((ln, j) => { ctx.fillStyle = j === 0 ? rgba(colorOf(o), alphaBase) : rgba('#d9d6e8', alphaBase * 0.9); ctx.fillText(ln, bx + 8, by + 6 + j * 16); });
            }
        }

        // --- density heatmap strip ---
        if (vs.densityOverlay && moduleOn('densityHeatmap') && !cfg.perf.lightweight) {
            const an = analysis();
            if (an && an.sections.length) {
                const x0 = tr.x, y0 = tr.y + 384 * tr.scale + 10 * tr.ui;
                const w = 512 * tr.scale, h = Math.max(6, 9 * tr.ui);
                let max = 1; for (const s of an.sections) max = Math.max(max, s.density);
                for (let i = 0; i < an.sections.length; i++) {
                    const s = an.sections[i], f = s.density / max;
                    ctx.fillStyle = 'rgba(' + Math.round(80 + 175 * f) + ',' + Math.round(220 - 120 * f) + ',' + Math.round(255 - 155 * f) + ',' + (alphaBase * (0.18 + 0.72 * f)) + ')';
                    ctx.fillRect(x0 + (i / an.sections.length) * w, y0, Math.max(1, w / an.sections.length - 1), h);
                }
                const playX = x0 + clamp(t / Math.max(1, an.songDuration), 0, 1) * w;
                ctx.fillStyle = rgba('#ffffff', alphaBase); ctx.fillRect(playX - 1, y0 - 3, 2, h + 6);
                ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = rgba('#ffffff', alphaBase * 0.7);
                ctx.fillText('density ' + round(an.sections[clamp(Math.floor(t / (an.sectionSec * 1000)), 0, an.sections.length - 1)].density, 1) + ' obj/s', x0, y0 + h + 12);
            }
        }

        // --- custom crosshair ---
        if (vs.crosshair.enabled && moduleOn('customCrosshair')) {
            const cr = vs.crosshair, c = cr.center || !R.pointer ? toScreen(256, 192) : { x: R.pointer.x, y: R.pointer.y };
            const size = clamp(finite(cr.size, 18), 3, 120), gap = clamp(finite(cr.gap, 5), 0, 60), th = clamp(finite(cr.thickness, 2), 1, 12);
            ctx.strokeStyle = rgba(cr.color || '#ffffff', alphaBase); ctx.lineWidth = th;
            ctx.beginPath();
            ctx.moveTo(c.x - size - gap, c.y); ctx.lineTo(c.x - gap, c.y);
            ctx.moveTo(c.x + gap, c.y); ctx.lineTo(c.x + size + gap, c.y);
            ctx.moveTo(c.x, c.y - size - gap); ctx.lineTo(c.x, c.y - gap);
            ctx.moveTo(c.x, c.y + gap); ctx.lineTo(c.x, c.y + size + gap);
            ctx.stroke();
            if (cr.dot) { ctx.fillStyle = rgba(cr.color || '#ffffff', alphaBase); ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(1, th / 2), 0, Math.PI * 2); ctx.fill(); }
            ctx.strokeStyle = rgba(cr.color || '#ffffff', alphaBase * 0.4);
            ctx.beginPath(); ctx.arc(c.x, c.y, size + gap, 0, Math.PI * 2); ctx.stroke();
        }

        // --- selected-object highlight (from inspector) ---
        if (R.tracking.selectedIndex >= 0 && objs[R.tracking.selectedIndex]) {
            const o = objs[R.tracking.selectedIndex], p = o.kind === 'spinner' ? toScreen(256, 192) : toScreen(o.x, o.y);
            ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.arc(p.x, p.y, radius * tr.scale + 12, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }

        R.tracking.visible = visible; R.tracking.drawn = drawn; R.tracking.currentIndex = cur;
        R.tracking.spacing = spacingCount ? spacingSum / spacingCount : 0;
        R.tracking.nextObjects = upcoming;
        R.tracking.density = objs.length ? (lowerBound(objs, t + 1000) - lowerBound(objs, t - 1000)) / 2 : 0;
        R.tracking.status = R.beatmap ? (R.audio.playing ? 'live' : 'ready') : 'unavailable';
        R.tracking.lastUpdate = now();
        session.stats.maxObjectsOnScreen = Math.max(session.stats.maxObjectsOnScreen, drawn);
        session.stats.objectsTracked += drawn;
        R.perf.renderMs = performance.now() - startDraw;
        R.perf.renderHistory.push(R.perf.renderMs);
        if (R.perf.renderHistory.length > 120) R.perf.renderHistory.shift();
    }
    function roundRect(ctx, x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y); ctx.closePath();
    }

    // ---- HUD widgets ----
    function hudStyle(id) {
        const def = DEFAULTS.hud.elements[id] || HUD_DEFS.find(d => d.id === id);
        return mergeDeep(def, (cfg.hud.elements && cfg.hud.elements[id]) || {});
    }
    function buildHudWidgets() {
        const layer = R.hud.layer; if (!layer) return;
        layer.innerHTML = '';
        R.hud.widgets.clear();
        for (const def of HUD_DEFS) {
            const el = document.createElement('div');
            el.className = 'wo-hud-widget'; el.dataset.id = def.id;
            el.innerHTML = '<div class="wo-hud-title"></div><div class="wo-hud-body"></div><div class="wo-resize" title="Resize"></div>';
            layer.appendChild(el);
            R.hud.widgets.set(def.id, el);
            el.addEventListener('pointerdown', onHudPointerDown);
            el.addEventListener('click', () => { cfg.hud.selected = def.id; if (R.ui.built && cfg.activeSection === 'hud') refreshActiveSection(true); });
        }
        applyHudStyles();
        updateHud(true);
    }
    function applyHudStyles() {
        for (const [id, el] of R.hud.widgets) {
            const s = hudStyle(id);
            const editing = cfg.hud.editMode || cfg.hud.preview;
            el.style.display = (cfg.hud.enabled && s.visible) ? '' : 'none';
            el.style.left = clamp(finite(s.x, 1), 0, 95) + '%';
            el.style.top = clamp(finite(s.y, 1), 0, 95) + '%';
            el.style.width = clamp(finite(s.w, 200), 90, 800) * clamp(finite(cfg.uiScale, 1), 0.7, 1.5) + 'px';
            el.style.height = clamp(finite(s.h, 60), 32, 500) * clamp(finite(cfg.uiScale, 1), 0.7, 1.5) + 'px';
            el.style.color = s.color || '#e8e6f2';
            el.style.opacity = clamp(finite(s.opacity, 0.86), 0.1, 1);
            el.style.fontSize = clamp(finite(s.font, 13), 8, 28) + 'px';
            el.style.pointerEvents = editing ? 'auto' : 'none';
            el.classList.toggle('wo-hud-editing', editing);
            el.classList.toggle('wo-hud-selected', cfg.hud.selected === id && editing);
            const title = el.querySelector('.wo-hud-title'); if (title) title.textContent = s.name || id;
        }
        if (R.hud.layer) R.hud.layer.style.pointerEvents = 'none';
    }
    function onHudPointerDown(e) {
        if (!cfg.hud.editMode && !cfg.hud.preview) return;
        const el = e.currentTarget, id = el.dataset.id, s = hudStyle(id);
        e.preventDefault(); e.stopPropagation();
        const resize = e.target.classList.contains('wo-resize');
        R.hud.drag = { id, el, resize, startX: e.clientX, startY: e.clientY, x: finite(s.x, 1), y: finite(s.y, 1), w: finite(s.w, 200), h: finite(s.h, 60) };
        cfg.hud.selected = id;
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
        applyHudStyles();
    }
    function onHudPointerMove(e) {
        const d = R.hud.drag; if (!d) return;
        const scale = clamp(finite(cfg.uiScale, 1), 0.7, 1.5);
        const dxPct = (e.clientX - d.startX) / Math.max(1, window.innerWidth) * 100;
        const dyPct = (e.clientY - d.startY) / Math.max(1, window.innerHeight) * 100;
        const target = cfg.hud.elements[d.id] || (cfg.hud.elements[d.id] = clone(DEFAULTS.hud.elements[d.id] || {}));
        const nx = clamp(d.x + dxPct, 0, 95), ny = clamp(d.y + dyPct, 0, 95);
        const nw = clamp(d.w + (e.clientX - d.startX) / scale, 90, 800), nh = clamp(d.h + (e.clientY - d.startY) / scale, 32, 500);
        if (cfg.hud.preview && !cfg.hud.editMode) {
            // Preview mode: show the change on screen but never persist it.
            d.el.style.left = nx + '%'; d.el.style.top = ny + '%';
            d.el.style.width = nw * scale + 'px'; d.el.style.height = nh * scale + 'px';
            return;
        }
        if (d.resize) { target.w = nw; target.h = nh; }
        else { target.x = nx; target.y = ny; }
        applyHudStyles();
    }
    function onHudPointerUp() {
        if (!R.hud.drag) return;
        const id = R.hud.drag.id, previewOnly = cfg.hud.preview && !cfg.hud.editMode;
        R.hud.drag = null;
        if (previewOnly) {
            applyHudStyles();
            notify('info', 'HUD preview discarded', 'Turn on Edit mode to persist drag and resize changes.');
            logEvent('hud', 'HUD preview for "' + id + '" discarded (not saved)');
            return;
        }
        saveConfig(); refreshActiveSection(true);
        logEvent('hud', 'HUD element "' + id + '" repositioned');
    }
    function hudContent(id) {
        const b = R.beatmap, a = R.audio, an = analysis(), t = a.songTime;
        const meta = b ? b.data.metadata : null;
        const diff = currentDiffSummary();
        switch (id) {
            case 'song': return meta ? '<b>' + esc(meta.title) + '</b><br><span>' + esc(meta.artist) + '</span><br><small>' + esc(meta.creator) + ' · [' + esc(meta.version) + ']</small>' : '<b>No beatmap loaded</b><br><span>Select a difficulty in WOSU</span>';
            case 'clock': return '<b>' + fmtTimePrecise(t) + '</b><br><span>' + fmtTime(a.duration) + ' · ' + round(a.rate, 2) + 'x</span><br><small>' + (a.playing ? 'PLAYING' : a.ctxState === 'suspended' ? 'SUSPENDED' : 'IDLE') + '</small>';
            case 'objects': {
                const counts = b ? { circles: b.objects.filter(o => o.kind === 'circle').length, sliders: b.objects.filter(o => o.kind === 'slider').length, spinners: b.objects.filter(o => o.kind === 'spinner').length } : null;
                const remaining = b ? Math.max(0, b.objects.length - lowerBound(b.objects, t)) : 0;
                return '<b>' + (b ? b.objects.length : 0) + ' objects · ' + remaining + ' left</b><br><span>' + (counts ? 'C ' + counts.circles + ' · S ' + counts.sliders + ' · P ' + counts.spinners : '—') + '</span><br><small>visible ' + R.tracking.visible + ' · drawn ' + R.tracking.drawn + '</small>';
            }
            case 'fps': return '<b>' + Math.round(R.perf.frameRate || R.perf.ownFps) + ' FPS</b><br><span>' + round(R.perf.frameTime, 1) + ' ms · render ' + round(R.perf.renderMs, 1) + ' ms</span><br><small>updates ' + round(R.perf.trackingHz, 1) + ' Hz</small>';
            case 'sync': return '<b>' + (a.syncLost ? 'SYNC LOST' : a.playing ? 'SYNCHRONIZED' : 'NO AUDIO') + '</b><br><span>offset ' + round(a.offsetMs, 1) + ' ms · drift ' + round(a.driftMs, 1) + ' ms</span><br><small>ctx ' + esc(a.ctxState) + ' · ' + Math.round(a.sampleRate / 1000) + ' kHz</small>';
            case 'progress': {
                const p = a.duration > 0 ? clamp(t / a.duration, 0, 1) : 0;
                return '<div class="wo-bar"><i style="width:' + (p * 100).toFixed(2) + '%"></i></div><span>' + fmtTime(t) + ' / ' + fmtTime(a.duration) + ' · ' + (p * 100).toFixed(1) + '%</span>';
            }
            case 'currentObject': {
                const idx = R.tracking.currentIndex;
                const o = b && idx >= 0 ? b.objects[idx] : null;
                return o ? '<b>#' + (o.index + 1) + ' ' + objectLabel(o) + '</b><br><span>' + fmtTime(o.time) + ' → ' + fmtTime(o.endTime) + '</span><br><small>' + Math.round(o.x) + ',' + Math.round(o.y) + ' · combo ' + o.comboNumber + '</small>' : '<b>No current object</b><br><span>Waiting for playback</span>';
            }
            case 'bpm': {
                const cp = b ? cpAt(b.controlPoints, t) : null;
                return '<b>' + (cp ? fmtNum(60000 / cp.beatLength, 1) : '—') + ' BPM</b><br><span>meter ' + (cp ? cp.meter : '—') + ' · SV ' + (cp ? round(cp.sliderVelocity, 2) : '—') + 'x</span><br><small>' + (cp && cp.kiai ? 'KIAI' : 'normal') + (an ? ' · range ' + fmtNum(an.bpmMin, 0) + '-' + fmtNum(an.bpmMax, 0) : '') + '</small>';
            }
            case 'density': return '<b>' + round(R.tracking.density, 1) + ' obj/s</b><br><span>spacing ' + round(R.tracking.spacing, 0) + ' px</span><br><small>' + (an ? 'peak section ' + (an.highDensity[0] ? fmtTime(an.highDensity[0].start) : '—') : '—') + '</small>';
            case 'warnings': {
                const w = [];
                if (R.perf.warn) w.push(R.perf.warn === 'fps' ? 'Low FPS' : 'High frame time');
                if (a.syncLost) w.push('Audio drift ' + round(a.driftMs, 1) + ' ms');
                if (!R.beatmap) w.push('Tracking unavailable');
                if (!R.lib.dbOk) w.push('Library not readable');
                return w.length ? '<b>⚠ ' + esc(w.join(' · ')) + '</b>' : '<b>All systems nominal</b><br><span>No warnings</span>';
            }
        }
        return '';
    }
    function updateHud(force) {
        if (!R.hud.built || !cfg.hud.enabled) return;
        for (const [id, el] of R.hud.widgets) {
            const body = el.querySelector('.wo-hud-body'); if (!body) continue;
            const html = hudContent(id);
            if (force || body.innerHTML !== html) body.innerHTML = html;
        }
    }

    // =======================================================================
    // 11. Styles (Neverlose-inspired premium dark UI)
    // =======================================================================
    const CSS = `
:root{
  --wo-bg:#0b0b11; --wo-panel:#101019; --wo-panel2:#151521; --wo-line:#26263a;
  --wo-text:#e8e6f2; --wo-sub:#8987a3; --wo-accent:#a970ff; --wo-accent2:#5ad1ff;
  --wo-good:#7ee787; --wo-warn:#ffcc66; --wo-bad:#ff6b81; --wo-scale:1;
  --wo-opacity:.96; --wo-radius:10px; --wo-notif-radius:8px; --wo-notif-blur:16px;
}
.wo-visual{position:fixed!important;inset:0;pointer-events:none!important;z-index:2147483000!important;}
.wo-hud{position:fixed!important;inset:0;pointer-events:none!important;z-index:2147483001!important;font-family:'Segoe UI',Inter,system-ui,sans-serif;}
.wo-hud-widget{position:absolute;box-sizing:border-box;padding:8px 10px;border-radius:8px;background:rgba(9,9,16,.72);border:1px solid rgba(255,255,255,.10);box-shadow:0 6px 24px rgba(0,0,0,.35);backdrop-filter:blur(8px);line-height:1.45;overflow:hidden;transition:box-shadow .18s,border-color .18s;}
.wo-hud-widget .wo-hud-title{font-size:.72em;letter-spacing:.14em;text-transform:uppercase;opacity:.62;margin-bottom:3px;font-weight:700;}
.wo-hud-widget .wo-hud-body b{font-weight:700;}
.wo-hud-widget .wo-hud-body span{opacity:.85;}
.wo-hud-widget .wo-hud-body small{opacity:.62;font-size:.78em;}
.wo-hud-widget .wo-resize{display:none;position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--wo-accent) 50%);border-bottom-right-radius:7px;}
.wo-hud-editing{cursor:move;border:1px dashed var(--wo-accent)!important;box-shadow:0 0 0 2px rgba(169,112,255,.18),0 8px 28px rgba(0,0,0,.5)!important;}
.wo-hud-editing .wo-resize{display:block;}
.wo-hud-selected{outline:2px solid var(--wo-accent2);}
.wo-bar{height:7px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;margin:4px 0 5px;}
.wo-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--wo-accent),var(--wo-accent2));border-radius:4px;}
.wo-toasts{position:fixed!important;z-index:2147483003!important;pointer-events:none!important;display:flex;flex-direction:column;gap:8px;max-width:360px;padding:14px;}
.wo-toasts.pos-top-right{top:0;right:0;align-items:flex-end;} .wo-toasts.pos-top-left{top:0;left:0;align-items:flex-start;}
.wo-toasts.pos-bottom-right{bottom:0;right:0;align-items:flex-end;} .wo-toasts.pos-bottom-left{bottom:0;left:0;align-items:flex-start;}
.wo-toast{pointer-events:auto;min-width:230px;max-width:360px;padding:10px 13px;border-radius:var(--wo-notif-radius);background:rgba(14,14,22,var(--wo-opacity));border:1px solid var(--wo-line);border-left:3px solid var(--wo-accent);box-shadow:0 10px 34px rgba(0,0,0,.5);backdrop-filter:blur(var(--wo-notif-blur));color:var(--wo-text);font:12px/1.45 'Segoe UI',Inter,system-ui,sans-serif;animation:wo-in .28s cubic-bezier(.2,.9,.25,1);}
.wo-toast b{display:block;font-size:12px;letter-spacing:.02em;margin-bottom:2px;}
.wo-toast span{color:var(--wo-sub);font-size:11px;}
.wo-toast .wo-toast-meta{font-size:9px;text-transform:uppercase;letter-spacing:.14em;color:var(--wo-accent);margin-bottom:3px;}
.wo-toast.bad{border-left-color:var(--wo-bad);} .wo-toast.good{border-left-color:var(--wo-good);} .wo-toast.warn{border-left-color:var(--wo-warn);}
@keyframes wo-in{from{opacity:0;transform:translateY(-8px) scale(.97);}to{opacity:1;transform:none;}}
.wo-root{position:fixed!important;z-index:2147483002!important;display:flex;flex-direction:column;color:var(--wo-text);font:12px/1.5 'Segoe UI',Inter,system-ui,sans-serif;background:linear-gradient(160deg,rgba(16,16,25,var(--wo-opacity)),rgba(9,9,15,var(--wo-opacity)));border:1px solid var(--wo-line);border-radius:12px;box-shadow:0 24px 90px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.02) inset,0 0 40px rgba(169,112,255,.07);backdrop-filter:blur(18px);overflow:hidden;box-sizing:border-box;transition:opacity .22s,box-shadow .22s,border-color .22s;}
.wo-root.wo-hidden{display:none!important;}
.wo-header{height:50px;flex:0 0 50px;display:flex;align-items:center;gap:12px;padding:0 14px;background:linear-gradient(90deg,rgba(169,112,255,.10),rgba(90,209,255,.03));border-bottom:1px solid var(--wo-line);cursor:move;user-select:none;}
.wo-brand{font-weight:800;letter-spacing:.20em;font-size:13px;white-space:nowrap;background:linear-gradient(90deg,var(--wo-accent),var(--wo-accent2));-webkit-background-clip:text;background-clip:text;color:transparent;}
.wo-brand small{display:block;font-size:8px;letter-spacing:.28em;color:var(--wo-sub);-webkit-text-fill-color:var(--wo-sub);margin-top:-2px;}
.wo-header-mid{flex:1;display:flex;align-items:center;gap:8px;min-width:0;}
.wo-search{width:100%;max-width:290px;background:rgba(0,0,0,.32);border:1px solid var(--wo-line);border-radius:7px;padding:6px 10px;color:var(--wo-text);font-size:11px;outline:none;transition:border-color .18s,box-shadow .18s;}
.wo-search:focus{border-color:var(--wo-accent);box-shadow:0 0 0 2px rgba(169,112,255,.16);}
.wo-header-status{display:flex;align-items:center;gap:6px;color:var(--wo-sub);font-size:10px;text-transform:uppercase;letter-spacing:.10em;white-space:nowrap;}
.wo-dot{width:7px;height:7px;border-radius:50%;background:var(--wo-good);box-shadow:0 0 8px var(--wo-good);}
.wo-dot.off{background:var(--wo-bad);box-shadow:0 0 8px var(--wo-bad);}
.wo-header-actions{display:flex;gap:5px;}
.wo-icon-btn{width:27px;height:27px;border-radius:7px;border:1px solid var(--wo-line);background:rgba(255,255,255,.03);color:var(--wo-sub);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;transition:all .16s;}
.wo-icon-btn:hover{color:var(--wo-text);border-color:var(--wo-accent);background:rgba(169,112,255,.13);transform:translateY(-1px);}
.wo-icon-btn.active{color:var(--wo-accent);border-color:var(--wo-accent);}
.wo-body{flex:1;display:flex;min-height:0;}
.wo-sidebar{width:198px;flex:0 0 198px;background:rgba(0,0,0,.20);border-right:1px solid var(--wo-line);display:flex;flex-direction:column;overflow:hidden;transition:width .25s cubic-bezier(.2,.8,.2,1),flex-basis .25s;}
.wo-root.wo-collapsed .wo-sidebar,.wo-root.wo-compact .wo-sidebar{width:52px;flex-basis:52px;}
.wo-side-items{overflow-y:auto;overflow-x:hidden;padding:9px 7px;flex:1;}
.wo-side-item{display:flex;align-items:center;gap:10px;padding:8px 9px;margin-bottom:2px;border-radius:7px;cursor:pointer;color:var(--wo-sub);white-space:nowrap;position:relative;transition:background .16s,color .16s,transform .16s;border:1px solid transparent;}
.wo-side-item:hover{background:rgba(255,255,255,.04);color:var(--wo-text);transform:translateX(2px);}
.wo-side-item.active{background:linear-gradient(90deg,rgba(169,112,255,.20),rgba(169,112,255,.03));color:var(--wo-text);border-color:rgba(169,112,255,.28);}
.wo-side-item.active:before{content:'';position:absolute;left:-7px;top:6px;bottom:6px;width:3px;border-radius:3px;background:var(--wo-accent);box-shadow:0 0 10px var(--wo-accent);}
.wo-side-icon{width:20px;text-align:center;font-size:14px;flex:0 0 20px;}
.wo-side-label{font-size:11px;font-weight:600;letter-spacing:.02em;overflow:hidden;text-overflow:ellipsis;}
.wo-root.wo-collapsed .wo-side-label,.wo-root.wo-compact .wo-side-label,.wo-root.wo-collapsed .wo-side-foot,.wo-root.wo-compact .wo-side-foot{display:none;}
.wo-side-foot{padding:10px;border-top:1px solid var(--wo-line);font-size:9px;color:var(--wo-sub);letter-spacing:.08em;text-transform:uppercase;line-height:1.7;}
.wo-side-foot b{color:var(--wo-accent);}
.wo-content{flex:1;min-width:0;overflow-y:auto;overflow-x:hidden;padding:14px 16px 24px;scrollbar-width:thin;scrollbar-color:var(--wo-line) transparent;}
.wo-content::-webkit-scrollbar,.wo-side-items::-webkit-scrollbar{width:8px;}.wo-content::-webkit-scrollbar-thumb,.wo-side-items::-webkit-scrollbar-thumb{background:var(--wo-line);border-radius:8px;}
.wo-section{display:none;animation:wo-fade .22s ease;}.wo-section.active{display:block;}
@keyframes wo-fade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
.wo-section-head{display:flex;align-items:baseline;gap:10px;margin:0 0 12px;}
.wo-section-head h2{font-size:17px;margin:0;font-weight:750;letter-spacing:.02em;}
.wo-section-head span{font-size:10px;color:var(--wo-sub);letter-spacing:.10em;text-transform:uppercase;}
.wo-card{background:linear-gradient(165deg,rgba(255,255,255,.028),rgba(255,255,255,.006));border:1px solid var(--wo-line);border-radius:var(--wo-radius);padding:13px 14px;margin-bottom:12px;box-shadow:0 2px 12px rgba(0,0,0,.16);transition:border-color .18s,box-shadow .18s;}
.wo-card:hover{border-color:rgba(169,112,255,.28);}
.wo-card.wo-highlight{border-color:var(--wo-accent)!important;box-shadow:0 0 0 2px rgba(169,112,255,.25),0 0 30px rgba(169,112,255,.18)!important;}
.wo-card h3{margin:0 0 3px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--wo-text);}
.wo-card .wo-card-sub{font-size:10px;color:var(--wo-sub);margin:0 0 10px;}
.wo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;}
.wo-grid.tight{grid-template-columns:repeat(auto-fill,minmax(132px,1fr));}
.wo-grid.cols2{grid-template-columns:repeat(2,minmax(0,1fr));}
.wo-grid.cols3{grid-template-columns:repeat(3,minmax(0,1fr));}
.wo-stat{background:rgba(0,0,0,.26);border:1px solid rgba(255,255,255,.055);border-radius:7px;padding:8px 10px;min-width:0;}
.wo-stat label{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:var(--wo-sub);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wo-stat .wo-live{display:block;font-size:13px;font-weight:650;color:var(--wo-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wo-stat .wo-live.good{color:var(--wo-good);} .wo-stat .wo-live.warn{color:var(--wo-warn);} .wo-stat .wo-live.bad{color:var(--wo-bad);}
.wo-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.045);min-height:32px;}
.wo-row:last-child{border-bottom:0;}
.wo-row-main{flex:1;min-width:0;}
.wo-row-main label{display:block;font-size:11px;font-weight:600;color:var(--wo-text);cursor:pointer;}
.wo-row-main small{display:block;font-size:10px;color:var(--wo-sub);line-height:1.35;}
.wo-root.wo-compact .wo-row-main small{display:none;}
.wo-row-ctl{flex:0 0 auto;display:flex;align-items:center;gap:7px;}
.wo-btn{border:1px solid var(--wo-line);background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.015));color:var(--wo-text);border-radius:6px;padding:6px 11px;font-size:10.5px;font-weight:650;letter-spacing:.03em;cursor:pointer;transition:all .16s;white-space:nowrap;}
.wo-btn:hover{border-color:var(--wo-accent);background:rgba(169,112,255,.15);transform:translateY(-1px);box-shadow:0 4px 14px rgba(169,112,255,.15);}
.wo-btn:active{transform:translateY(0);}
.wo-btn.primary{background:linear-gradient(90deg,var(--wo-accent),var(--wo-accent2));border-color:transparent;color:#0b0b11;}
.wo-btn.danger:hover{border-color:var(--wo-bad);background:rgba(255,107,129,.14);box-shadow:0 4px 14px rgba(255,107,129,.12);}
.wo-btn.small{padding:3px 7px;font-size:9.5px;}
.wo-btn.active{border-color:var(--wo-accent);color:var(--wo-accent);}
.wo-btn[disabled]{opacity:.4;cursor:not-allowed;transform:none;}
.wo-btnbar{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.wo-switch{position:relative;width:34px;height:18px;flex:0 0 34px;cursor:pointer;}
.wo-switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;z-index:2;}
.wo-switch i{position:absolute;inset:0;border-radius:12px;background:rgba(255,255,255,.10);border:1px solid var(--wo-line);transition:all .2s;}
.wo-switch i:after{content:'';position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:var(--wo-sub);transition:all .2s;}
.wo-switch input:checked + i{background:linear-gradient(90deg,var(--wo-accent),var(--wo-accent2));border-color:transparent;}
.wo-switch input:checked + i:after{transform:translateX(16px);background:#fff;box-shadow:0 0 8px rgba(255,255,255,.7);}
.wo-range{width:120px;accent-color:var(--wo-accent);cursor:pointer;}
.wo-range-out{min-width:52px;text-align:right;font:10px ui-monospace,monospace;color:var(--wo-accent2);}
.wo-select,.wo-input,.wo-number{background:rgba(0,0,0,.32);border:1px solid var(--wo-line);border-radius:6px;color:var(--wo-text);padding:5px 8px;font-size:10.5px;outline:none;max-width:190px;transition:border-color .16s;}
.wo-select:focus,.wo-input:focus,.wo-number:focus{border-color:var(--wo-accent);}
.wo-number{width:72px;} .wo-input{width:150px;}
input[type=color].wo-color{width:34px;height:24px;padding:0;border:1px solid var(--wo-line);border-radius:5px;background:transparent;cursor:pointer;}
.wo-table{width:100%;border-collapse:collapse;font-size:10.5px;}
.wo-table th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.10em;color:var(--wo-sub);font-weight:700;padding:6px 7px;border-bottom:1px solid var(--wo-line);position:sticky;top:0;background:var(--wo-panel);z-index:1;}
.wo-table td{padding:5px 7px;border-bottom:1px solid rgba(255,255,255,.04);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;}
.wo-table tr:hover td{background:rgba(169,112,255,.07);}
.wo-table tr.wo-sel td{background:rgba(90,209,255,.10);color:#fff;}
.wo-table .num{font-family:ui-monospace,monospace;color:var(--wo-accent2);}
.wo-table-wrap{max-height:230px;overflow:auto;border:1px solid var(--wo-line);border-radius:7px;}
.wo-canvas{width:100%;height:120px;display:block;border-radius:7px;background:rgba(0,0,0,.28);border:1px solid var(--wo-line);cursor:crosshair;}
.wo-canvas.tall{height:165px;} .wo-canvas.short{height:80px;}
.wo-list{display:flex;flex-direction:column;gap:4px;max-height:230px;overflow:auto;}
.wo-list-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.05);font-size:10.5px;cursor:pointer;transition:all .14s;}
.wo-list-item:hover{border-color:var(--wo-accent);background:rgba(169,112,255,.10);}
.wo-list-item .wo-tag{font:9px ui-monospace,monospace;color:var(--wo-accent);border:1px solid rgba(169,112,255,.35);border-radius:4px;padding:1px 5px;flex:0 0 auto;}
.wo-list-item .wo-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wo-list-item .wo-muted{color:var(--wo-sub);font-size:10px;}
.wo-kv{font:10.5px/1.7 ui-monospace,monospace;color:var(--wo-sub);white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;}
.wo-kv b{color:var(--wo-text);font-weight:600;}
.wo-pill{display:inline-block;padding:2px 7px;border-radius:20px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;border:1px solid var(--wo-line);color:var(--wo-sub);}
.wo-pill.ok{color:var(--wo-good);border-color:rgba(126,231,135,.4);background:rgba(126,231,135,.08);}
.wo-pill.warn{color:var(--wo-warn);border-color:rgba(255,204,102,.4);background:rgba(255,204,102,.08);}
.wo-pill.bad{color:var(--wo-bad);border-color:rgba(255,107,129,.4);background:rgba(255,107,129,.08);}
.wo-resize-handle{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 48%,var(--wo-accent) 48%,var(--wo-accent) 56%,transparent 56%,transparent 64%,var(--wo-accent) 64%,var(--wo-accent) 72%,transparent 72%);opacity:.7;z-index:4;}
.wo-launcher{position:fixed!important;right:14px;bottom:14px;z-index:2147483003!important;width:38px;height:38px;border-radius:11px;border:1px solid var(--wo-accent);background:linear-gradient(145deg,rgba(169,112,255,.22),rgba(11,11,17,.92));color:var(--wo-text);font-weight:800;letter-spacing:.06em;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.55),0 0 18px rgba(169,112,255,.2);display:flex;align-items:center;justify-content:center;transition:transform .18s;}
.wo-launcher:hover{transform:scale(1.08) rotate(-4deg);}
.wo-launcher.wo-hidden{display:none!important;}
.wo-modal-wrap{position:fixed!important;inset:0;z-index:2147483004!important;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);}
.wo-modal{width:min(420px,90vw);background:var(--wo-panel);border:1px solid var(--wo-line);border-radius:12px;padding:18px;box-shadow:0 30px 90px rgba(0,0,0,.7);}
.wo-modal h3{margin:0 0 8px;font-size:14px;} .wo-modal p{margin:0 0 16px;color:var(--wo-sub);font-size:11px;line-height:1.6;}
.wo-search-results .wo-list-item{cursor:default;}
.wo-sr-label{flex:1;min-width:0;} .wo-sr-label b{display:block;} .wo-sr-label small{color:var(--wo-sub);}
.wo-capture{padding:5px 9px;font:10px ui-monospace,monospace;border:1px dashed var(--wo-accent);border-radius:6px;background:rgba(169,112,255,.08);color:var(--wo-accent);cursor:pointer;min-width:90px;text-align:center;}
.wo-root.wo-compact .wo-card{padding:9px 10px;margin-bottom:8px;}
.wo-root.wo-compact .wo-content{padding:10px;}
.wo-root.wo-compact .wo-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;}
.wo-hr{height:1px;background:var(--wo-line);margin:10px 0;border:0;}
.wo-note{font-size:10px;color:var(--wo-sub);line-height:1.6;}
.wo-note b{color:var(--wo-text);}
`;
    function injectCSS() {
        try {
            if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); return; }
        } catch (e) { /* fall through */ }
        const style = document.createElement('style');
        style.id = 'wo-style'; style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    function applyTheme(manual) {
        const t = THEMES[cfg.theme] || THEMES.neverlose;
        const root = document.documentElement;
        root.style.setProperty('--wo-bg', t.bg);
        root.style.setProperty('--wo-panel', t.panel);
        root.style.setProperty('--wo-panel2', t.panel2);
        root.style.setProperty('--wo-line', t.line);
        root.style.setProperty('--wo-text', t.text);
        root.style.setProperty('--wo-sub', t.sub);
        root.style.setProperty('--wo-accent', cfg.accent || t.accent);
        root.style.setProperty('--wo-accent2', cfg.accent2 || t.accent2);
        root.style.setProperty('--wo-good', t.good);
        root.style.setProperty('--wo-warn', t.warn);
        root.style.setProperty('--wo-bad', t.bad);
        root.style.setProperty('--wo-opacity', String(clamp(finite(cfg.opacity, 0.96), 0.3, 1)));
        root.style.setProperty('--wo-notif-radius', clamp(finite(cfg.notify.radius, 8), 0, 24) + 'px');
        root.style.setProperty('--wo-notif-blur', clamp(finite(cfg.notify.blur, 16), 0, 40) + 'px');
        root.style.setProperty('--wo-scale', String(clamp(finite(cfg.uiScale, 1), 0.7, 1.5)));
        if (!manual) logEvent('theme', 'Theme: ' + t.name);
    }
    function autoThemeTick() {
        if (!moduleOn('autoTheme') || !cfg.autoTheme.enabled) return;
        const hour = new Date().getHours();
        let target;
        if (cfg.autoTheme.mode === 'time') {
            const day = finite(cfg.autoTheme.dayStart, 7), night = finite(cfg.autoTheme.nightStart, 19);
            target = hour >= day && hour < night ? cfg.autoTheme.dayTheme : cfg.autoTheme.nightTheme;
        } else if (cfg.autoTheme.mode === 'kiai') {
            const cp = R.beatmap ? cpAt(R.beatmap.controlPoints, R.audio.songTime) : null;
            target = cp && cp.kiai ? 'crimson' : cfg.autoTheme.dayTheme;
        } else if (cfg.autoTheme.mode === 'random') {
            target = THEME_KEYS[Math.floor(Math.random() * THEME_KEYS.length)];
        }
        if (target && THEMES[target] && target !== cfg.theme) { cfg.theme = target; applyTheme(); saveConfig(); refreshActiveSection(true); logEvent('theme', 'Auto theme switched to ' + THEMES[target].name); }
    }

    // =======================================================================
    // 12. UI helpers
    // =======================================================================
    function el(tag, attrs, children) {
        const e = document.createElement(tag);
        if (attrs) for (const k of Object.keys(attrs)) {
            const v = attrs[k];
            if (v === undefined || v === null) continue;
            if (k === 'class') e.className = v;
            else if (k === 'text') e.textContent = v;
            else if (k === 'html') e.innerHTML = v;
            else if (k === 'style') e.style.cssText = v;
            else if (k === 'dataset') Object.assign(e.dataset, v);
            else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
            else e.setAttribute(k, String(v));
        }
        const kids = Array.isArray(children) ? children : children === undefined ? [] : [children];
        for (const c of kids) {
            if (c === null || c === undefined || c === false) continue;
            if (Array.isArray(c)) {
                for (const cc of c) if (cc) e.appendChild(typeof cc === 'string' || typeof cc === 'number' ? document.createTextNode(String(cc)) : cc);
            } else e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
        }
        return e;
    }
    const liveBindings = {};      // section -> [{el, get, fmt}]
    const sectionRefresh = {};    // section -> [fn]
    const graphRegistry = [];     // {section, canvas, draw, h}
    let buildingSection = '';
    function addLive(section, node, get, fmt) {
        (liveBindings[section] || (liveBindings[section] = [])).push({ el: node, get, fmt });
        return node;
    }
    function stat(label, get, fmt, cls) {
        const val = el('span', { class: 'wo-live' + (cls ? ' ' + cls : '') });
        addLive(buildingSection, val, get, fmt);
        return el('div', { class: 'wo-stat' }, [el('label', { text: label }), val]);
    }
    function statGrid(items, cls) {
        return el('div', { class: 'wo-grid ' + (cls || 'tight') }, items.map(i => stat(i.label, i.get, i.fmt, i.cls)));
    }
    function card(title, sub, children, opts) {
        const o = opts || {};
        const head = [el('h3', { text: title })];
        if (sub) head.push(el('div', { class: 'wo-card-sub', text: sub }));
        return el('div', { class: 'wo-card' + (o.class ? ' ' + o.class : ''), dataset: o.dataset || {} }, [head, Array.isArray(children) ? children : [children]]);
    }
    function row(label, control, desc) {
        const r = el('div', { class: 'wo-row' }, [
            el('div', { class: 'wo-row-main' }, [el('label', { text: label }), desc ? el('small', { text: desc }) : null]),
            el('div', { class: 'wo-row-ctl' }, Array.isArray(control) ? control : [control])
        ]);
        r.dataset.label = label; r.dataset.section = buildingSection;
        if (R.searchIndex) R.searchIndex.push({ label, desc: desc || '', section: buildingSection, el: r });
        return r;
    }
    function onConfigChange(path, value) {
        setPath(cfg, path, value);
        saveConfig();
        if (path === 'perf.preset' && PERF_PRESETS[value]) { applyPerfPreset(value); return; }
        if (path === 'visuals.minimalHud' && value) { cfg.visuals.fullHud = false; cfg.modules.hudProfiles = false; applyHudStyles(); }
        if (path === 'visuals.fullHud' && value) { cfg.visuals.minimalHud = false; cfg.modules.hudProfiles = true; applyHudStyles(); }
        if (path === 'theme' || path === 'accent' || path === 'accent2' || path === 'opacity' || path === 'uiScale' || path === 'notify.radius' || path === 'notify.blur') applyTheme(true);
        if (path.startsWith('visuals.') || path.startsWith('hud.') || path.startsWith('perf.')) applyUiState();
        if (path === 'autoTheme.enabled') autoThemeTick();
        if (path === 'visuals.enabled' || path === 'visuals.crosshair.enabled' || path.startsWith('perf.')) logEvent('config', path + ' = ' + String(value));
        refreshActiveSection(true);
    }
    function toggle(path, label, desc) {
        const input = el('input', { type: 'checkbox' });
        input.checked = !!getPath(cfg, path);
        input.addEventListener('change', () => onConfigChange(path, input.checked));
        const wrap = el('label', { class: 'wo-switch' }, [input, el('i')]);
        const r = row(label, wrap, desc);
        (R.controlBindings || (R.controlBindings = [])).push({ path, checkbox: input });
        return r;
    }
    function rangeCtl(path, label, desc, min, max, step, unit) {
        const input = el('input', { type: 'range', class: 'wo-range', min, max, step, value: finite(getPath(cfg, path), min) });
        const out = el('span', { class: 'wo-range-out', text: finite(getPath(cfg, path), min) + (unit || '') });
        input.addEventListener('input', () => {
            const v = Number(input.value); out.textContent = v + (unit || '');
            onConfigChange(path, v);
        });
        const r = row(label, [input, out], desc);
        R.controlBindings.push({ input, out, path, unit: unit || '' });
        return r;
    }
    function selectCtl(path, label, desc, options) {
        const sel = el('select', { class: 'wo-select' }, options.map(o => el('option', { value: o.value, text: o.label })));
        sel.value = String(getPath(cfg, path) ?? '');
        sel.addEventListener('change', () => onConfigChange(path, sel.value));
        const r = row(label, sel, desc);
        R.controlBindings.push({ select: sel, path });
        return r;
    }
    function colorCtl(path, label, desc, fallback) {
        const inp = el('input', { type: 'color', class: 'wo-color', value: getPath(cfg, path) || fallback || '#a970ff' });
        inp.addEventListener('input', () => onConfigChange(path, inp.value));
        const r = row(label, inp, desc);
        R.controlBindings.push({ color: inp, path, fallback });
        return r;
    }
    function numberCtl(path, label, desc, min, max, step, unit) {
        const inp = el('input', { type: 'number', class: 'wo-number', min, max, step, value: finite(getPath(cfg, path), min) });
        inp.addEventListener('change', () => onConfigChange(path, clamp(Number(inp.value) || 0, min, max)));
        const r = row(label, [inp, unit ? el('span', { class: 'wo-note', text: unit }) : null], desc);
        R.controlBindings.push({ number: inp, path });
        return r;
    }
    function textCtl(path, label, desc, placeholder) {
        const inp = el('input', { type: 'text', class: 'wo-input', placeholder: placeholder || '', value: String(getPath(cfg, path) ?? '') });
        inp.addEventListener('change', () => onConfigChange(path, inp.value));
        const r = row(label, inp, desc);
        R.controlBindings.push({ text: inp, path });
        return r;
    }
    function btn(label, fn, cls) { return el('button', { class: 'wo-btn ' + (cls || ''), text: label, onclick: fn, type: 'button' }); }
    function btnbar(buttons) { return el('div', { class: 'wo-btnbar' }, buttons); }
    function dyn(container, fn) {
        (sectionRefresh[buildingSection] || (sectionRefresh[buildingSection] = [])).push(() => {
            const html = fn();
            if (container.dataset.last !== html) { container.dataset.last = html; container.innerHTML = html; }
        });
        return container;
    }
    function tableWrap(headers, rowsFn, opts) {
        const o = opts || {};
        const wrap = el('div', { class: 'wo-table-wrap', style: o.maxHeight ? 'max-height:' + o.maxHeight + 'px' : '' });
        dyn(wrap, () => {
            const rows = rowsFn() || [];
            return '<table class="wo-table"><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
                rows.map(r => '<tr' + (r.__sel ? ' class="wo-sel"' : '') + (r.__attrs || '') + '>' +
                    r.cells.map(c => '<td' + (typeof c === 'object' && c.num ? ' class="num"' : '') + '>' + (typeof c === 'object' ? c.v : esc(c)) + '</td>').join('') + '</tr>').join('') +
                '</tbody></table>';
        });
        if (o.onRow) wrap.addEventListener('click', e => {
            const tr = e.target.closest('tr[data-idx],tr[data-key],tr[data-file],tr[data-value]');
            if (!tr) return;
            try { o.onRow(tr.dataset, e); } catch (err) { logError('table row', err); }
        });
        return wrap;
    }
    function graph(draw, height, cls) {
        const c = el('canvas', { class: 'wo-canvas ' + (height === 'tall' ? 'tall' : height === 'short' ? 'short' : '') + ' ' + (cls || '') });
        graphRegistry.push({ section: buildingSection, canvas: c, draw, h: height });
        return c;
    }
    function drawGraphs() {
        const section = cfg.activeSection;
        const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
        for (const g of graphRegistry) {
            if (g.section !== section || !g.canvas.isConnected) continue;
            const w = Math.max(80, g.canvas.clientWidth), h = Math.max(40, g.canvas.clientHeight);
            if (g.canvas.width !== Math.round(w * dpr) || g.canvas.height !== Math.round(h * dpr)) {
                g.canvas.width = Math.round(w * dpr); g.canvas.height = Math.round(h * dpr);
            }
            const ctx = g.canvas.getContext('2d');
            if (!ctx) continue;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
            try { g.draw(ctx, w, h); } catch (e) { logError('graph', e); }
        }
    }
    function numberCell(v) { return { v: esc(v), num: true }; }
    function pill(text, kind) { return '<span class="wo-pill ' + (kind || '') + '">' + esc(text) + '</span>'; }

    function renderNotifications() {
        const host = $('#wo-toasts'); if (!host) return;
        host.className = 'wo-toasts pos-' + (cfg.notify.position || 'top-right');
        host.innerHTML = '';
        const t = THEMES[cfg.theme] || THEMES.neverlose;
        for (const n of R.notifications) {
            const bad = /lost|unavailable|error|performance/i.test(n.type);
            const good = /restored|initialized|detected|loaded|resumed/i.test(n.type);
            const color = cfg.notify.customColor || (bad ? t.bad : good ? t.good : t.accent);
            const node = el('div', { class: 'wo-toast ' + (bad ? 'bad' : good ? 'good' : '') },
                [el('div', { class: 'wo-toast-meta', text: (NOTIFY_TYPES.find(x => x.id === n.type) || { name: n.type }).name }),
                    el('b', { text: n.title }), n.message ? el('span', { text: n.message }) : null]);
            node.style.borderLeftColor = color;
            node.style.setProperty('--wo-accent', color);
            const meta = node.querySelector('.wo-toast-meta'); if (meta) meta.style.color = color;
            node.addEventListener('click', () => { const i = R.notifications.indexOf(n); if (i >= 0) { R.notifications.splice(i, 1); renderNotifications(); } });
            host.appendChild(node);
        }
    }

    function modal(title, message, onConfirm, confirmLabel) {
        const wrap = el('div', { class: 'wo-modal-wrap' });
        const close = () => wrap.remove();
        wrap.appendChild(el('div', { class: 'wo-modal' }, [
            el('h3', { text: title }), el('p', { text: message }),
            el('div', { class: 'wo-btnbar' }, [
                btn(confirmLabel || 'Confirm', () => { close(); try { onConfirm(); } catch (e) { logError('modal action', e); } }, 'primary'),
                btn('Cancel', close)
            ])
        ]));
        document.body.appendChild(wrap);
        wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
        return wrap;
    }

    // =======================================================================
    // 13. Menu shell
    // =======================================================================
    function buildMenu() {
        if (R.ui.menu) return;
        R.searchIndex = []; R.controlBindings = [];
        const root = el('div', { id: 'wo-root', class: 'wo-root' });
        const header = el('div', { class: 'wo-header' });
        const brand = el('div', { class: 'wo-brand', html: 'WOSU<small>ENHANCEMENT SUITE</small>' });
        const search = el('input', { class: 'wo-search', type: 'search', placeholder: 'Search settings, modules, sections…', id: 'wo-search-input' });
        search.addEventListener('input', () => { R.ui.search = search.value.trim(); renderSearchResults(); });
        search.addEventListener('keydown', e => { if (e.key === 'Escape') { search.value = ''; R.ui.search = ''; renderSearchResults(); } });
        const statusDot = el('span', { class: 'wo-dot' });
        const statusText = el('span', { text: 'INITIALIZING' });
        R.ui.statusDot = statusDot; R.ui.statusText = statusText;
        const actions = el('div', { class: 'wo-header-actions' }, [
            btn('▤', () => { cfg.sidebarCollapsed = !cfg.sidebarCollapsed; saveConfig(); applyUiState(); }, 'wo-icon-btn wo-collapse-btn'),
            btn('▣', () => { cfg.compact = !cfg.compact; saveConfig(); applyUiState(); logEvent('ui', 'Compact mode ' + (cfg.compact ? 'on' : 'off')); }, 'wo-icon-btn wo-compact-btn'),
            btn('◌', () => { cfg.hideMenu = true; cfg.menuOpen = false; saveConfig(); applyUiState(); notify('info', 'Menu hidden', 'Press your menu keybind (default Right Shift) to restore.'); }, 'wo-icon-btn'),
            btn('✕', () => setMenuOpen(false), 'wo-icon-btn')
        ]);
        header.appendChild(brand);
        header.appendChild(el('div', { class: 'wo-header-mid' }, [search, el('div', { class: 'wo-header-status' }, [statusDot, statusText])]));
        header.appendChild(actions);
        header.addEventListener('pointerdown', onMenuDragStart);

        const side = el('div', { class: 'wo-sidebar' });
        const items = el('div', { class: 'wo-side-items' });
        for (const s of SECTIONS) {
            const item = el('div', { class: 'wo-side-item', dataset: { section: s.id }, title: s.name },
                [el('span', { class: 'wo-side-icon', text: s.icon }), el('span', { class: 'wo-side-label', text: s.name })]);
            item.addEventListener('click', () => setSection(s.id));
            items.appendChild(item);
        }
        side.appendChild(items);
        side.appendChild(el('div', { class: 'wo-side-foot', html: '<b>WOSU LIVE SUITE</b><br>v' + VERSION + ' · ' + Store.mode + '<br>read-only integration' }));
        const content = el('div', { class: 'wo-content', id: 'wo-content' });
        const searchResults = el('div', { class: 'wo-section wo-search-results', id: 'wo-search-results' });
        content.appendChild(searchResults);
        for (const s of SECTIONS) {
            buildingSection = s.id;
            const sec = el('div', { class: 'wo-section', id: 'wo-sec-' + s.id, dataset: { section: s.id } });
            sec.appendChild(el('div', { class: 'wo-section-head' }, [el('h2', { text: s.name }), el('span', { text: s.icon + ' live data' })]));
            try { sec.appendChild(buildSection(s.id)); } catch (e) { logError('buildSection:' + s.id, e); sec.appendChild(el('div', { class: 'wo-note', text: 'Section error: ' + e.message })); }
            R.ui.sections[s.id] = sec;
            content.appendChild(sec);
        }
        buildingSection = '';
        root.appendChild(header);
        root.appendChild(el('div', { class: 'wo-body' }, [side, content]));
        const handle = el('div', { class: 'wo-resize-handle' });
        handle.addEventListener('pointerdown', onMenuResizeStart);
        root.appendChild(handle);
        document.body.appendChild(root);
        R.ui.menu = root; R.ui.built = true;

        const launcher = el('button', { class: 'wo-launcher', id: 'wo-launcher', text: 'W', title: 'Open WOSU Enhancement Suite (Right Shift)' });
        launcher.addEventListener('click', () => { cfg.hideMenu = false; saveConfig(); setMenuOpen(true); });
        document.body.appendChild(launcher);
        R.ui.launcher = launcher;
        applyUiState();
        setSection(cfg.activeSection || 'dashboard', true);
        renderNotifications();
        logEvent('ui', 'Menu interface built (' + SECTIONS.length + ' sections, ' + MODULES.length + ' modules)');
    }
    function setMenuOpen(open) {
        cfg.menuOpen = !!open; saveConfig(); applyUiState();
        if (open) { setSection(cfg.activeSection || 'dashboard', true); refreshActiveSection(true); }
        logEvent('ui', open ? 'Menu opened' : 'Menu closed');
    }
    function setSection(id, silent) {
        if (!SECTIONS.some(s => s.id === id)) id = 'dashboard';
        cfg.activeSection = id; R.ui.active = id;
        if (!silent) saveConfig();
        for (const s of SECTIONS) {
            const sec = R.ui.sections[s.id]; if (sec) sec.classList.toggle('active', s.id === id && !R.ui.search);
        }
        $$('.wo-side-item', R.ui.menu).forEach(i => i.classList.toggle('active', i.dataset.section === id));
        const sr = $('#wo-search-results'); if (sr) sr.classList.toggle('active', !!R.ui.search);
        if (R.ui.search) renderSearchResults();
        if (!silent) logEvent('ui', 'Section: ' + (SECTIONS.find(s => s.id === id) || {}).name);
        refreshActiveSection(true);
    }
    function renderSearchResults() {
        const sr = $('#wo-search-results'); if (!sr) return;
        const q = (R.ui.search || '').toLowerCase();
        for (const s of SECTIONS) { const sec = R.ui.sections[s.id]; if (sec) sec.classList.toggle('active', s.id === cfg.activeSection && !q); }
        sr.classList.toggle('active', !!q);
        if (!q) { sr.innerHTML = ''; return; }
        const matches = R.searchIndex.filter(x => (x.label + ' ' + x.desc + ' ' + x.section).toLowerCase().includes(q)).slice(0, 80);
        sr.innerHTML = '';
        sr.appendChild(el('div', { class: 'wo-section-head' }, [el('h2', { text: 'Search results' }), el('span', { text: matches.length + ' matching controls' })]));
        sr.appendChild(card('Settings & modules', 'Click “Go” to jump to the control in its section.',
            el('div', { class: 'wo-list' }, matches.length ? matches.map(m => el('div', { class: 'wo-list-item' }, [
                el('span', { class: 'wo-tag', text: (SECTIONS.find(s => s.id === m.section) || { name: m.section }).name }),
                el('div', { class: 'wo-sr-label' }, [el('b', { text: m.label }), el('small', { text: m.desc || '' })]),
                btn('Go', () => {
                    const inp = $('#wo-search-input'); if (inp) inp.value = '';
                    R.ui.search = ''; renderSearchResults(); setSection(m.section);
                    try { m.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); m.el.classList.add('wo-highlight'); setTimeout(() => m.el.classList.remove('wo-highlight'), 2200); } catch { /* ignore */ }
                }, 'small primary')
            ])) : [el('div', { class: 'wo-note', text: 'No controls match “' + esc(q) + '”.' })])));
    }
    function applyUiState() {
        const root = R.ui.menu; if (!root) return;
        const rect = cfg.menuRect || DEFAULTS.menuRect;
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = clamp(finite(rect.w, 1060), 620, Math.max(620, vw - 20));
        const h = clamp(finite(rect.h, 660), 380, Math.max(380, vh - 20));
        let x = finite(rect.x, 0), y = finite(rect.y, 0);
        if (x <= 0 || y <= 0 || !rect.centered) { x = Math.round((vw - w) / 2); y = Math.round((vh - h) / 2); cfg.menuRect.centered = true; cfg.menuRect.x = x; cfg.menuRect.y = y; }
        x = clamp(x, 4, Math.max(4, vw - w - 4)); y = clamp(y, 4, Math.max(4, vh - h - 4));
        root.style.left = x + 'px'; root.style.top = y + 'px';
        root.style.width = w + 'px'; root.style.height = h + 'px';
        root.style.zoom = String(clamp(finite(cfg.uiScale, 1), 0.7, 1.5));
        root.classList.toggle('wo-hidden', !cfg.menuOpen);
        root.classList.toggle('wo-compact', !!cfg.compact && moduleOn('compactMode'));
        root.classList.toggle('wo-collapsed', !!cfg.sidebarCollapsed);
        root.style.opacity = String(clamp(finite(cfg.opacity, 0.96), 0.3, 1));
        const launcher = R.ui.launcher;
        if (launcher) launcher.classList.toggle('wo-hidden', !!cfg.menuOpen || !!cfg.hideMenu);
        const collapse = $('.wo-collapse-btn', root); if (collapse) collapse.classList.toggle('active', !!cfg.sidebarCollapsed);
        const compact = $('.wo-compact-btn', root); if (compact) compact.classList.toggle('active', !!cfg.compact);
        applyHudStyles();
        renderNotifications();
        R.visual.transform = null;
    }
    function onMenuDragStart(e) {
        if (!R.ui.menu || e.target.closest('button,input,select,.wo-search')) return;
        R.ui.drag = { mode: 'move', startX: e.clientX, startY: e.clientY, x: finite(cfg.menuRect.x, 0), y: finite(cfg.menuRect.y, 0) };
    }
    function onMenuResizeStart(e) {
        e.preventDefault(); e.stopPropagation();
        R.ui.drag = { mode: 'resize', startX: e.clientX, startY: e.clientY, w: finite(cfg.menuRect.w, 1060), h: finite(cfg.menuRect.h, 660) };
    }
    function onMenuDragMove(e) {
        const d = R.ui.drag; if (!d) return;
        if (d.mode === 'move') {
            cfg.menuRect.x = clamp(d.x + e.clientX - d.startX, 4, Math.max(4, window.innerWidth - 80));
            cfg.menuRect.y = clamp(d.y + e.clientY - d.startY, 4, Math.max(4, window.innerHeight - 60));
        } else {
            cfg.menuRect.w = clamp(d.w + e.clientX - d.startX, 620, Math.max(620, window.innerWidth - 20));
            cfg.menuRect.h = clamp(d.h + e.clientY - d.startY, 380, Math.max(380, window.innerHeight - 20));
        }
        cfg.menuRect.centered = true;
        applyUiState();
    }
    function onMenuDragEnd() { if (R.ui.drag) { R.ui.drag = null; saveConfig(); } }

    // =======================================================================
    // 14. Extra UI helpers used by sections
    // =======================================================================
    function inputModal(title, message, defaultValue, onConfirm) {
        const wrap = el('div', { class: 'wo-modal-wrap' });
        const inp = el('input', { class: 'wo-input', type: 'text', value: defaultValue || '', style: 'width:100%;max-width:none;margin-bottom:14px;' });
        const close = () => wrap.remove();
        const confirm = () => { const v = inp.value.trim(); close(); if (v) onConfirm(v); };
        wrap.appendChild(el('div', { class: 'wo-modal' }, [
            el('h3', { text: title }), el('p', { text: message }), inp,
            el('div', { class: 'wo-btnbar' }, [btn('Save', confirm, 'primary'), btn('Cancel', close)])
        ]));
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') close(); });
        document.body.appendChild(wrap);
        wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
        setTimeout(() => { try { inp.focus(); inp.select(); } catch { /* ignore */ } }, 30);
    }
    function moduleCard(moduleId, title, sub, contentFn) {
        const m = MODULES.find(x => x.id === moduleId);
        if (!moduleOn(moduleId)) {
            return card(title + ' (disabled)', sub, [
                el('div', { class: 'wo-note', text: 'The “' + (m ? m.name : moduleId) + '” module is disabled. Enable it here or in Module Manager.' }),
                btn('Enable module', () => { cfg.modules[moduleId] = true; saveConfig(); refreshActiveSection(true); rebuildSections(); }, 'primary small')
            ]);
        }
        return card(title, sub, contentFn());
    }
    function gatedCard(moduleId, title, sub, children) {
        if (moduleOn(moduleId)) return card(title, sub, children);
        return moduleCard(moduleId, title, sub, () => children);
    }
    function kv(get) {
        const box = el('div', { class: 'wo-kv' });
        // Beatmap metadata and site settings can contain arbitrary text; never
        // inject them as markup.
        dyn(box, () => esc(get()));
        return box;
    }
    function listBlock(rowsFn, onSelect) {
        const box = el('div', { class: 'wo-list' });
        if (onSelect) box.addEventListener('click', e => {
            const item = e.target.closest('[data-value]'); if (!item) return;
            onSelect(item.dataset.value, e);
        });
        dyn(box, () => (rowsFn() || []).join(''));
        return box;
    }
    function livePill(get) {
        const s = el('span', { class: 'wo-pill' });
        addLive(buildingSection, s, get, null);
        return s;
    }
    function activeConfigName() {
        const c = configs.list.find(x => x.id === configs.activeId);
        return c ? c.name : 'Default';
    }
    function memoryText() {
        const m = performance.memory;
        if (!m) return 'unavailable';
        return fmtBytes(m.usedJSHeapSize) + ' / ' + fmtBytes(m.totalJSHeapSize);
    }
    function diagnostics() {
        const checks = [];
        const add = (name, ok, detail, level) => checks.push({ name, status: ok ? 'ok' : (level || 'warn'), detail });
        add('WOSU canvas (#app canvas)', !!$('#app canvas'), $('#app canvas') ? 'PixiJS renderer present' : 'No canvas yet (game still booting)');
        add('Runtime probe', R.probeInstalled, R.probeMode + ' · ' + Object.keys(R.probe.hooks || {}).length + ' hooks');
        add('TextDecoder hook (.osu)', !!(R.probe.hooks || {}).textDecoder, (R.probe.hooks || {}).textDecoder ? 'Beatmap decoder intercepted · ' + R.probe.osuCount + ' files' : 'Missing: beatmaps cannot be captured');
        add('AudioBufferSource hook', !!(R.probe.hooks || {}).bufferSource, (R.probe.hooks || {}).bufferSource ? 'Playback clock intercepted' : 'Missing: no audio sync');
        add('decodeAudioData hook', !!(R.probe.hooks || {}).decodeAudioData, (R.probe.hooks || {}).decodeAudioData ? 'Waveform + decoder delay available' : 'Missing: no waveform');
        add('Analyser hook', !!(R.probe.hooks || {}).analyser, (R.probe.hooks || {}).analyser ? 'Spectrum/live waveform available' : 'Missing: audio graph changed');
        add('AudioContext', R.audio.ctxState !== 'unknown', R.audio.ctxState + ' · ' + Math.round(R.audio.sampleRate) + ' Hz');
        add('Audio source', !!R.audio.active || R.audio.worklet.active, R.audio.active ? 'buffer source ' + fmtTime(R.audio.active.duration * 1000) : R.audio.worklet.active ? 'time-stretch worklet' : 'idle');
        add('IndexedDB "webosu"', R.lib.dbOk, R.lib.dbOk ? R.lib.sets.length + ' sets readable' : (R.lib.error || 'Not readable (memory fallback or not created)'));
        add('localStorage settings', !!R.site.settings, R.site.settings ? 'webosu.settings.v2 found' : 'Missing: mods/offset unavailable');
        add('Selected difficulty', !!(R.site.key && R.site.file), R.site.lastBeatmap || 'none selected');
        add('Beatmap data', !!R.beatmap, R.beatmap ? R.beatmap.objects.length + ' objects · ' + R.beatmap.data.metadata.version : 'No beatmap parsed');
        add('Frame loop', R.perf.frameRate > 0, Math.round(R.perf.frameRate) + ' fps observed · ' + R.perf.frames + ' callbacks');
        add('Online API capture', R.online.count > 0, R.online.count + ' responses · ' + R.online.results.length + ' rows');
        add('Probe errors', R.probe.errors.length === 0, R.probe.errors.length ? R.probe.errors.length + ' hook errors' : 'none', 'bad');
        R.integration = checks;
        return checks;
    }
    function exportStats(format) {
        const an = analysis();
        const payload = {
            suite: 'WOSU Enhancement Suite', version: VERSION, exportedAt: new Date().toISOString(),
            session: { startedAt: new Date(session.startedAt).toISOString(), durationMs: now() - session.startedAt, plays: session.plays, beatmapsLoaded: session.beatmapsLoaded, notifications: session.notifications, stats: session.stats },
            beatmap: R.beatmap ? { title: R.beatmap.data.metadata.title, artist: R.beatmap.data.metadata.artist, creator: R.beatmap.data.metadata.creator, version: R.beatmap.data.metadata.version, beatmapId: R.beatmap.data.metadata.beatmapId, objects: R.beatmap.objects.length, difficulty: R.beatmap.difficulty, mods: R.site.mods } : null,
            analysis: an ? { total: an.total, circles: an.circles, sliders: an.sliders, spinners: an.spinners, bpmMin: an.bpmMin, bpmMax: an.bpmMax, spacing: an.spacing, sections: an.sections } : null,
            performance: { fps: R.perf.frameRate, frameMs: R.perf.frameTime, fpsHistory: R.perf.fpsHistory, renderHistory: R.perf.renderHistory },
            audio: { rate: R.audio.rate, offsetMs: R.audio.offsetMs, driftMs: R.audio.driftMs, ctxState: R.audio.ctxState },
            favorites: session.favorites, bookmarks: session.bookmarks, history: session.history.slice(0, 30)
        };
        if (format === 'csv') {
            const rows = [['metric', 'value']];
            const flat = (o, p) => { for (const k of Object.keys(o || {})) { const v = o[k]; if (isObj(v) && !Array.isArray(v)) flat(v, p + k + '.'); else if (!Array.isArray(v)) rows.push([p + k, String(v)]); } };
            flat(payload, '');
            const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
            download('wosu-statistics-' + Date.now() + '.csv', csv, 'text/csv');
        } else download('wosu-statistics-' + Date.now() + '.json', JSON.stringify(payload, null, 2));
        logEvent('export', 'Statistics exported as ' + (format || 'json').toUpperCase());
        notify('info', 'Statistics exported', 'Saved to your downloads folder.');
    }
    function exportConfigBackup() {
        const data = { kind: 'wosu-enhance-backup', version: VERSION, exportedAt: new Date().toISOString(), config: cfg, configs, session, colorPresets: session.colorPresets };
        download('wosu-enhancement-backup-' + Date.now() + '.json', JSON.stringify(data, null, 2));
        logEvent('export', 'Full configuration backup exported'); notify('configLoaded', 'Backup exported', 'All settings, configurations and session data saved.');
    }
    function importConfigBackup(data) {
        if (!data || data.kind !== 'wosu-enhance-backup') { notify('info', 'Invalid backup', 'This file is not a WOSU Enhancement Suite backup.'); return false; }
        try {
            if (data.config) cfg = mergeDeep(DEFAULTS, data.config);
            if (data.configs && Array.isArray(data.configs.list)) configs = data.configs;
            if (data.session) session = mergeDeep(session, data.session);
            cfgSaveNow(); saveConfigs(); saveSession(); applyTheme(); applyUiState(); rebuildSections();
            logEvent('import', 'Backup restored'); notify('configLoaded', 'Backup restored', 'Settings, configurations and session data loaded.');
            return true;
        } catch (e) { logError('importConfigBackup', e); return false; }
    }
    function rebuildSections() {
        // Rebuild the whole interface so module-gated cards, live bindings,
        // dynamic views and control bindings all point at connected nodes.
        if (!R.ui.built) return;
        const root = R.ui.menu, launcher = R.ui.launcher;
        if (root && root.parentNode) root.parentNode.removeChild(root);
        if (launcher && launcher.parentNode) launcher.parentNode.removeChild(launcher);
        R.ui.menu = null; R.ui.launcher = null; R.ui.built = false; R.ui.sections = {};
        for (const k of Object.keys(liveBindings)) delete liveBindings[k];
        for (const k of Object.keys(sectionRefresh)) delete sectionRefresh[k];
        graphRegistry.length = 0;
        R.controlBindings = []; R.searchIndex = [];
        buildMenu();
        logEvent('ui', 'Interface rebuilt after module/configuration change');
    }

    // =======================================================================
    // 15. Section builders
    // =======================================================================
    function buildSection(id) {
        buildingSection = id;
        switch (id) {
            // ---------------------------------------------------------------- Dashboard
            case 'dashboard': {
                const items = [
                    { label: 'Current song', get: () => R.beatmap ? R.beatmap.data.metadata.title : '—' },
                    { label: 'Artist', get: () => R.beatmap ? R.beatmap.data.metadata.artist : '—' },
                    { label: 'Mapper', get: () => R.beatmap ? R.beatmap.data.metadata.creator : '—' },
                    { label: 'Difficulty', get: () => R.beatmap ? R.beatmap.data.metadata.version : '—' },
                    { label: 'BPM', get: () => { const cp = R.beatmap && cpAt(R.beatmap.controlPoints, R.audio.songTime); return cp ? fmtNum(60000 / cp.beatLength, 1) : '—'; } },
                    { label: 'Playback time', get: () => fmtTimePrecise(R.audio.songTime) },
                    { label: 'Total duration', get: () => fmtTime(R.audio.duration) },
                    { label: 'Song progress', get: () => R.audio.duration > 0 ? round(clamp(R.audio.songTime / R.audio.duration, 0, 1) * 100, 1) + '%' : '—' },
                    { label: 'Current object', get: () => { const i = R.tracking.currentIndex; return R.beatmap && i >= 0 ? '#' + (i + 1) + ' ' + objectLabel(R.beatmap.objects[i]) : '—'; } },
                    { label: 'Objects remaining', get: () => R.beatmap ? Math.max(0, R.beatmap.objects.length - lowerBound(R.beatmap.objects, Math.max(0, R.audio.songTime))) : '—' },
                    { label: 'Circles', get: () => R.beatmap ? R.beatmap.objects.filter(o => o.kind === 'circle').length : '—' },
                    { label: 'Sliders', get: () => R.beatmap ? R.beatmap.objects.filter(o => o.kind === 'slider').length : '—' },
                    { label: 'Spinners', get: () => R.beatmap ? R.beatmap.objects.filter(o => o.kind === 'spinner').length : '—' },
                    { label: 'Tracking status', get: () => R.tracking.status.toUpperCase(), cls: 'good' },
                    { label: 'Audio sync', get: () => R.audio.syncLost ? 'DRIFT' : R.audio.playing ? 'LOCKED' : 'IDLE' },
                    { label: 'FPS', get: () => Math.round(R.perf.frameRate || R.perf.ownFps) },
                    { label: 'Frame time', get: () => round(R.perf.frameTime, 1) + ' ms' },
                    { label: 'Active configuration', get: () => activeConfigName() },
                    { label: 'Selected mods', get: () => R.site.mods.length ? R.site.mods.join('+') : 'None' },
                    { label: 'Audio rate', get: () => round(R.audio.rate, 2) + 'x' },
                    { label: 'Visible objects', get: () => R.tracking.visible }
                ];
                const progress = el('div', { class: 'wo-bar' });
                const bar = el('i');
                progress.appendChild(bar);
                addLive(id, bar, () => (R.audio.duration > 0 ? clamp(R.audio.songTime / R.audio.duration, 0, 1) * 100 : 0) + '%', null);
                const quick = btnbar([
                    btn('Toggle HUD', () => { cfg.hud.enabled = !cfg.hud.enabled; saveConfig(); applyUiState(); refreshActiveSection(true); }),
                    btn('Toggle visuals', () => onConfigChange('visuals.enabled', !cfg.visuals.enabled)),
                    btn('Add bookmark', addBookmark, 'primary'),
                    btn('Favorite', toggleFavorite),
                    btn('Export stats', () => exportStats('json')),
                    btn('Open analyzer', () => setSection('analyzer')),
                    btn('Diagnostics', () => setSection('debug'))
                ]);
                return el('div', {}, [
                    card('Live overview', 'Every value is read from WOSU runtime data: decoded beatmaps, its AudioContext and its frame loop.', [statGrid(items, 'tight'), progress]),
                    card('Session snapshot', 'Song timeline with live object density and the current playhead.',
                        graph((ctx, w, h) => {
                            const an = analysis();
                            ctx.fillStyle = 'rgba(255,255,255,.03)'; ctx.fillRect(0, 0, w, h);
                            if (!an) { ctx.fillStyle = '#8987a3'; ctx.font = '11px ui-monospace,monospace'; ctx.fillText('No beatmap loaded', 10, 20); return; }
                            const max = Math.max(1, ...an.sections.map(s => s.density));
                            for (let i = 0; i < an.sections.length; i++) {
                                const s = an.sections[i], bh = (s.density / max) * (h - 20);
                                ctx.fillStyle = 'rgba(169,112,255,' + (0.25 + 0.6 * s.density / max) + ')';
                                ctx.fillRect(i * w / an.sections.length, h - bh - 8, Math.max(1, w / an.sections.length - 1), bh);
                            }
                            const px = clamp(R.audio.songTime / Math.max(1, an.songDuration), 0, 1) * w;
                            ctx.fillStyle = '#5ad1ff'; ctx.fillRect(px - 1, 0, 2, h);
                            ctx.font = '10px ui-monospace,monospace'; ctx.fillText(fmtTime(R.audio.songTime), Math.min(w - 46, px + 4), 12);
                        }, 'short')),
                    card('Quick actions', 'Real actions — no placeholders.', quick),
                    card('Next objects', 'Live sequence from the decoded beatmap.',
                        tableWrap(['#', 'Type', 'Time', 'Position', 'Combo', 'Spacing'], () => {
                            if (!R.beatmap) return [];
                            const t = R.audio.songTime, i0 = lowerBound(R.beatmap.objects, t);
                            return R.beatmap.objects.slice(i0, i0 + 8).map(o => {
                                const p = R.beatmap.objects[o.index - 1];
                                return { cells: [numberCell('#' + (o.index + 1)), objectLabel(o), fmtTime(o.time), Math.round(o.x) + ',' + Math.round(o.y), String(o.comboNumber || '—'), p ? round(Math.hypot(o.x - p.x, o.y - p.y), 0) + 'px' : '—'] };
                            });
                        }, { maxHeight: 190 })),
                    card('Integration', 'Runtime hooks currently attached to WOSU.', kv(() => diagnostics().map(c => (c.status === 'ok' ? '✓ ' : c.status === 'bad' ? '✕ ' : '! ') + c.name + ': ' + c.detail).join('\n')))
                ]);
            }
            // ---------------------------------------------------------------- Live Tracking
            case 'tracking': {
                return el('div', {}, [
                    card('Tracking controls', 'All controls change the live overlay immediately.', [
                        toggle('visuals.enabled', 'Tracking overlay', 'Master switch for the visual tracking canvas.'),
                        rangeCtl('visuals.trackingRange', 'Tracking range', 'How far ahead objects are visualized (ms).', 300, 8000, 100, ' ms'),
                        rangeCtl('visuals.upcomingCount', 'Upcoming count', 'Objects listed in the tracking feed.', 1, 30, 1, ''),
                        toggle('visuals.minimalHud', 'Minimal HUD', 'Hide labels, paths, distances and panels.'),
                        toggle('visuals.fullHud', 'Full HUD', 'Show all information modules.'),
                        toggle('visuals.highlightUpcoming', 'Highlight upcoming', 'Emphasize current and next objects.'),
                        toggle('visuals.showTimestamps', 'Object timestamps', 'Print hit-object times near circles.'),
                        toggle('visuals.showVisibility', 'Visibility flags', 'Mark objects inside the preempt window.'),
                        toggle('visuals.ids', 'Sequence numbers', 'Show object IDs and combo numbers.')
                    ]),
                    card('Current / next object', 'Live object at the audio clock, plus the following object.', kv(() => {
                        if (!R.beatmap) return 'No beatmap decoded yet.';
                        const t = R.audio.songTime, cur = activeObjectIndex(t), nxt = lowerBound(R.beatmap.objects, t + 1);
                        const f = i => {
                            if (i < 0 || i >= R.beatmap.objects.length) return '(none)';
                            const o = R.beatmap.objects[i];
                            return '#' + (i + 1) + ' ' + objectLabel(o) + ' @ ' + fmtTime(o.time) + ' → ' + fmtTime(o.endTime) + '\n  pos ' + round(o.x, 1) + ', ' + round(o.y, 1) + ' · combo ' + o.comboNumber + ' · stack ' + o.stackHeight +
                                (o.kind === 'slider' ? '\n  ' + (o.curveType || 'B') + ' curve · ' + o.slides + ' slides · ' + fmtTime(o.duration) + ' · ' + o.ticks + ' ticks' : '') +
                                (o.kind === 'spinner' ? '\n  spin ' + fmtTime(o.duration) + ' · progress ' + round(clamp((t - o.time) / Math.max(1, o.duration), 0, 1) * 100, 0) + '%' : '');
                        };
                        return 'CURRENT  ' + f(cur) + '\n\nNEXT     ' + f(nxt);
                    })),
                    card('Live sequence', 'Objects around the playhead (real parsed data).',
                        tableWrap(['#', 'Kind', 'Time', 'Δ', 'X', 'Y', 'End', 'Visible'], () => {
                            if (!R.beatmap) return [];
                            const t = R.audio.songTime, objs = R.beatmap.objects;
                            const from = Math.max(0, lowerBound(objs, t - 1200)), to = Math.min(objs.length, from + 24);
                            return objs.slice(from, to).map(o => ({
                                cells: [numberCell(o.index + 1), objectLabel(o), fmtTime(o.time), (o.time - t > 0 ? '+' : '') + Math.round(o.time - t) + 'ms', Math.round(o.x), Math.round(o.y), fmtTime(o.endTime), (o.time - t <= R.beatmap.difficulty.preempt && o.endTime >= t) ? 'VIS' : '—']
                            }));
                        }, { maxHeight: 250 })),
                    card('Tracking diagnostics', 'Integration status from the live runtime.', kv(() => [
                        'Status: ' + R.tracking.status.toUpperCase(),
                        'Beatmap source: ' + (R.beatmapSource || 'none'),
                        'Objects decoded: ' + (R.beatmap ? R.beatmap.objects.length : 0),
                        'Visible on screen: ' + R.tracking.visible + ' · drawn: ' + R.tracking.drawn,
                        'Density at playhead: ' + round(R.tracking.density, 2) + ' obj/s',
                        'Mean spacing: ' + round(R.tracking.spacing, 1) + ' osu!px',
                        'Clock: ' + fmtTimePrecise(R.audio.songTime) + ' @ ' + round(R.audio.rate, 2) + 'x',
                        'Frame rate: ' + Math.round(R.perf.frameRate) + ' fps',
                        'Tracking updates: ' + round(R.perf.trackingHz, 1) + ' Hz',
                        'Last update: ' + (R.tracking.lastUpdate ? new Date(R.tracking.lastUpdate).toLocaleTimeString() : '—')
                    ].join('\n'))),
                    card('Beatmap capture', 'WOSU decodes .osu files through TextDecoder; the selected difficulty is also read from its IndexedDB library.', [
                        btnbar([
                            btn('Recapture selected difficulty', () => { if (R.site.key && R.site.file) { void loadSelectedBeatmap(R.site.key, R.site.file); notify('info', 'Recapturing', 'Reading ' + R.site.file + ' from the WOSU library.'); } else notify('trackingUnavailable', 'No selection', 'Choose a difficulty in WOSU first.'); }, 'primary'),
                            btn('Show decoded beatmaps', () => setSection('debug')),
                            btn('Open object inspector', () => setSection('inspector'))
                        ]),
                        kv(() => 'Decoded .osu files this session: ' + R.probe.osuCount + '\nCached beatmaps: ' + R.beatmaps.size + '\nLibrary sets: ' + R.lib.sets.length + '\nSelected: ' + (R.site.lastBeatmap || '—'))
                    ])
                ]);
            }
            // ---------------------------------------------------------------- Visuals
            case 'visuals': {
                return el('div', {}, [
                    card('Visual modules', 'Each toggle enables a real canvas drawing pass.', [
                        toggle('visuals.enabled', 'Enable visuals', 'Master switch.'),
                        toggle('visuals.circles', 'Circle indicators', 'Hit-circle outlines.'),
                        toggle('visuals.approach', 'Approach circles', 'Live preempt rings.'),
                        toggle('visuals.sliderPaths', 'Slider paths', 'Full curve polylines, ticks and ball.'),
                        toggle('visuals.spinner', 'Spinner indicators', 'Progress arc and timing.'),
                        toggle('visuals.labels', 'Object labels', 'Combo numbers and tags.'),
                        toggle('visuals.ids', 'Object IDs', 'Sequence numbers.'),
                        toggle('visuals.trails', 'Object trails', 'Fading links between recent objects.'),
                        toggle('visuals.upcoming', 'Upcoming markers', 'Dots for objects beyond preempt.'),
                        toggle('visuals.distance', 'Distance indicators', 'Spacing lines with pixel distances.'),
                        toggle('visuals.infoPanels', 'Object info panels', 'Current/next detail boxes.'),
                        toggle('visuals.densityOverlay', 'Density strip', 'Heatmap below the playfield.'),
                        toggle('visuals.highlightUpcoming', 'Highlight upcoming', 'Pulse current and next objects.'),
                        toggle('visuals.useComboColors', 'Beatmap combo colors', 'Use the map\'s own combo palette.'),
                        toggle('visuals.minimalHud', 'Minimal HUD', 'Hide secondary information.'),
                        toggle('visuals.fullHud', 'Full HUD', 'Show all information modules.')
                    ]),
                    card('Appearance', 'Colors, transparency, outlines and style.', [
                        selectCtl('visuals.style', 'Visual style', 'Rendering treatment for hit objects.', [{ value: 'neon', label: 'Neon glow' }, { value: 'solid', label: 'Solid fill' }, { value: 'outline', label: 'Clean outline' }, { value: 'retro', label: 'Retro dashed' }]),
                        rangeCtl('visuals.alpha', 'Transparency', 'Global overlay opacity.', 0.1, 1, 0.05, ''),
                        rangeCtl('visuals.outlines', 'Outline width', 'Stroke width in CSS pixels.', 0.5, 6, 0.2, ' px'),
                        rangeCtl('visuals.labelSize', 'Label size', 'Font size for object labels.', 8, 22, 1, ' px'),
                        rangeCtl('visuals.trailWidth', 'Trail width', 'Line width of object trails.', 0.5, 5, 0.2, ' px'),
                        rangeCtl('visuals.objectTrailLength', 'Trail duration', 'How long trails stay visible.', 50, 2000, 25, ' ms'),
                        colorCtl('visuals.colors.circle', 'Circle color', 'Hit circles.', '#ff5fa2'),
                        colorCtl('visuals.colors.slider', 'Slider color', 'Slider paths.', '#6be5ff'),
                        colorCtl('visuals.colors.spinner', 'Spinner color', 'Spinner arcs.', '#ffd166'),
                        colorCtl('visuals.colors.approach', 'Approach color', 'Approach rings.', '#ffffff'),
                        colorCtl('visuals.colors.trail', 'Trail color', 'Object trails.', '#a970ff'),
                        colorCtl('visuals.colors.upcoming', 'Upcoming color', 'Upcoming markers.', '#7ee787')
                    ]),
                    card('Range', 'Tracking horizon and queue length.', [
                        rangeCtl('visuals.trackingRange', 'Tracking range', 'Milliseconds of objects drawn ahead.', 300, 10000, 100, ' ms'),
                        rangeCtl('visuals.upcomingCount', 'Upcoming count', 'Objects in the marker queue.', 0, 30, 1, ''),
                        toggle('visuals.showTimestamps', 'Timestamps', 'Print object times.'),
                        toggle('visuals.showVisibility', 'Visibility', 'Show VIS / queue flags.')
                    ]),
                    card('Custom crosshair', 'Playfield-center or pointer crosshair visualization.', [
                        toggle('visuals.crosshair.enabled', 'Enable crosshair', 'Draw the crosshair overlay.'),
                        toggle('visuals.crosshair.center', 'Lock to playfield center', 'Otherwise follows the pointer.'),
                        toggle('visuals.crosshair.dot', 'Center dot', 'Draw a small center dot.'),
                        rangeCtl('visuals.crosshair.size', 'Arm length', 'Crosshair arm length.', 4, 90, 1, ' px'),
                        rangeCtl('visuals.crosshair.gap', 'Center gap', 'Gap around the center.', 0, 40, 1, ' px'),
                        rangeCtl('visuals.crosshair.thickness', 'Thickness', 'Line width.', 1, 10, 0.5, ' px'),
                        colorCtl('visuals.crosshair.color', 'Crosshair color', 'Stroke color.', '#ffffff')
                    ]),
                    moduleCard('colorPresets', 'Color presets', 'Save, switch and delete visual color schemes.', () => [
                        btnbar([
                            btn('Save current colors', () => inputModal('Save color preset', 'Name for this color scheme:', 'Preset ' + (session.colorPresets.length + 1), name => {
                                session.colorPresets.unshift({ id: uid(), name, at: now(), colors: clone(cfg.visuals.colors) });
                                saveSession(); refreshActiveSection(true); notify('info', 'Preset saved', name);
                            }), 'primary small'),
                            btn('Reset to default', () => { cfg.visuals.colors = clone(DEFAULTS.visuals.colors); saveConfig(); refreshActiveSection(true); }, 'small')
                        ]),
                        listBlock(() => (session.colorPresets || []).map(p => '<div class="wo-list-item" data-value="' + esc(p.id) + '"><span class="wo-tag">COLOR</span><div class="wo-grow">' + esc(p.name) + '</div><span class="wo-muted">' + new Date(p.at).toLocaleTimeString() + '</span><button class="wo-btn small danger" data-act="del">✕</button></div>'), (v, e) => {
                            const p = session.colorPresets.find(x => x.id === v); if (!p) return;
                            if (e.target.dataset.act === 'del') { session.colorPresets = session.colorPresets.filter(x => x.id !== v); saveSession(); refreshActiveSection(true); return; }
                            cfg.visuals.colors = clone(p.colors); saveConfig(); refreshActiveSection(true); notify('configLoaded', 'Color preset applied', p.name);
                        })
                    ]),
                    card('Performance presets', 'Quickly switch low-overhead / balanced / detailed rendering.',
                        btnbar(Object.keys(PERF_PRESETS).map(k => btn(PERF_PRESETS[k].name, () => applyPerfPreset(k), k === cfg.perf.preset ? 'primary' : ''))))
                ]);
            }
            // ---------------------------------------------------------------- HUD Editor
            case 'hud': {
                const editorBox = el('div', { id: 'wo-hud-editor-controls' });
                buildHudEditorControls(editorBox);
                return el('div', {}, [
                    card('HUD editor', 'Drag and resize elements directly on the game view while edit mode is on.', [
                        toggle('hud.enabled', 'Show HUD', 'Master HUD visibility.'),
                        toggle('hud.editMode', 'Edit mode', 'Enable dragging and resizing on the overlay.'),
                        toggle('hud.preview', 'Preview changes', 'Show edit handles without saving drag changes.'),
                        btnbar([
                            btn('Reset positions', resetHudPositions, 'danger small'),
                            btn('Apply compact layout', () => applyHudPreset('compact'), 'small'),
                            btn('Apply expanded layout', () => applyHudPreset('expanded'), 'small')
                        ]),
                        el('div', { class: 'wo-note', text: 'Tip: drag a widget to move it; drag its bottom-right corner to resize. Positions are stored in viewport percentages.' })
                    ]),
                    card('HUD elements', 'Select an element to edit its properties.',
                        listBlock(() => HUD_DEFS.map(d => {
                            const s = hudStyle(d.id);
                            return '<div class="wo-list-item" data-value="' + d.id + '"><span class="wo-tag">' + (s.visible ? 'ON' : 'OFF') + '</span><div class="wo-grow">' + esc(d.name) + '</div><span class="wo-muted">' + Math.round(finite(s.x, 0)) + '%, ' + Math.round(finite(s.y, 0)) + '% · ' + Math.round(finite(s.w, 0)) + '×' + Math.round(finite(s.h, 0)) + '</span></div>';
                        }), v => { cfg.hud.selected = v; saveConfig(); buildHudEditorControls(editorBox); applyHudStyles(); refreshActiveSection(true); })),
                    card('Selected element', 'Live property editor — changes apply immediately.', editorBox),
                    moduleCard('hudProfiles', 'HUD profiles', 'Multiple independently saved HUD arrangements.', () => [
                        btnbar([
                            btn('Save profile', () => inputModal('Save HUD profile', 'Name for this HUD arrangement:', 'Layout ' + (Object.keys(cfg.hud.profiles).length + 1), name => {
                                cfg.hud.profiles[name] = clone(cfg.hud.elements); cfg.hud.activeProfile = name;
                                saveConfig(); refreshActiveSection(true); notify('configLoaded', 'HUD profile saved', name);
                            }), 'primary small'),
                            btn('Export layouts', () => download('wosu-hud-profiles-' + Date.now() + '.json', JSON.stringify(cfg.hud.profiles, null, 2)), 'small'),
                            btn('Import layouts', async () => { const f = await pickFile(); if (!f) return; const j = safeParse(f.text, null); if (isObj(j)) { Object.assign(cfg.hud.profiles, j); saveConfig(); refreshActiveSection(true); notify('configLoaded', 'HUD layouts imported', String(Object.keys(j).length) + ' profiles.'); } }, 'small')
                        ]),
                        listBlock(() => Object.keys(cfg.hud.profiles).map(name => '<div class="wo-list-item" data-value="' + esc(name) + '"><span class="wo-tag">HUD</span><div class="wo-grow">' + esc(name) + (name === cfg.hud.activeProfile ? ' (active)' : '') + '</div><button class="wo-btn small danger" data-act="del">✕</button></div>'), (name, e) => {
                            if (e.target.dataset.act === 'del') { delete cfg.hud.profiles[name]; saveConfig(); refreshActiveSection(true); return; }
                            if (cfg.hud.profiles[name]) { cfg.hud.elements = clone(cfg.hud.profiles[name]); cfg.hud.activeProfile = name; saveConfig(); applyHudStyles(); refreshActiveSection(true); notify('configLoaded', 'HUD profile loaded', name); }
                        })
                    ])
                ]);
            }
            // ---------------------------------------------------------------- Beatmap Analyzer
            case 'analyzer': {
                return el('div', {}, [
                    card('Analyzer controls', 'Analysis is computed from the decoded .osu hit objects.', [
                        rangeCtl('analyzer.sectionSec', 'Section length', 'Seconds per analysis section.', 2, 60, 1, ' s'),
                        rangeCtl('analyzer.topSections', 'High-density sections', 'How many top sections to list.', 1, 20, 1, ''),
                        btnbar([
                            btn('Reset target to live beatmap', () => { R.analysisBeatmap = R.beatmap; R.analysisKey = R.beatmapKey; refreshActiveSection(true); }, 'small'),
                            btn('Export analysis JSON', () => download('wosu-beatmap-analysis-' + Date.now() + '.json', JSON.stringify({ metadata: R.beatmap && R.beatmap.data.metadata, analysis: analysis() }, null, 2)), 'small')
                        ])
                    ]),
                    card('Beatmap summary', 'Object counts, timing and difficulty attributes.', statGrid([
                        { label: 'Total objects', get: () => analysis() ? analysis().total : '—' },
                        { label: 'Circles', get: () => analysis() ? analysis().circles : '—' },
                        { label: 'Sliders', get: () => analysis() ? analysis().sliders : '—' },
                        { label: 'Spinners', get: () => analysis() ? analysis().spinners : '—' },
                        { label: 'Song duration', get: () => fmtTime(analysis() ? analysis().songDuration : 0) },
                        { label: 'Playable range', get: () => analysis() ? fmtTime(analysis().startTime) + '–' + fmtTime(analysis().endTime) : '—' },
                        { label: 'BPM min', get: () => analysis() ? fmtNum(analysis().bpmMin, 1) : '—' },
                        { label: 'BPM max', get: () => analysis() ? fmtNum(analysis().bpmMax, 1) : '—' },
                        { label: 'Average BPM', get: () => analysis() ? fmtNum(analysis().bpmAvg, 1) : '—' },
                        { label: 'Star rating', get: () => analysis() && analysis().stars != null ? fmtNum(analysis().stars, 2) + '★' : 'unknown' },
                        { label: 'CS / AR', get: () => analysis() ? round(analysis().difficulty.cs, 1) + ' / ' + round(analysis().difficulty.ar, 1) : '—' },
                        { label: 'OD / HP', get: () => analysis() ? round(analysis().difficulty.od, 1) + ' / ' + round(analysis().difficulty.hp, 1) : '—' },
                        { label: 'Circle radius', get: () => analysis() ? round(analysis().difficulty.circleRadius, 1) + ' px' : '—' },
                        { label: 'Preempt', get: () => analysis() ? Math.round(analysis().difficulty.preempt) + ' ms' : '—' },
                        { label: 'Max combo', get: () => analysis() ? analysis().maxCombo : '—' },
                        { label: 'Breaks', get: () => analysis() ? analysis().breaks.length : '—' },
                        { label: 'Slider ticks', get: () => analysis() ? analysis().sliderStats.totalTicks : '—' },
                        { label: 'Spinner time', get: () => analysis() ? fmtTime(analysis().spinnerStats.totalDuration) : '—' }
                    ], 'tight')),
                    card('Beatmap metadata', 'From the .osu file loaded by WOSU.', kv(() => {
                        const an = analysis(); if (!an) return 'No beatmap loaded.';
                        const m = an.metadata, g = an.general;
                        return ['Title: ' + m.title, 'Title (unicode): ' + m.titleUnicode, 'Artist: ' + m.artist, 'Artist (unicode): ' + m.artistUnicode,
                            'Creator / mapper: ' + m.creator, 'Difficulty: ' + m.version, 'Source: ' + m.source, 'BeatmapID: ' + m.beatmapId, 'BeatmapSetID: ' + m.beatmapSetId,
                            'Audio: ' + g.audioFilename, 'Preview: ' + fmtTime(g.previewTime), 'Mode: ' + g.mode, 'Stack leniency: ' + g.stackLeniency,
                            'Format: v' + (R.beatmap ? R.beatmap.data.formatVersion : '—'), 'Tags: ' + m.tags].join('\n');
                    })),
                    card('Object density graph', 'Objects per second, section by section; the cyan line is the playhead.',
                        graph((ctx, w, h) => {
                            const an = analysis();
                            if (!an) { ctx.fillStyle = '#8987a3'; ctx.font = '11px ui-monospace,monospace'; ctx.fillText('No beatmap', 10, 20); return; }
                            const max = Math.max(1, ...an.sections.map(s => s.density));
                            for (let i = 0; i < an.sections.length; i++) {
                                const s = an.sections[i], bh = s.density / max * (h - 22);
                                const grad = ctx.createLinearGradient(0, h - bh, 0, h);
                                grad.addColorStop(0, 'rgba(90,209,255,.85)'); grad.addColorStop(1, 'rgba(169,112,255,.30)');
                                ctx.fillStyle = grad; ctx.fillRect(i * w / an.sections.length + 1, h - bh - 6, Math.max(1, w / an.sections.length - 2), bh);
                            }
                            ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '9px ui-monospace,monospace';
                            ctx.fillText('0', 3, h - 8); ctx.fillText(fmtTime(an.songDuration), w - 48, h - 8);
                            const px = clamp(R.audio.songTime / Math.max(1, an.songDuration), 0, 1) * w;
                            ctx.strokeStyle = '#5ad1ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
                        }, 'tall')),
                    card('Difficulty progression', 'Density × spacing strain across the song.',
                        graph((ctx, w, h) => {
                            const an = analysis(); if (!an) return;
                            const max = Math.max(1, ...an.sections.map(s => s.progression));
                            ctx.beginPath(); ctx.moveTo(0, h - 8);
                            an.sections.forEach((s, i) => ctx.lineTo(i / Math.max(1, an.sections.length - 1) * w, h - 8 - (s.progression / max) * (h - 22)));
                            ctx.strokeStyle = '#c07bff'; ctx.lineWidth = 2; ctx.stroke();
                            ctx.lineTo(w, h - 8); ctx.lineTo(0, h - 8); ctx.fillStyle = 'rgba(192,123,255,.16)'; ctx.fill();
                        }, 'short')),
                    card('BPM distribution', 'Uninherited timing points and how long each tempo lasts.',
                        tableWrap(['Time', 'End', 'BPM', 'Duration', 'Share'], () => {
                            const an = analysis(); if (!an) return [];
                            const total = Math.max(1, an.bpmDistribution.reduce((a, b) => a + b.ms, 0));
                            return an.bpmDistribution.slice(0, 80).map(b => ({ cells: [fmtTime(b.time), fmtTime(b.end), numberCell(fmtNum(b.bpm, 2)), fmtTime(b.ms), round(b.ms / total * 100, 1) + '%'] }));
                        }, { maxHeight: 190 })),
                    card('Timing-point overview', 'All [TimingPoints] rows from the beatmap.',
                        tableWrap(['#', 'Time', 'Beat length', 'BPM', 'SV', 'Meter', 'Kiai', 'Type', 'Vol'], () => {
                            const an = analysis(); if (!an) return [];
                            return an.timingPoints.slice(0, 300).map(t => ({ cells: [numberCell(t.index), fmtTime(t.time), numberCell(round(t.beatLength, 2)), t.bpm ? numberCell(fmtNum(t.bpm, 1)) : '—', numberCell(round(t.sv, 2)), String(t.meter), t.kiai ? 'KIAI' : '—', t.uninherited ? 'red' : 'green', String(t.volume)] }));
                        }, { maxHeight: 230 })),
                    card('Section-by-section analysis', 'Click a section to bookmark it.', (() => {
                        const wrap = el('div');
                        const table = tableWrap(['Section', 'Start', 'Objects', 'Density', 'Spacing', 'Progression', 'C/S/P'], () => {
                            const an = analysis(); if (!an) return [];
                            return an.sections.map(s => ({ cells: [numberCell(s.index + 1), fmtTime(s.start), String(s.count), round(s.density, 2) + '/s', round(s.spacing, 0) + 'px', round(s.progression, 2), s.circles + '/' + s.sliders + '/' + s.spinners], __attrs: ' data-idx="' + s.index + '"' }));
                        }, { maxHeight: 230, onRow: d => { const idx = Number(d.idx); const an = analysis(); if (an && an.sections[idx]) addBookmarkAt(an.sections[idx].start, 'Section ' + (idx + 1)); } });
                        wrap.appendChild(table); return wrap;
                    })()),
                    card('High-density sections', 'Busiest parts of the map.', listBlock(() => {
                        const an = analysis(); if (!an) return ['<div class="wo-note">No beatmap loaded.</div>'];
                        return an.highDensity.map(s => '<div class="wo-list-item" data-value="' + s.start + '"><span class="wo-tag">TOP</span><div class="wo-grow">' + fmtTime(s.start) + '–' + fmtTime(s.end) + ' · ' + round(s.density, 2) + ' obj/s · ' + s.count + ' objects</div></div>');
                    }, v => addBookmarkAt(Number(v), 'Dense section'))),
                    card('Object spacing analysis', 'Distances between consecutive hit objects (osu! px).', kv(() => {
                        const an = analysis(); if (!an) return 'No beatmap loaded.';
                        const s = an.spacing;
                        return ['Samples: ' + s.samples, 'Minimum: ' + round(s.min, 1), 'Average: ' + round(s.avg, 1), 'Median (p50): ' + round(s.p50, 1), 'p90: ' + round(s.p90, 1), 'Maximum: ' + round(s.max, 1), 'Slider total duration: ' + fmtTime(an.sliderStats.totalDuration), 'Average slider: ' + fmtTime(an.sliderStats.avgDuration), 'Longest slider: ' + fmtTime(an.sliderStats.maxDuration), 'Slider curves: ' + JSON.stringify(an.sliderStats.curves)].join('\n');
                    })),
                    card('Timing pattern visualization', 'Intervals between the first 400 objects.',
                        graph((ctx, w, h) => {
                            const an = analysis(); if (!an || !an.intervals.length) return;
                            const max = Math.max(1, ...an.intervals);
                            for (let i = 0; i < an.intervals.length; i++) {
                                const bh = an.intervals[i] / max * (h - 16);
                                ctx.fillStyle = 'rgba(126,231,135,.65)'; ctx.fillRect(i * w / an.intervals.length, h - bh - 6, Math.max(1, w / an.intervals.length - 0.5), bh);
                            }
                        }, 'short')),
                    moduleCard('densityHeatmap', 'Object density heatmap', 'Dense sections colored across the whole song.', () => [
                        graph((ctx, w, h) => {
                            const an = analysis(); if (!an) return;
                            const max = Math.max(1, ...an.sections.map(s => s.density));
                            for (let i = 0; i < an.sections.length; i++) {
                                const f = an.sections[i].density / max;
                                ctx.fillStyle = 'rgb(' + Math.round(40 + 215 * f) + ',' + Math.round(230 - 130 * f) + ',' + Math.round(255 - 160 * f) + ')';
                                ctx.fillRect(i * w / an.sections.length, 0, Math.max(1, w / an.sections.length + 0.5), h);
                            }
                            const px = clamp(R.audio.songTime / Math.max(1, an.songDuration), 0, 1) * w;
                            ctx.fillStyle = '#fff'; ctx.fillRect(px - 1, 0, 2, h);
                        }, 'short'),
                        btn('Add heatmap bookmark', () => addBookmark(), 'small')
                    ]),
                    moduleCard('difficultyComparison', 'Difficulty comparison', 'Difficulties of the current set from WOSU\'s IndexedDB library.', () => [
                        difficultyTable(),
                        kv(() => 'Current set: ' + (R.site.key || '—') + '\nDifficulties: ' + ((R.lib.sets.find(s => s.key === R.site.key) || { difficulties: [] }).difficulties || []).length)
                    ])
                ]);
            }
            default: return buildSection2(id);
        }
    }

    // =======================================================================
    // 16. Shared feature helpers
    // =======================================================================
    function addBookmarkAt(time, label) {
        const t = Math.max(0, Math.round(finite(time, 0)));
        session.bookmarks.unshift({ id: uid(), time: t, label: label || 'Bookmark', at: now(), beatmap: R.beatmap ? R.beatmap.data.metadata.title + ' [' + R.beatmap.data.metadata.version + ']' : '—', key: R.beatmapKey });
        if (session.bookmarks.length > 200) session.bookmarks.pop();
        saveSession(); notify('info', 'Bookmark added', label + ' @ ' + fmtTime(t));
        logEvent('bookmark', 'Bookmark "' + label + '" at ' + fmtTime(t));
        refreshActiveSection(true);
    }
    function addBookmark() {
        if (!R.beatmap) { notify('trackingUnavailable', 'No beatmap', 'Load a beatmap before adding bookmarks.'); return; }
        inputModal('Add section bookmark', 'Label for the bookmark at ' + fmtTimePrecise(R.audio.songTime) + ':', 'Section @ ' + fmtTime(R.audio.songTime), label => addBookmarkAt(R.audio.songTime, label));
    }
    function favoriteKey() {
        if (R.site.key && R.site.file) return R.site.key + '|' + R.site.file;
        return R.beatmap ? R.beatmap.data.metadata.title + '|' + R.beatmap.data.metadata.version : '';
    }
    function isFavorite() { return session.favorites.some(f => f.id === favoriteKey()); }
    function toggleFavorite() {
        const k = favoriteKey();
        if (!k) { notify('trackingUnavailable', 'No beatmap', 'Load a beatmap first.'); return; }
        const i = session.favorites.findIndex(f => f.id === k);
        if (i >= 0) { session.favorites.splice(i, 1); notify('info', 'Favorite removed', k); }
        else {
            const m = R.beatmap ? R.beatmap.data.metadata : {};
            session.favorites.unshift({ id: k, at: now(), title: m.title || R.site.key, artist: m.artist || '', creator: m.creator || '', version: m.version || R.site.file, key: R.site.key, file: R.site.file, objects: R.beatmap ? R.beatmap.objects.length : 0 });
            notify('info', 'Beatmap favorited', (m.title || k) + ' saved.');
        }
        saveSession(); logEvent('favorite', 'Favorites updated: ' + session.favorites.length + ' entries'); refreshActiveSection(true);
    }
    function applyPerfPreset(key) {
        const p = PERF_PRESETS[key]; if (!p) return;
        const patch = clone(p.patch);
        for (const section of Object.keys(patch)) cfg[section] = mergeDeep(cfg[section], patch[section]);
        cfg.perf.preset = key; saveConfig(); applyUiState();
        notify('configLoaded', 'Performance preset applied', p.name);
        logEvent('perf', 'Performance preset: ' + p.name);
        refreshActiveSection(true);
    }
    function resetHudPositions() {
        cfg.hud.elements = clone(DEFAULTS.hud.elements); cfg.hud.activeProfile = 'default';
        saveConfig(); applyHudStyles(); notify('configLoaded', 'HUD reset', 'All elements restored to default positions.');
        logEvent('hud', 'HUD layout reset'); refreshActiveSection(true);
    }
    function applyHudPreset(mode) {
        for (const d of HUD_DEFS) {
            const s = cfg.hud.elements[d.id] || (cfg.hud.elements[d.id] = clone(d));
            if (mode === 'compact') {
                s.visible = ['song', 'clock', 'fps', 'progress'].includes(d.id);
                s.w = Math.min(finite(s.w, 200), 220); s.opacity = 0.78; s.font = 11;
            } else {
                s.visible = true; s.w = d.w; s.h = d.h; s.opacity = d.opacity; s.font = d.font;
            }
        }
        saveConfig(); applyHudStyles(); notify('configLoaded', 'HUD layout applied', mode === 'compact' ? 'Compact' : 'Expanded');
        refreshActiveSection(true);
    }
    function buildHudEditorControls(box) {
        if (!box) return;
        const prev = buildingSection; buildingSection = 'hud';
        const id = cfg.hud.selected || 'song';
        const s = hudStyle(id);
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'wo-note', text: 'Editing: ' + (s.name || id) + '  ·  ' + id }));
        box.appendChild(toggle('hud.elements.' + id + '.visible', 'Visible', 'Show this HUD element.'));
        box.appendChild(colorCtl('hud.elements.' + id + '.color', 'Text color', 'Element foreground color.', '#e9d5ff'));
        box.appendChild(rangeCtl('hud.elements.' + id + '.opacity', 'Transparency', 'Widget opacity.', 0.15, 1, 0.05, ''));
        box.appendChild(rangeCtl('hud.elements.' + id + '.font', 'Text size', 'Base font size in px.', 8, 26, 1, ' px'));
        box.appendChild(numberCtl('hud.elements.' + id + '.x', 'X position', 'Left position in viewport %.', 0, 95, 0.5, '%'));
        box.appendChild(numberCtl('hud.elements.' + id + '.y', 'Y position', 'Top position in viewport %.', 0, 95, 0.5, '%'));
        box.appendChild(numberCtl('hud.elements.' + id + '.w', 'Width', 'Widget width in px.', 90, 800, 5, 'px'));
        box.appendChild(numberCtl('hud.elements.' + id + '.h', 'Height', 'Widget height in px.', 32, 500, 5, 'px'));
        box.appendChild(btnbar([
            btn('Center element', () => { const p = 'hud.elements.' + id; setPath(cfg, p + '.x', 40); setPath(cfg, p + '.y', 45); saveConfig(); applyHudStyles(); refreshActiveSection(true); }, 'small'),
            btn('Reset this element', () => { cfg.hud.elements[id] = clone(DEFAULTS.hud.elements[id]); saveConfig(); applyHudStyles(); buildHudEditorControls(box); refreshActiveSection(true); }, 'small')
        ]));
        buildingSection = prev;
    }
    function difficultyTable(opts) {
        const o = opts || {};
        return tableWrap(['Difficulty', 'Stars', 'CS', 'AR', 'OD', 'HP', 'BPM', 'Length', 'Objects', 'Max combo', ''], () => {
            const set = R.lib.sets.find(s => s.key === R.site.key);
            const diffs = set ? (set.difficulties || []) : [];
            return diffs.map(d => ({
                cells: [esc(d.version || d.file), d.stars != null ? numberCell(fmtNum(d.stars, 2)) : '—', numberCell(round(d.cs, 1)), numberCell(round(d.ar, 1)), numberCell(round(d.od, 1)), numberCell(round(d.hp, 1)), numberCell(Math.round(d.bpm)), fmtTime(d.length), numberCell((finite(d.circles, 0) + finite(d.sliders, 0) + finite(d.spinners, 0)) || '—'), numberCell(d.maxCombo || '—'), '<button class="wo-btn small" data-act="analyze">Analyze</button>'],
                __attrs: ' data-key="' + esc(set ? set.key : '') + '" data-file="' + esc(d.file || '') + '"',
                __sel: d.file === R.site.file
            }));
        }, {
            maxHeight: o.maxHeight || 220,
            onRow: d => {
                if (d.key && d.file) { void loadDifficultyForAnalysis(d.key, d.file); logEvent('analysis', 'Loading difficulty ' + d.file + ' for comparison'); }
            }
        });
    }
    function selectedObject() {
        if (!R.beatmap) return null;
        const i = R.tracking.selectedIndex;
        return i >= 0 && i < R.beatmap.objects.length ? R.beatmap.objects[i] : null;
    }
    function objectKV(o) {
        if (!o) return 'No object selected. Click an object in the list or on the timeline.';
        const rows = [
            'Index / ID: #' + (o.index + 1), 'Kind: ' + objectLabel(o), 'Time: ' + fmtTimePrecise(o.time) + ' (' + Math.round(o.time) + ' ms)',
            'End time: ' + fmtTimePrecise(o.endTime), 'Duration: ' + fmtTime(o.endTime - o.time),
            'Position: ' + round(o.x, 2) + ', ' + round(o.y, 2) + ' osu!px', 'Raw position: ' + o.rawX + ', ' + o.rawY,
            'Stack height: ' + o.stackHeight, 'Combo: ' + (o.comboNumber || '—') + ' · color #' + o.comboColorIndex + ' · newCombo ' + o.newCombo + ' · lastInCombo ' + o.lastInCombo,
            'Hit sound: ' + o.hitSound + ' · sample set ' + o.hitSample.normalSet + '/' + o.hitSample.additionSet + ' · vol ' + o.hitSample.volume,
            'Control point: ' + fmtNum(60000 / o.control.beatLength, 2) + ' BPM · ' + o.control.meter + '/4 · SV ' + round(o.control.sliderVelocity, 2) + ' · kiai ' + o.control.kiai,
            'Visible window: ' + fmtTime(o.time - R.beatmap.difficulty.preempt) + ' → ' + fmtTime(o.endTime)
        ];
        if (o.kind === 'slider') rows.push(
            'Curve: ' + (o.curveType || 'B') + ' · control points ' + (o.rawControlPoints || []).length,
            'Pixel length: ' + round(o.pixelLength, 1) + ' px · path ' + round(o.path.length, 1) + ' px',
            'Slides: ' + o.slides + ' · span ' + fmtTime(o.spanDuration) + ' · total ' + fmtTime(o.duration),
            'Velocity: ' + round(o.velocity, 4) + ' px/ms · tick distance ' + round(o.tickDistance, 1),
            'Nested events: ' + (o.events || []).length + ' (ticks ' + (o.ticks || 0) + ', repeats ' + Math.max(0, o.slides - 1) + ')',
            'Tail: ' + round(o.endX, 1) + ', ' + round(o.endY, 1)
        );
        if (o.kind === 'spinner') rows.push('Spin duration: ' + fmtTime(o.duration), 'Live progress: ' + round(clamp((R.audio.songTime - o.time) / Math.max(1, o.duration), 0, 1) * 100, 1) + '%');
        return rows.join('\n');
    }
    function beatmapSearchPanel() {
        const input = el('input', { class: 'wo-input', type: 'search', placeholder: 'Search title, artist, mapper…', style: 'width:100%;max-width:none;margin-bottom:8px;' });
        input.addEventListener('input', () => { R.ui.searchTerm = input.value.trim(); refreshActiveSection(true); });
        const tab = el('select', { class: 'wo-select', style: 'margin-bottom:8px;' }, [el('option', { value: 'local', text: 'Local library (IndexedDB)' }), el('option', { value: 'online', text: 'Live listing data (captured)' })]);
        tab.value = R.ui.searchTab || 'local';
        tab.addEventListener('change', () => { R.ui.searchTab = tab.value; refreshActiveSection(true); });
        const results = el('div', { class: 'wo-list' });
        results.addEventListener('click', e => {
            const item = e.target.closest('[data-value]'); if (!item) return;
            const act = e.target.dataset.act;
            const parts = item.dataset.value.split('||');
            if (act === 'analyze' && parts.length >= 2) { void loadDifficultyForAnalysis(parts[0], parts[1]); }
            else if (act === 'fav') {
                const key = parts[0] + '|' + parts[1];
                if (!session.favorites.some(f => f.id === key)) {
                    session.favorites.unshift({ id: key, at: now(), title: parts[2] || key, artist: '', creator: '', version: parts[1], key: parts[0], file: parts[1], objects: 0 });
                    saveSession(); notify('info', 'Favorited', parts[2] || key); refreshActiveSection(true);
                }
            } else if (act === 'select') { R.tracking.inspectedTime = 0; setSection('history'); }
        });
        dyn(results, () => {
            const q = (R.ui.searchTerm || '').toLowerCase(), mode = R.ui.searchTab || 'local';
            let html = '';
            if (mode === 'local') {
                const rows = [];
                for (const s of R.lib.sets) {
                    for (const d of (s.difficulties || [])) {
                        const hay = (s.title + ' ' + s.artist + ' ' + s.creator + ' ' + d.version).toLowerCase();
                        if (q && hay.indexOf(q) === -1) continue;
                        rows.push('<div class="wo-list-item" data-value="' + esc(s.key) + '||' + esc(d.file) + '||' + esc(s.title) + '"><span class="wo-tag">LIB</span><div class="wo-grow">' + esc(s.title) + ' <span class="wo-muted">[' + esc(d.version) + ']</span> · ' + esc(s.artist) + '</div><span class="wo-muted">' + (d.stars != null ? fmtNum(d.stars, 2) + '★' : '') + '</span><button class="wo-btn small" data-act="analyze">Analyze</button><button class="wo-btn small" data-act="fav">★</button></div>');
                    }
                }
                html = rows.slice(0, 60).join('') || '<div class="wo-note">No local beatmaps match. WOSU populates its IndexedDB library on import/download.</div>';
            } else {
                const rows = R.online.results.filter(r => !q || (r.title + ' ' + r.artist + ' ' + r.creator).toLowerCase().includes(q));
                html = rows.slice(0, 60).map(r => '<div class="wo-list-item" data-value="' + esc(String(r.sid)) + '||' + esc(r.title) + '||' + esc(r.title) + '"><span class="wo-tag">' + esc(r.source) + '</span><div class="wo-grow">' + esc(r.title) + ' <span class="wo-muted">· ' + esc(r.artist) + '</span></div><span class="wo-muted">' + (r.diffs || 0) + ' diffs</span></div>').join('') || '<div class="wo-note">No captured online rows yet. Open WOSU\'s beatmap listing / search to populate this panel from the site\'s own API responses.</div>';
            }
            return html;
        });
        return gatedCard('beatmapSearch', 'Beatmap search panel', 'Searches WOSU\'s real library metadata and the API responses it fetched.', [input, tab, results, btnbar([
            btn('Clear captured online data', () => { R.online.results = []; R.online.count = 0; refreshActiveSection(true); notify('info', 'Online cache cleared', 'New listing requests will repopulate it.'); }, 'small'),
            btn('Refresh library', () => { void loadLibrary(); notify('info', 'Library refreshed', 'Reading IndexedDB "webosu".'); }, 'small')
        ])]);
    }
    function objectPreviewList() {
        return listBlock(() => {
            if (!R.beatmap) return ['<div class="wo-note">No beatmap loaded.</div>'];
            const t = R.audio.songTime, objs = R.beatmap.objects, i0 = lowerBound(objs, t);
            return objs.slice(i0, i0 + clamp(finite(cfg.visuals.upcomingCount, 8), 3, 16)).map(o =>
                '<div class="wo-list-item" data-value="' + o.index + '"><span class="wo-tag">' + objectLabel(o).toUpperCase().slice(0, 3) + '</span><div class="wo-grow">#' + (o.index + 1) + ' ' + objectLabel(o) + ' @ ' + fmtTime(o.time) + ' · ' + Math.round(o.x) + ',' + Math.round(o.y) + '</div><span class="wo-muted">+' + Math.round(o.time - t) + ' ms</span></div>'
            );
        }, v => { R.tracking.selectedIndex = Number(v); setSection('inspector'); });
    }
    function eventLogList(limit, filter) {
        const types = filter || 'all';
        return tableWrap(['Time', 'Type', 'Message'], () => {
            let ev = session.eventLog.slice().reverse();
            if (types === 'errors') ev = ev.filter(e => /error/i.test(e.type));
            else if (types === 'audio') ev = ev.filter(e => /audio|play|sync/i.test(e.type));
            else if (types === 'beatmap') ev = ev.filter(e => /beatmap|selection|library|api/i.test(e.type));
            return ev.slice(0, limit || 60).map(e => ({ cells: [new Date(e.at).toLocaleTimeString(), e.type, esc(e.message)] }));
        }, { maxHeight: 260 });
    }

    // ---- graph drawing helpers ----
    function drawBpmGraph(ctx, w, h) {
        const an = analysis();
        if (!an || !an.bpmDistribution.length) { ctx.fillStyle = '#8987a3'; ctx.font = '11px ui-monospace,monospace'; ctx.fillText('No timing points', 10, 20); return; }
        const vals = an.bpmDistribution.map(b => b.bpm), min = Math.min(...vals) * 0.92, max = Math.max(...vals) * 1.08;
        const total = Math.max(1, an.songDuration);
        ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * h / 4); ctx.lineTo(w, i * h / 4); ctx.stroke(); }
        ctx.beginPath();
        for (const b of an.bpmDistribution) {
            const x1 = b.time / total * w, x2 = b.end / total * w, y = h - 8 - ((b.bpm - min) / (max - min)) * (h - 20);
            ctx.moveTo(x1, y); ctx.lineTo(Math.max(x1 + 1, x2), y);
        }
        ctx.strokeStyle = '#a970ff'; ctx.lineWidth = 2.5; ctx.stroke();
        const px = clamp(R.audio.songTime / total, 0, 1) * w;
        ctx.strokeStyle = '#5ad1ff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
        ctx.fillStyle = '#e8e6f2'; ctx.font = '9px ui-monospace,monospace';
        ctx.fillText(fmtNum(max, 0) + ' BPM', 4, 11); ctx.fillText(fmtNum(min, 0) + ' BPM', 4, h - 4);
    }
    function drawDriftGraph(ctx, w, h) {
        const data = R.audio.driftHistory;
        const warn = finite(cfg.audio.warnDriftMs, 35);
        ctx.strokeStyle = 'rgba(255,204,102,.35)'; ctx.setLineDash([4, 4]);
        const zero = h / 2, scale = (h / 2 - 8) / Math.max(10, warn * 2);
        ctx.beginPath(); ctx.moveTo(0, zero - warn * scale); ctx.lineTo(w, zero - warn * scale);
        ctx.moveTo(0, zero + warn * scale); ctx.lineTo(w, zero + warn * scale); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.moveTo(0, zero); ctx.lineTo(w, zero); ctx.stroke();
        if (!data.length) { ctx.fillStyle = '#8987a3'; ctx.font = '10px ui-monospace,monospace'; ctx.fillText('Waiting for audio drift samples…', 8, 16); return; }
        ctx.beginPath();
        data.forEach((v, i) => { const x = i / Math.max(1, data.length - 1) * w, y = clamp(zero - v * scale, 2, h - 2); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = '#ffcc66'; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.fillStyle = '#e8e6f2'; ctx.font = '9px ui-monospace,monospace';
        ctx.fillText('now ' + round(data[data.length - 1], 1) + ' ms', 5, 12);
    }
    function drawWaveform(ctx, w, h) {
        const peaks = R.audio.peaks, wave = R.audio.wave;
        ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
        if (peaks && peaks.length) {
            const mid = h / 2;
            ctx.fillStyle = 'rgba(169,112,255,.55)';
            for (let i = 0; i < peaks.length; i++) {
                const x = i / peaks.length * w, bh = Math.max(1, peaks[i] * (h * 0.42));
                ctx.fillRect(x, mid - bh, Math.max(1, w / peaks.length), bh * 2);
            }
            const px = clamp(R.audio.songTime / Math.max(1, R.audio.duration), 0, 1) * w;
            ctx.fillStyle = '#5ad1ff'; ctx.fillRect(px - 1, 0, 2, h);
        } else { ctx.fillStyle = '#8987a3'; ctx.font = '10px ui-monospace,monospace'; ctx.fillText('Full-song waveform appears once WOSU decodes the music buffer.', 8, 18); }
        if (wave && cfg.audio.showWaveform) {
            ctx.beginPath();
            wave.forEach((v, i) => { const x = i / (wave.length - 1) * w, y = h / 2 + v * h * 0.44; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
            ctx.strokeStyle = 'rgba(90,209,255,.85)'; ctx.lineWidth = 1.5; ctx.stroke();
        }
    }
    function drawSpectrum(ctx, w, h) {
        const s = R.audio.spectrum;
        if (!s) { ctx.fillStyle = '#8987a3'; ctx.font = '10px ui-monospace,monospace'; ctx.fillText('Waiting for analyser data…', 8, 18); return; }
        for (let i = 0; i < s.length; i++) {
            const bh = s[i] * (h - 8), x = i / s.length * w;
            const grad = ctx.createLinearGradient(0, h - bh, 0, h);
            grad.addColorStop(0, '#5ad1ff'); grad.addColorStop(1, '#a970ff');
            ctx.fillStyle = grad; ctx.fillRect(x + 1, h - bh, Math.max(1, w / s.length - 2), bh);
        }
    }
    function drawFrameGraph(ctx, w, h, data, color, maxVal) {
        const arr = data && data.length ? data : [0];
        const max = Math.max(1, maxVal || Math.max(...arr));
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * h / 4); ctx.lineTo(w, i * h / 4); ctx.stroke(); }
        ctx.beginPath();
        arr.forEach((v, i) => { const x = i / Math.max(1, arr.length - 1) * w, y = h - 4 - clamp(v / max, 0, 1) * (h - 10); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.fillStyle = '#e8e6f2'; ctx.font = '9px ui-monospace,monospace'; ctx.fillText('max ' + round(max, 1), 4, 11);
    }
    function drawTimeline(ctx, w, h) {
        const b = R.beatmap, a = R.audio;
        const center = a.songTime + (R.timelinePanMs || 0);
        const win = clamp(finite(cfg.timeline.windowMs, 14000), 1000, 120000) / clamp(finite(cfg.timeline.zoom, 1), 0.25, 8);
        const t0 = center - win / 2, t1 = center + win / 2;
        const xOf = t => (t - t0) / win * w;
        // beat grid
        const cps = b ? b.controlPoints : [];
        const cp = cps.length ? cpAt(cps, t0) : null;
        if (cp && cp.beatLength > 0) {
            ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
            const first = Math.ceil(t0 / cp.beatLength) * cp.beatLength;
            for (let t = first; t < t1; t += cp.beatLength) { const x = xOf(t); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        }
        // density shading
        const an = analysis();
        if (an && cfg.timeline.showBookmarks !== false) {
            const max = Math.max(1, ...an.sections.map(s => s.density));
            for (const s of an.sections) {
                if (s.end < t0 || s.start > t1) continue;
                const x1 = clamp(xOf(s.start), 0, w), x2 = clamp(xOf(s.end), 0, w);
                ctx.fillStyle = 'rgba(169,112,255,' + (0.03 + 0.13 * s.density / max) + ')';
                ctx.fillRect(x1, h - 22, Math.max(1, x2 - x1), 22);
            }
        }
        // objects
        if (b) {
            const from = Math.max(0, lowerBound(b.objects, t0)), to = Math.min(b.objects.length, lowerBound(b.objects, t1) + 1);
            const colors = cfg.visuals.colors;
            for (let i = from; i < to; i++) {
                const o = b.objects[i], x = xOf(o.time);
                const y = o.kind === 'circle' ? h * 0.34 : o.kind === 'slider' ? h * 0.52 : h * 0.70;
                const col = colors[o.kind] || '#ffffff';
                if (o.kind === 'slider') {
                    ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 4;
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xOf(o.endTime), y); ctx.stroke();
                }
                if (o.kind === 'spinner') {
                    ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xOf(o.endTime), y); ctx.stroke();
                }
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.arc(x, y, o.kind === 'circle' ? 4 : 5, 0, Math.PI * 2); ctx.fill();
                if (cfg.timeline.showLabels && i - from < 40) {
                    ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.font = '9px ui-monospace,monospace'; ctx.textAlign = 'center';
                    ctx.fillText(String(i + 1), x, y - 9);
                }
                if (R.tracking.selectedIndex === i) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); }
            }
        }
        // bookmarks
        if (cfg.timeline.showBookmarks) {
            for (const bm of session.bookmarks) {
                if (bm.time < t0 || bm.time > t1) continue;
                const x = xOf(bm.time);
                ctx.fillStyle = '#ffd166'; ctx.fillRect(x - 1, 0, 2, h);
                ctx.fillStyle = '#ffd166'; ctx.font = '9px ui-monospace,monospace'; ctx.textAlign = 'left';
                ctx.fillText('◆ ' + esc(bm.label).slice(0, 18), x + 3, 11);
            }
        }
        // playhead
        const px = xOf(a.songTime);
        ctx.strokeStyle = '#5ad1ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
        ctx.fillStyle = '#5ad1ff'; ctx.font = '9px ui-monospace,monospace'; ctx.textAlign = 'left';
        ctx.fillText(fmtTimePrecise(a.songTime), Math.min(w - 60, px + 4), h - 5);
        // hover tooltip
        if (R.timelineHover != null && Number.isFinite(R.timelineHover)) {
            const hx = xOf(R.timelineHover);
            ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#e8e6f2'; ctx.fillText(fmtTimePrecise(R.timelineHover), clamp(hx + 4, 4, w - 70), 12);
        }
    }
    function timelineCanvas() {
        const c = graph(drawTimeline, 'tall', 'wo-timeline');
        c.addEventListener('pointermove', e => {
            const rect = c.getBoundingClientRect();
            const win = clamp(finite(cfg.timeline.windowMs, 14000), 1000, 120000) / clamp(finite(cfg.timeline.zoom, 1), 0.25, 8);
            const center = R.audio.songTime + (R.timelinePanMs || 0);
            R.timelineHover = center - win / 2 + ((e.clientX - rect.left) / Math.max(1, rect.width)) * win;
            if (R.timelineDrag) R.timelinePanMs = R.timelineDrag.pan - (e.clientX - R.timelineDrag.x) / Math.max(1, rect.width) * win;
        });
        c.addEventListener('pointerleave', () => { R.timelineHover = null; });
        c.addEventListener('pointerdown', e => { R.timelineDrag = { x: e.clientX, pan: R.timelinePanMs || 0 }; c.setPointerCapture && c.setPointerCapture(e.pointerId); });
        c.addEventListener('pointerup', () => { R.timelineDrag = null; });
        c.addEventListener('click', e => {
            if (!R.beatmap) return;
            const rect = c.getBoundingClientRect();
            const win = clamp(finite(cfg.timeline.windowMs, 14000), 1000, 120000) / clamp(finite(cfg.timeline.zoom, 1), 0.25, 8);
            const center = R.audio.songTime + (R.timelinePanMs || 0);
            const t = center - win / 2 + ((e.clientX - rect.left) / Math.max(1, rect.width)) * win;
            const objs = R.beatmap.objects; let best = lowerBound(objs, t), bd = Infinity;
            for (let i = Math.max(0, best - 4); i < Math.min(objs.length, best + 5); i++) { const d = Math.abs(objs[i].time - t); if (d < bd) { bd = d; best = i; } }
            if (bd < win * 0.04) { R.tracking.selectedIndex = best; logEvent('inspect', 'Selected object #' + (best + 1) + ' from timeline'); refreshActiveSection(true); }
        });
        c.addEventListener('wheel', e => {
            e.preventDefault();
            cfg.timeline.zoom = clamp(finite(cfg.timeline.zoom, 1) * (e.deltaY > 0 ? 0.85 : 1.18), 0.25, 8);
            saveConfig();
        }, { passive: false });
        return c;
    }

    // =======================================================================
    // 17. Remaining sections
    // =======================================================================
    function buildSection2(id) {
        buildingSection = id;
        switch (id) {
            // ---------------------------------------------------------------- Timeline
            case 'timeline': {
                return el('div', {}, [
                    gatedCard('beatmapTimeline', 'Beatmap timeline', 'Hover for timestamps · click an object to inspect it · drag to pan · scroll to zoom.', [
                        timelineCanvas(),
                        el('div', { class: 'wo-grid cols2' }, [
                            rangeCtl('timeline.windowMs', 'Window', 'Visible time span.', 2000, 60000, 1000, ' ms'),
                            rangeCtl('timeline.zoom', 'Zoom', 'Timeline magnification.', 0.25, 8, 0.05, 'x')
                        ]),
                        toggle('timeline.showLabels', 'Object numbers', 'Print sequence numbers on markers.'),
                        toggle('timeline.showBookmarks', 'Bookmark markers', 'Show saved section bookmarks.'),
                        btnbar([
                            btn('Center on playhead', () => { R.timelinePanMs = 0; }, 'small'),
                            btn('Bookmark playhead', addBookmark, 'small primary'),
                            btn('Inspect selected', () => setSection('inspector'), 'small'),
                            btn('Clear bookmarks', () => modal('Clear bookmarks', 'Remove all saved section bookmarks?', () => { session.bookmarks = []; saveSession(); refreshActiveSection(true); notify('info', 'Bookmarks cleared', ''); }, 'Clear'), 'small danger')
                        ])
                    ]),
                    moduleCard('bpmGraph', 'BPM graph', 'Tempo changes from the beatmap\'s uninherited timing points.', () => [
                        graph(drawBpmGraph, 'tall'),
                        kv(() => { const an = analysis(); return an ? 'BPM range: ' + fmtNum(an.bpmMin, 2) + ' – ' + fmtNum(an.bpmMax, 2) + '\nTempo sections: ' + an.bpmDistribution.length + '\nCurrent: ' + (R.beatmap ? fmtNum(60000 / cpAt(R.beatmap.controlPoints, R.audio.songTime).beatLength, 2) : '—') + ' BPM' : 'No beatmap'; })
                    ]),
                    moduleCard('timingInspector', 'Timing inspector', 'Every timing point with its effective control state.', () => [
                        kv(() => {
                            if (!R.beatmap) return 'No beatmap loaded.';
                            const t = R.audio.songTime, cp = cpAt(R.beatmap.controlPoints, t);
                            return ['Current time: ' + fmtTimePrecise(t), 'Governing point: ' + fmtTime(cp.time), 'Beat length: ' + round(cp.beatLength, 3) + ' ms', 'BPM: ' + fmtNum(60000 / cp.beatLength, 3), 'Slider velocity: ' + round(cp.sliderVelocity, 3) + 'x', 'Meter: ' + cp.meter + '/4', 'Sample set: ' + cp.sampleSet + ' · index ' + cp.sampleIndex + ' · volume ' + cp.volume, 'Kiai: ' + cp.kiai, 'Ticks enabled: ' + (cp.generateTicks !== false), 'Total timing points: ' + R.beatmap.data.timingPoints.length].join('\n');
                        }),
                        tableWrap(['#', 'Time', 'Beat length', 'BPM', 'SV', 'Meter', 'Kiai', 'Type'], () => {
                            if (!R.beatmap) return [];
                            const t = R.audio.songTime;
                            return R.beatmap.data.timingPoints.slice(0, 250).map((p, i) => ({ __sel: Math.abs(p.time - cpAt(R.beatmap.controlPoints, t).time) < 0.001, cells: [numberCell(i), fmtTime(p.time), numberCell(round(p.beatLength, 2)), p.uninherited ? numberCell(fmtNum(60000 / p.beatLength, 1)) : '—', numberCell(round(sliderVelocityOf(p.beatLength), 2)), String(p.meter), p.kiai ? 'KIAI' : '—', p.uninherited ? 'red' : 'green'] }));
                        }, { maxHeight: 210 })
                    ]),
                    moduleCard('timingDriftGraph', 'Timing drift graph', 'Difference between the audio clock and the interpolated wall clock.', () => [
                        graph(drawDriftGraph, 'tall'),
                        kv(() => 'Samples: ' + R.audio.driftHistory.length + '\nCurrent drift: ' + round(R.audio.driftMs, 2) + ' ms\nWarn threshold: ' + cfg.audio.warnDriftMs + ' ms\nSync: ' + (R.audio.syncLost ? 'LOST' : 'OK'))
                    ]),
                    moduleCard('objectPreview', 'Object preview panel', 'The next several hit objects at the live playhead.', () => [objectPreviewList()]),
                    moduleCard('liveEventLog', 'Recent events', 'Game, audio, beatmap and tracking events.', () => [eventLogList(24, 'all')])
                ]);
            }
            // ---------------------------------------------------------------- Audio Analysis
            case 'audio': {
                return el('div', {}, [
                    card('Audio synchronization', 'Clock read from WOSU\'s AudioContext, its buffer sources and its time-stretch worklet.', statGrid([
                        { label: 'Song time', get: () => fmtTimePrecise(R.audio.songTime) },
                        { label: 'Duration', get: () => fmtTime(R.audio.duration) },
                        { label: 'Progress', get: () => R.audio.duration > 0 ? round(clamp(R.audio.songTime / R.audio.duration, 0, 1) * 100, 1) + '%' : '—' },
                        { label: 'Playback rate', get: () => round(R.audio.rate, 3) + 'x' },
                        { label: 'Context', get: () => R.audio.ctxState.toUpperCase() },
                        { label: 'Playing', get: () => R.audio.playing ? 'YES' : 'NO' },
                        { label: 'Sample rate', get: () => Math.round(R.audio.sampleRate) + ' Hz' },
                        { label: 'Output latency', get: () => round(R.audio.outputLatencyMs, 1) + ' ms' },
                        { label: 'Base latency', get: () => round(R.audio.baseLatencyMs, 1) + ' ms' },
                        { label: 'Decoder delay', get: () => round(R.audio.startOffsetMs, 1) + ' ms' },
                        { label: 'WOSU offset', get: () => round(R.site.userOffsetMs, 1) + ' ms' },
                        { label: 'Manual offset', get: () => round(finite(cfg.audio.offsetManualMs, 0), 1) + ' ms' },
                        { label: 'Total offset', get: () => round(R.audio.offsetMs, 1) + ' ms' },
                        { label: 'Sync drift', get: () => round(R.audio.driftMs, 2) + ' ms', cls: 'warn' },
                        { label: 'Sync status', get: () => R.audio.syncLost ? 'LOST' : R.audio.playing ? 'LOCKED' : 'IDLE' },
                        { label: 'Audio source', get: () => R.audio.active ? 'buffer @ ' + fmtTime(R.audio.active.offset * 1000) : R.audio.worklet.active ? 'stretch worklet' : 'none' },
                        { label: 'Last event', get: () => R.audio.lastEvent },
                        { label: 'RMS level', get: () => round(R.audio.levels.rms, 3) }
                    ], 'tight')),
                    card('Audio offset breakdown', 'Where the displayed offset comes from (all verified WOSU values).', kv(() => [
                        'startOffsetMs (decoder/encoder delay measured from decoded PCM): ' + round(R.audio.startOffsetMs, 2),
                        'global audioOffset (localStorage webosu.settings.v2): ' + round(R.site.audioOffset, 2),
                        'per-beatmap offset (wosu.beatmapOffsets.v1): ' + round(R.site.beatmapOffset, 2),
                        'rate multiplier: ' + round(R.site.rate, 3),
                        'userOffsetMs = (global + beatmap) × rate: ' + round(R.site.userOffsetMs, 2),
                        'manual correction (this suite): ' + round(finite(cfg.audio.offsetManualMs, 0), 2),
                        'songTime = rawPosition × 1000 − (startOffset + userOffset + manual)',
                        'rawPosition = offset + (ctx.currentTime − when) × rate'
                    ].join('\n'))),
                    moduleCard('audioWaveform', 'Audio waveform', 'Full-song peaks from WOSU\'s decoded AudioBuffer and the live analyser.', () => [
                        graph(drawWaveform, 'tall'),
                        kv(() => 'Decoded buffer: ' + (R.audio.decode ? fmtTime(R.audio.decode.duration * 1000) + ' · ' + R.audio.decode.channels + 'ch @ ' + R.audio.decode.sampleRate + ' Hz' : 'not decoded yet') + '\nWaveform peaks: ' + (R.audio.peaks ? R.audio.peaks.length : 0) + '\nLive RMS: ' + round(R.audio.levels.rms, 4) + ' · peak: ' + round(R.audio.levels.peak, 4))
                    ]),
                    card('Spectrum & levels', 'Frequency data from WOSU\'s own music analyser (pre-volume tap).', [
                        graph(drawSpectrum, 'short'),
                        kv(() => ['Bass: ' + round(R.audio.levels.bass, 3), 'Mid: ' + round(R.audio.levels.mid, 3), 'Treble: ' + round(R.audio.levels.treble, 3), 'RMS: ' + round(R.audio.levels.rms, 4), 'Peak: ' + round(R.audio.levels.peak, 4), 'Media element: ' + (R.audio.media ? R.audio.media.state + ' @ ' + fmtTime(R.audio.media.currentTime * 1000) : 'none')].join('\n'))
                    ]),
                    moduleCard('timingDriftGraph', 'Synchronization drift', 'Audio clock vs. wall-clock interpolation.', () => [
                        graph(drawDriftGraph, 'tall'),
                        btnbar([btn('Reset drift baseline', () => { R.audio.predicted = R.audio.songTime; R.audio.driftHistory = []; R.audio.driftMs = 0; refreshActiveSection(true); }, 'small'), btn('Clear drift history', () => { R.audio.driftHistory = []; }, 'small')])
                    ]),
                    card('Timing information', 'Current control point and beat phase from the beatmap timeline.', kv(() => {
                        if (!R.beatmap) return 'No beatmap loaded.';
                        const t = R.audio.songTime, cp = cpAt(R.beatmap.controlPoints, t);
                        const beat = 60000 / cp.beatLength;
                        const since = t - cp.time, beatIndex = Math.floor(since / cp.beatLength), phase = (since - beatIndex * cp.beatLength) / cp.beatLength;
                        return ['Beat length: ' + round(cp.beatLength, 2) + ' ms', 'BPM: ' + fmtNum(beat, 2), 'Beat index: ' + beatIndex, 'Beat phase: ' + round(phase, 3), 'Meter: ' + cp.meter + '/4', 'Slider velocity: ' + round(cp.sliderVelocity, 2) + 'x', 'Kiai: ' + cp.kiai, 'Volume: ' + cp.volume + '%', 'Sample set: ' + cp.sampleSet, 'Timing points: ' + R.beatmap.controlPoints.length, 'Playback speed: ' + round(R.audio.rate, 3) + 'x'].join('\n');
                    })),
                    card('Playback events', 'Pauses, resumes, seeks and speed changes detected from real audio source events.', eventLogList(30, 'audio')),
                    card('Audio settings', 'Synchronization warnings and waveform display.', [
                        toggle('audio.showWaveform', 'Live waveform', 'Overlay the live analyser waveform.'),
                        toggle('audio.showSpectrum', 'Spectrum', 'Show frequency bars.'),
                        toggle('audio.showTimingInfo', 'Timing information', 'Show control-point details.'),
                        numberCtl('audio.warnDriftMs', 'Drift warning', 'Notify beyond this drift.', 5, 300, 1, ' ms'),
                        numberCtl('audio.offsetManualMs', 'Manual offset', 'Extra correction added to the audio clock.', -500, 500, 1, ' ms'),
                        rangeCtl('audio.driftWindow', 'Drift window', 'Samples kept in the drift graph.', 20, 600, 10, ''),
                        btnbar([btn('Export audio stats', () => download('wosu-audio-stats-' + Date.now() + '.json', JSON.stringify({ audio: R.audio, site: R.site, events: session.eventLog.filter(e => /audio|play|sync/.test(e.type)).slice(-100) }, (k, v) => k === 'analyser' || k === 'wave' || k === 'spectrum' ? undefined : v, 2)), 'small')])
                    ])
                ]);
            }
            // ---------------------------------------------------------------- Object Inspector
            case 'inspector': {
                const kindSel = el('select', { class: 'wo-select', style: 'margin-bottom:6px;' }, [el('option', { value: 'all', text: 'All kinds' }), el('option', { value: 'circle', text: 'Circles' }), el('option', { value: 'slider', text: 'Sliders' }), el('option', { value: 'spinner', text: 'Spinners' })]);
                kindSel.value = R.ui.inspectorKind || 'all';
                kindSel.addEventListener('change', () => { R.ui.inspectorKind = kindSel.value; refreshActiveSection(true); });
                const query = el('input', { class: 'wo-input', type: 'search', placeholder: 'Filter by # / time / position…', style: 'width:100%;max-width:none;margin-bottom:8px;' });
                query.addEventListener('input', () => { R.ui.inspectorQuery = query.value.trim(); refreshActiveSection(true); });
                return el('div', {}, [
                    moduleCard('objectInspector', 'Object inspector', 'Select any hit object to inspect its real properties.', () => [
                        el('div', { class: 'wo-grid cols2' }, [kindSel, query]),
                        tableWrap(['#', 'Kind', 'Time', 'End', 'X', 'Y', 'Combo'], () => {
                            if (!R.beatmap) return [];
                            const t = R.audio.songTime, objs = R.beatmap.objects;
                            const from = Math.max(0, lowerBound(objs, t - 4000)), to = Math.min(objs.length, from + 120);
                            const q = (R.ui.inspectorQuery || '').toLowerCase(), kind = R.ui.inspectorKind || 'all';
                            const rows = [];
                            for (let i = from; i < to; i++) {
                                const o = objs[i];
                                if (kind !== 'all' && o.kind !== kind) continue;
                                const hay = ('#' + (i + 1) + ' ' + o.kind + ' ' + fmtTime(o.time) + ' ' + Math.round(o.x) + ',' + Math.round(o.y)).toLowerCase();
                                if (q && hay.indexOf(q) === -1) continue;
                                rows.push({ cells: [numberCell(i + 1), objectLabel(o), fmtTime(o.time), fmtTime(o.endTime), Math.round(o.x), Math.round(o.y), String(o.comboNumber || '—')], __attrs: ' data-idx="' + i + '"', __sel: R.tracking.selectedIndex === i });
                                if (rows.length > 70) break;
                            }
                            return rows;
                        }, { maxHeight: 260, onRow: d => { R.tracking.selectedIndex = Number(d.idx); logEvent('inspect', 'Inspected object #' + (Number(d.idx) + 1)); refreshActiveSection(true); } }),
                        btnbar([
                            btn('Select current', () => { R.tracking.selectedIndex = activeObjectIndex(R.audio.songTime); refreshActiveSection(true); }, 'small'),
                            btn('Select next', () => { R.tracking.selectedIndex = R.beatmap ? lowerBound(R.beatmap.objects, R.audio.songTime + 1) : -1; refreshActiveSection(true); }, 'small'),
                            btn('Bookmark selected time', () => { const o = selectedObject(); if (o) addBookmarkAt(o.time, 'Object #' + (o.index + 1)); }, 'small')
                        ]),
                        el('h3', { text: 'Selected object', style: 'margin:12px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;' }),
                        kv(() => objectKV(selectedObject()))
                    ]),
                    moduleCard('sliderInspector', 'Slider inspector', 'Duration, curve, ticks and path for the selected slider.', () => [
                        kv(() => {
                            const o = selectedObject();
                            if (!o || o.kind !== 'slider') return 'Select a slider above to inspect its geometry and tick information.';
                            return ['Curve type: ' + (o.curveType || 'B') + ' (' + ({ B: 'Bézier', L: 'Linear', P: 'Perfect circle', C: 'Catmull' }[o.curveType] || 'Bézier') + ')',
                                'Control points (raw): ' + (o.rawControlPoints || []).map(p => p.x + ',' + p.y).join(' | '),
                                'Path length: ' + round(o.path.length, 2) + ' px · expected ' + round(o.pixelLength, 2) + ' px',
                                'Repeats / slides: ' + o.slides, 'One span: ' + fmtTimePrecise(o.spanDuration), 'Total duration: ' + fmtTimePrecise(o.duration),
                                'Velocity: ' + round(o.velocity, 5) + ' px/ms', 'Tick distance: ' + round(o.tickDistance, 2) + ' px · ticks: ' + o.ticks,
                                'Nested events: ' + (o.events || []).length, 'Tail position: ' + round(o.endX, 1) + ', ' + round(o.endY, 1),
                                'Path vertices: ' + (o.path.points || []).length].join('\n');
                        }),
                        graph((ctx, w, h) => {
                            const o = selectedObject();
                            if (!o || o.kind !== 'slider' || !o.path) { ctx.fillStyle = '#8987a3'; ctx.font = '10px ui-monospace,monospace'; ctx.fillText('No slider selected.', 8, 18); return; }
                            const pts = o.path.points;
                            const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
                            const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
                            const s = Math.min((w - 30) / Math.max(1, maxX - minX), (h - 30) / Math.max(1, maxY - minY));
                            const ox = (w - (maxX - minX) * s) / 2 - minX * s, oy = (h - (maxY - minY) * s) / 2 - minY * s;
                            ctx.beginPath();
                            pts.forEach((p, i) => { const x = p.x * s + ox, y = p.y * s + oy; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
                            ctx.strokeStyle = '#6be5ff'; ctx.lineWidth = 3; ctx.stroke();
                            const head = pts[0], tail = pts[pts.length - 1];
                            ctx.fillStyle = '#ff5fa2'; ctx.beginPath(); ctx.arc(head.x * s + ox, head.y * s + oy, 5, 0, Math.PI * 2); ctx.fill();
                            ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(tail.x * s + ox, tail.y * s + oy, 5, 0, Math.PI * 2); ctx.fill();
                            for (const ev of (o.events || []).slice(0, 60)) {
                                const x = ev.x * s + ox, y = ev.y * s + oy;
                                ctx.fillStyle = ev.kind === 'repeat' ? '#ffffff' : 'rgba(255,209,102,.8)';
                                ctx.beginPath(); ctx.arc(x, y, ev.kind === 'repeat' ? 3 : 1.6, 0, Math.PI * 2); ctx.fill();
                            }
                        }, 'tall')
                    ]),
                    moduleCard('spinnerInspector', 'Spinner inspector', 'Timing and live progress of the selected spinner.', () => [
                        kv(() => {
                            const o = selectedObject();
                            if (!o || o.kind !== 'spinner') return 'Select a spinner above to inspect its timing.';
                            const p = clamp((R.audio.songTime - o.time) / Math.max(1, o.duration), 0, 1);
                            return ['Start: ' + fmtTimePrecise(o.time), 'End: ' + fmtTimePrecise(o.endTime), 'Duration: ' + fmtTimePrecise(o.duration), 'Progress: ' + round(p * 100, 1) + '%', 'Remaining: ' + fmtTimePrecise(Math.max(0, o.endTime - R.audio.songTime)), 'Position: playfield center (256, 192)', 'New combo: ' + o.newCombo, 'Combo skip: ' + ((R.beatmap && R.beatmap.data.hitObjects[o.index] || {}).comboSkip || 0)].join('\n');
                        }),
                        graph((ctx, w, h) => {
                            const o = selectedObject(); if (!o || o.kind !== 'spinner') { ctx.fillStyle = '#8987a3'; ctx.font = '10px ui-monospace,monospace'; ctx.fillText('No spinner selected.', 8, 18); return; }
                            const p = clamp((R.audio.songTime - o.time) / Math.max(1, o.duration), 0, 1), cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 12;
                            ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
                            ctx.strokeStyle = '#ffd166'; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
                            ctx.fillStyle = '#e8e6f2'; ctx.font = '14px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.fillText(Math.round(p * 100) + '%', cx, cy + 5);
                        }, 'short')
                    ]),
                    moduleCard('objectPreview', 'Object preview', 'Next objects at the playhead.', () => [objectPreviewList()]),
                    moduleCard('difficultyComparison', 'Difficulty comparison', 'Compare available difficulties of the current set (WOSU library metadata).', () => [difficultyTable()]),
                    beatmapSearchPanel()
                ]);
            }

            // ---------------------------------------------------------------- Performance
            case 'performance': {
                return el('div', {}, [
                    card('Live performance', 'FPS and frame time come from WOSU\'s own requestAnimationFrame loop.', statGrid([
                        { label: 'FPS (WOSU loop)', get: () => Math.round(R.perf.frameRate) },
                        { label: 'Frame time', get: () => round(R.perf.frameTime, 2) + ' ms' },
                        { label: 'Overlay FPS', get: () => Math.round(R.perf.ownFps) },
                        { label: 'Overlay frame', get: () => round(R.perf.ownFrameMs, 2) + ' ms' },
                        { label: 'Canvas render', get: () => round(R.perf.renderMs, 2) + ' ms' },
                        { label: 'Tracking rate', get: () => round(R.perf.trackingHz, 1) + ' Hz' },
                        { label: 'Drawn objects', get: () => R.tracking.drawn },
                        { label: 'Memory (Chrome)', get: memoryText },
                        { label: 'Frames observed', get: () => R.perf.frames },
                        { label: 'Audio sync', get: () => R.audio.syncLost ? 'LOST' : 'OK' },
                        { label: 'Warnings', get: () => R.perf.warn || 'none' },
                        { label: 'Preset', get: () => (PERF_PRESETS[cfg.perf.preset] || { name: 'Custom' }).name },
                        { label: 'Lightweight', get: () => cfg.perf.lightweight ? 'ON' : 'OFF' },
                        { label: 'Update interval', get: () => cfg.perf.updateIntervalMs + ' ms' },
                        { label: 'History length', get: () => cfg.perf.historyLength },
                        { label: 'Avg FPS', get: () => R.perf.fpsHistory.length ? round(R.perf.fpsHistory.reduce((a, b) => a + b, 0) / R.perf.fpsHistory.length, 1) : '—' }
                    ], 'tight')),
                    card('Frame-time graph', 'Milliseconds between frames (lower is better).', graph((ctx, w, h) => drawFrameGraph(ctx, w, h, R.perf.frameHistory, '#5ad1ff', Math.max(40, finite(cfg.perf.warnFrameMs, 25) * 2)), 'tall')),
                    card('FPS history', 'Frames per second over the configured history window.', graph((ctx, w, h) => drawFrameGraph(ctx, w, h, R.perf.fpsHistory, '#7ee787', 240), 'tall')),
                    card('Rendering performance', 'Time spent drawing the visual overlay each frame.', graph((ctx, w, h) => drawFrameGraph(ctx, w, h, R.perf.renderHistory, '#c07bff', 20), 'short')),
                    card('Performance history', 'Recent samples (live).',
                        tableWrap(['Time', 'FPS', 'Frame ms', 'Render ms', 'Song time', 'Objects'], () => R.perf.history.slice(-18).reverse().map(p => ({ cells: [new Date(p.at).toLocaleTimeString(), numberCell(Math.round(p.fps)), numberCell(round(p.frameMs, 1)), numberCell(round(R.perf.renderMs, 1)), fmtTime(p.song), String(p.objects)] })), { maxHeight: 210 })),
                    card('Performance settings', 'Tune overhead and warning thresholds.', [
                        toggle('perf.lightweight', 'Lightweight rendering', 'Lower DPR, fewer labels and no glow/trails.'),
                        toggle('perf.showWarnings', 'Performance warnings', 'Notify on low FPS / high frame time.'),
                        rangeCtl('perf.updateIntervalMs', 'UI update interval', 'How often panels refresh.', 33, 1000, 1, ' ms'),
                        rangeCtl('perf.canvasIntervalMs', 'Canvas interval', 'Minimum delay between visual frames.', 8, 200, 1, ' ms'),
                        rangeCtl('perf.historyLength', 'History length', 'Samples kept in performance graphs.', 20, 500, 10, ''),
                        numberCtl('perf.warnFps', 'Low FPS threshold', 'Warn below this FPS.', 10, 240, 1, ' fps'),
                        numberCtl('perf.warnFrameMs', 'Frame-time threshold', 'Warn above this frame time.', 5, 200, 1, ' ms'),
                        btnbar([
                            btn('Clear history', () => { R.perf.history = []; R.perf.fpsHistory = []; R.perf.frameHistory = []; R.perf.renderHistory = []; refreshActiveSection(true); }, 'small'),
                            btn('Export performance CSV', () => {
                                const csv = 'time,fps,frameMs,songMs,objects\n' + R.perf.history.map(p => [p.at, p.fps.toFixed(2), p.frameMs.toFixed(2), p.song.toFixed(1), p.objects].join(',')).join('\n');
                                download('wosu-performance-' + Date.now() + '.csv', csv, 'text/csv');
                            }, 'small')
                        ])
                    ]),
                    moduleCard('performancePresets', 'Performance presets', 'Low-overhead / balanced / detailed visualization modes.', () => [
                        btnbar(Object.keys(PERF_PRESETS).map(k => btn(PERF_PRESETS[k].name, () => applyPerfPreset(k), k === cfg.perf.preset ? 'primary' : ''))),
                        kv(() => Object.keys(PERF_PRESETS).map(k => PERF_PRESETS[k].name + ': UI ' + PERF_PRESETS[k].patch.perf.updateIntervalMs + ' ms · range ' + PERF_PRESETS[k].patch.visuals.trackingRange + ' ms' + (PERF_PRESETS[k].patch.perf.lightweight ? ' · lightweight' : '')).join('\n')),
                        selectCtl('perf.preset', 'Active preset', ' Changing this applies the preset.', Object.keys(PERF_PRESETS).map(k => ({ value: k, label: PERF_PRESETS[k].name })))
                    ])
                ]);
            }
            // ---------------------------------------------------------------- Session Statistics
            case 'session': {
                const filter = el('select', { class: 'wo-select', style: 'margin-bottom:8px;' }, [el('option', { value: 'all', text: 'All events' }), el('option', { value: 'errors', text: 'Errors only' }), el('option', { value: 'audio', text: 'Audio / play' }), el('option', { value: 'beatmap', text: 'Beatmap / library' })]);
                filter.value = R.ui.logFilter || 'all';
                filter.addEventListener('change', () => { R.ui.logFilter = filter.value; refreshActiveSection(true); });
                R.ui.logListBox = eventLogList(80, R.ui.logFilter || 'all');
                return el('div', {}, [
                    gatedCard('sessionStats', 'Session statistics', 'Counters since the userscript started on this page.', statGrid([
                        { label: 'Session duration', get: () => fmtTime(now() - session.startedAt) },
                        { label: 'Play sessions', get: () => session.plays },
                        { label: 'Beatmaps loaded', get: () => session.beatmapsLoaded },
                        { label: 'Notifications', get: () => session.notifications },
                        { label: 'Objects tracked', get: () => session.stats.objectsTracked },
                        { label: 'Max on screen', get: () => session.stats.maxObjectsOnScreen },
                        { label: 'Play time', get: () => fmtTime(session.stats.playMs) },
                        { label: 'Frames observed', get: () => R.perf.frames },
                        { label: 'Average FPS', get: () => R.perf.fpsHistory.length ? round(R.perf.fpsHistory.reduce((a, b) => a + b, 0) / R.perf.fpsHistory.length, 1) : '—' },
                        { label: 'Favorites', get: () => session.favorites.length },
                        { label: 'Bookmarks', get: () => session.bookmarks.length },
                        { label: 'Event log entries', get: () => session.eventLog.length },
                        { label: 'Decoded .osu files', get: () => R.probe.osuCount },
                        { label: 'API responses', get: () => R.online.count },
                        { label: 'Probe errors', get: () => R.probe.errors.length },
                        { label: 'Configurations', get: () => configs.list.length }
                    ], 'tight')),
                    moduleCard('liveEventLog', 'Live event log', 'Important game, beatmap, audio, config and tracking events.', () => [
                        filter,
                        (() => { const slot = el('div', { id: 'wo-event-log-slot' }); slot.appendChild(R.ui.logListBox); return slot; })(),
                        btnbar([
                            btn('Clear log', () => { session.eventLog = []; saveSession(); refreshActiveSection(true); }, 'small danger'),
                            btn('Copy log', () => { const t = session.eventLog.map(e => new Date(e.at).toISOString() + ' [' + e.type + '] ' + e.message).join('\n'); if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); notify('info', 'Log copied', session.eventLog.length + ' entries.'); }, 'small'),
                            btn('Export log', () => download('wosu-event-log-' + Date.now() + '.json', JSON.stringify(session.eventLog, null, 2)), 'small')
                        ])
                    ]),
                    moduleCard('sectionBookmarks', 'Beatmap section bookmarks', 'Save interesting timestamps from the live clock.', () => [
                        btnbar([btn('Add bookmark at playhead', addBookmark, 'small primary'), btn('Export bookmarks', () => download('wosu-bookmarks-' + Date.now() + '.json', JSON.stringify(session.bookmarks, null, 2)), 'small')]),
                        listBlock(() => session.bookmarks.length ? session.bookmarks.map(b => '<div class="wo-list-item" data-value="' + esc(b.id) + '"><span class="wo-tag">' + fmtTime(b.time) + '</span><div class="wo-grow">' + esc(b.label) + ' <span class="wo-muted">· ' + esc(b.beatmap) + '</span></div><button class="wo-btn small" data-act="del">✕</button></div>') : ['<div class="wo-note">No bookmarks yet. Add one while a song is playing.</div>'], (v, e) => {
                            if (e.target.dataset.act === 'del') { session.bookmarks = session.bookmarks.filter(x => x.id !== v); saveSession(); refreshActiveSection(true); return; }
                            const b = session.bookmarks.find(x => x.id === v);
                            if (b) { R.tracking.inspectedTime = b.time; R.timelineHover = b.time; notify('info', 'Bookmark', b.label + ' @ ' + fmtTime(b.time)); setSection('timeline'); }
                        })
                    ]),
                    moduleCard('statsExport', 'Statistics export', 'Export available session and beatmap statistics.', () => [
                        btnbar([btn('Export JSON', () => exportStats('json'), 'primary small'), btn('Export CSV', () => exportStats('csv'), 'small'), btn('Copy summary', () => { const a = analysis(); const s = 'Session ' + fmtTime(now() - session.startedAt) + ' · ' + session.plays + ' plays · ' + (a ? a.total + ' objects · ' + fmtNum(a.bpmMin, 0) + '-' + fmtNum(a.bpmMax, 0) + ' BPM' : 'no beatmap'); if (navigator.clipboard) navigator.clipboard.writeText(s).catch(() => {}); notify('info', 'Summary copied', s); }, 'small')]),
                        kv(() => { const a = analysis(); return 'Export includes session counters, beatmap metadata, full analysis sections, performance history, audio offsets, favorites, bookmarks and playback history.' + (a ? '\nCurrent map: ' + a.metadata.artist + ' — ' + a.metadata.title + ' [' + a.metadata.version + '] · ' + a.total + ' objects' : ''); })
                    ]),
                    moduleCard('compactMode', 'Compact mode', 'Minimal interface for smaller screens.', () => [
                        toggle('compact', 'Compact interface', 'Collapsed sidebar and denser cards.'),
                        btn('Toggle now', () => { cfg.compact = !cfg.compact; saveConfig(); applyUiState(); refreshActiveSection(true); }, 'small')
                    ]),
                    moduleCard('configBackup', 'Configuration backup', 'One-file backup for all saved settings.', () => [
                        btnbar([btn('Export full backup', exportConfigBackup, 'primary small'), btn('Import full backup', async () => { const f = await pickFile(); if (f) importConfigBackup(safeParse(f.text, null)); }, 'small')]),
                        el('div', { class: 'wo-note', text: 'The backup includes themes, keybinds, HUD layouts, configurations, color presets, favorites, bookmarks, history and event logs.' })
                    ])
                ]);
            }
            // ---------------------------------------------------------------- Playback History
            case 'history': {
                return el('div', {}, [
                    moduleCard('playbackHistory', 'Playback history', 'Songs loaded this session and remembered across reloads.', () => [
                        tableWrap(['Loaded', 'Title', 'Artist', 'Mapper', 'Difficulty', 'Objects', ''], () => session.history.slice(0, 60).map(h => ({
                            cells: [new Date(h.at).toLocaleTimeString(), esc(h.title), esc(h.artist), esc(h.creator), esc(h.version), numberCell(h.objects), '<button class="wo-btn small" data-act="analyze">Analyze</button> <button class="wo-btn small" data-act="fav">★</button>'],
                            __attrs: ' data-key="' + esc(h.key || '') + '" data-file="' + esc(h.file || '') + '" data-title="' + esc(h.title) + '"'
                        })), {
                            maxHeight: 260, onRow: (d, e) => {
                                if (e.target.dataset.act === 'fav') {
                                    const id = (d.key || '') + '|' + (d.file || '');
                                    if (!session.favorites.some(f => f.id === id)) { session.favorites.unshift({ id, at: now(), title: d.title || 'Unknown', artist: '', creator: '', version: d.file || '', key: d.key || '', file: d.file || '', objects: 0 }); saveSession(); notify('info', 'Favorited', d.title || id); refreshActiveSection(true); }
                                    return;
                                }
                                if (d.key && d.file) void loadDifficultyForAnalysis(d.key, d.file);
                                else notify('info', 'Archive unavailable', 'This entry has no library key (captured from a decoder).');
                            }
                        }),
                        btnbar([
                            btn('Clear history', () => modal('Clear playback history', 'Remove all remembered songs?', () => { session.history = []; saveSession(); refreshActiveSection(true); }, 'Clear'), 'small danger'),
                            btn('Export history', () => download('wosu-playback-history-' + Date.now() + '.json', JSON.stringify(session.history, null, 2)), 'small'),
                            btn('Refresh library', () => { void loadLibrary(); }, 'small')
                        ])
                    ]),
                    moduleCard('favoriteBeatmaps', 'Favorite beatmaps', 'Save and recall beatmaps quickly.', () => [
                        btnbar([btn(isFavorite() ? '★ Remove current' : '☆ Save current beatmap', toggleFavorite, 'primary small'), btn('Export favorites', () => download('wosu-favorites-' + Date.now() + '.json', JSON.stringify(session.favorites, null, 2)), 'small')]),
                        listBlock(() => session.favorites.length ? session.favorites.map(f => '<div class="wo-list-item" data-value="' + esc(f.id) + '"><span class="wo-tag">★</span><div class="wo-grow">' + esc(f.title) + ' <span class="wo-muted">[' + esc(f.version) + '] · ' + esc(f.artist) + '</span></div><span class="wo-muted">' + (f.objects || 0) + ' obj</span><button class="wo-btn small" data-act="del">✕</button></div>') : ['<div class="wo-note">No favorites saved yet.</div>'], (v, e) => {
                            if (e.target.dataset.act === 'del') { session.favorites = session.favorites.filter(x => x.id !== v); saveSession(); refreshActiveSection(true); return; }
                            const f = session.favorites.find(x => x.id === v);
                            if (f && f.key && f.file) void loadDifficultyForAnalysis(f.key, f.file);
                        })
                    ]),
                    card('History diagnostics', 'Where history entries come from.', kv(() => [
                        'History entries: ' + session.history.length, 'Favorites: ' + session.favorites.length,
                        'Captured online rows: ' + R.online.results.length, 'Library sets: ' + R.lib.sets.length,
                        'Last API URL: ' + (R.online.lastUrl || '—'),
                        'Storage backend: ' + Store.mode
                    ].join('\n')))
                ]);
            }
            // ---------------------------------------------------------------- Configurations
            case 'configs': {
                const typeSel = el('select', { class: 'wo-select' }, [el('option', { value: 'full', text: 'Full configuration' }), el('option', { value: 'visual', text: 'Visual configuration' }), el('option', { value: 'performance', text: 'Performance configuration' })]);
                const nameInp = el('input', { class: 'wo-input', placeholder: 'Configuration name', value: 'My Config' });
                const descInp = el('input', { class: 'wo-input', placeholder: 'Description', value: '' });
                return el('div', {}, [
                    card('Configuration manager', 'Create, rename, duplicate, delete, import and export configurations.', [
                        el('div', { class: 'wo-btnbar' }, [typeSel, nameInp, descInp]),
                        btnbar([
                            btn('Create configuration', () => createConfig(nameInp.value.trim() || 'Unnamed', typeSel.value, descInp.value.trim()), 'primary'),
                            btn('Import configuration', importConfig),
                            btn('Export active', () => exportConfig(configs.activeId)),
                            btn('Restore defaults', () => modal('Restore defaults', 'Reset every setting to the built-in defaults? Configurations are kept.', restoreDefaults, 'Restore'), 'danger'),
                            btn('Reset everything', () => modal('Reset everything', 'Delete all configurations, session data and settings? This cannot be undone.', resetEverything, 'Delete all'), 'danger')
                        ]),
                        el('hr', { class: 'wo-hr' }),
                        row('Automatic saving', (() => {
                            const input = el('input', { type: 'checkbox' }); input.checked = configs.autoSave !== false;
                            input.addEventListener('change', () => { configs.autoSave = input.checked; saveConfigs(); notify('configLoaded', 'Auto-save', input.checked ? 'Enabled' : 'Disabled'); });
                            return el('label', { class: 'wo-switch' }, [input, el('i')]);
                        })(), 'Keep the active full configuration in sync with live setting changes.')
                    ]),
                    card('Saved configurations', 'Click a row to load it. Use the buttons for management.', [
                        configListBlock(),
                        kv(() => 'Active: ' + activeConfigName() + ' (' + (configs.list.find(c => c.id === configs.activeId) || {}).type + ')\nVisual config: ' + (configs.visualId || 'default') + '\nPerformance config: ' + (configs.performanceId || 'default') + '\nTotal: ' + configs.list.length)
                    ]),
                    card('Separate configurations', 'Visual-only and performance-only profiles.', [
                        (() => {
                            const sel = el('select', { class: 'wo-select' });
                            sel.addEventListener('change', () => applyVisualConfig(sel.value));
                            const box = el('div'); box.appendChild(row('Visual configuration', sel, 'Applies only the Visuals and HUD sections.'));
                            (sectionRefresh[id] || (sectionRefresh[id] = [])).push(() => {
                                const opts = configs.list.filter(c => c.type === 'visual' || c.type === 'full').map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('');
                                if (sel.dataset.opts !== opts) { sel.dataset.opts = opts; sel.innerHTML = opts; }
                                sel.value = configs.visualId || 'default';
                            });
                            return box;
                        })(),
                        (() => {
                            const sel = el('select', { class: 'wo-select' });
                            sel.addEventListener('change', () => applyPerformanceConfig(sel.value));
                            (sectionRefresh[id] || (sectionRefresh[id] = [])).push(() => {
                                const opts = configs.list.filter(c => c.type === 'performance' || c.type === 'full').map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('');
                                if (sel.dataset.opts !== opts) { sel.dataset.opts = opts; sel.innerHTML = opts; }
                                sel.value = configs.performanceId || 'default';
                            });
                            return row('Performance configuration', sel, 'Applies only Performance settings and performance modules.');
                        })()
                    ]),
                    moduleCard('configBackup', 'Configuration backup', 'Export every saved setting into one file.', () => [
                        btnbar([
                            btn('Export all settings', exportConfigBackup, 'primary small'),
                            btn('Import all settings', async () => { const f = await pickFile(); if (f) importConfigBackup(safeParse(f.text, null)); }, 'small')
                        ]),
                        kv(() => Object.keys(cfg).sort().map(k => k + ': ' + (isObj(cfg[k]) ? Object.keys(cfg[k]).length + ' keys' : String(cfg[k]))).join('\n'))
                    ])
                ]);
            }
            // ---------------------------------------------------------------- Module Manager
            case 'modules': {
                const search = el('input', { class: 'wo-input', type: 'search', placeholder: 'Filter modules…', style: 'width:100%;max-width:none;margin-bottom:10px;' });
                search.addEventListener('input', () => { R.ui.moduleQuery = search.value.trim(); refreshActiveSection(true); });
                return el('div', {}, [
                    card('Module manager', MODULES.length + ' independent modules. Disabled modules stop their functions and hide their panels.', [
                        search,
                        btnbar([
                            btn('Enable all', () => { for (const m of MODULES) cfg.modules[m.id] = true; saveConfig(); rebuildSections(); notify('configLoaded', 'Modules enabled', 'All modules are active.'); }, 'primary small'),
                            btn('Disable all', () => { for (const m of MODULES) cfg.modules[m.id] = m.id === 'moduleManager'; saveConfig(); rebuildSections(); notify('info', 'Modules disabled', 'All optional modules are off.'); }, 'small'),
                            btn('Reset to defaults', () => { cfg.modules = clone(DEFAULTS.modules); saveConfig(); rebuildSections(); }, 'small')
                        ]),
                        el('div', { class: 'wo-note', text: 'Core systems (probe, audio clock, tracking, menu) always stay active. ' + (moduleOn('moduleManager') ? 'Module Manager itself is always available so disabled modules can be restored.' : 'Module Manager was force-enabled because it is required to restore disabled modules.') })
                    ]),
                    card('Modules', 'Toggle a module and its functionality updates immediately.', [renderModuleList()])
                ]);
            }
            // ---------------------------------------------------------------- Debug Console
            case 'debug': {
                const filter = el('select', { class: 'wo-select', style: 'margin-bottom:8px;' }, [el('option', { value: 'all', text: 'All messages' }), el('option', { value: 'errors', text: 'Errors only' }), el('option', { value: 'page', text: 'WOSU page errors' }), el('option', { value: 'probe', text: 'Probe errors' })]);
                filter.value = R.ui.debugFilter || 'all';
                filter.addEventListener('change', () => { R.ui.debugFilter = filter.value; refreshActiveSection(true); });
                return el('div', {}, [
                    gatedCard('debugConsole', 'Debug console', 'Errors, runtime state and integration status.', [
                        filter,
                        kv(() => {
                            const f = R.ui.debugFilter || 'all';
                            let rows = [];
                            if (f === 'probe') rows = R.probe.errors.map(e => new Date(e.at).toLocaleTimeString() + ' [' + e.label + '] ' + e.message);
                            else if (f === 'page') rows = R.pageErrors.map(e => new Date(e.at).toLocaleTimeString() + ' ' + e.message + (e.source ? ' @ ' + e.source + ':' + e.line : ''));
                            else if (f === 'errors') rows = R.errors.map(e => new Date(e.at).toLocaleTimeString() + ' [' + e.label + '] ' + e.message).concat(R.pageErrors.map(e => new Date(e.at).toLocaleTimeString() + ' [page] ' + e.message));
                            else rows = session.eventLog.slice(-90).reverse().map(e => new Date(e.at).toLocaleTimeString() + ' [' + e.type + '] ' + e.message);
                            return rows.slice(0, 120).join('\n') || 'No messages for this filter.';
                        }),
                        btnbar([
                            btn('Run diagnostics', () => { diagnostics(); refreshActiveSection(true); notify('info', 'Diagnostics', 'Integration checks refreshed.'); }, 'primary small'),
                            btn('Clear console', () => { R.errors = []; R.pageErrors = []; R.probe.errors = []; session.eventLog = []; saveSession(); refreshActiveSection(true); }, 'small danger'),
                            btn('Copy state', () => { const s = JSON.stringify({ version: VERSION, probeMode: R.probeMode, hooks: R.probe.hooks, site: R.site, audio: { ...R.audio, analyser: undefined, wave: undefined, spectrum: undefined }, perf: { ...R.perf, history: undefined }, tracking: R.tracking, integration: R.integration }, null, 2); if (navigator.clipboard) navigator.clipboard.writeText(s).catch(() => {}); notify('info', 'State copied', 'Runtime state copied to clipboard.'); }, 'small'),
                            btn('Export diagnostics', () => download('wosu-diagnostics-' + Date.now() + '.json', JSON.stringify({ checks: diagnostics(), errors: R.errors, pageErrors: R.pageErrors, probeErrors: R.probe.errors, events: session.eventLog.slice(-200) }, null, 2)), 'small')
                        ])
                    ]),
                    moduleCard('integrationDiagnostics', 'Integration diagnostics', 'Identify missing or changed WOSU runtime components.', () => [
                        diagnosticsTable(),
                        kv(() => 'Probe mode: ' + R.probeMode + '\nHooks: ' + Object.keys(R.probe.hooks || {}).map(k => k + '=' + (R.probe.hooks[k] ? 'ok' : 'off')).join(', ') + '\nProbe errors: ' + R.probe.errors.length + '\nWOSU page errors: ' + R.pageErrors.length)
                    ]),
                    card('Runtime state', 'Live snapshot of the values driving every panel.', kv(() => {
                        const a = R.audio;
                        return [
                            'Suite version: ' + VERSION + ' · booted ' + new Date(R.bootAt).toLocaleTimeString(),
                            'Storage: ' + Store.mode + ' · config keys: ' + Store.keys().length,
                            'Probe: ' + R.probeMode + ' · osu ' + R.probe.osuCount + ' · decode ' + R.probe.decodeCount + ' · api ' + R.probe.apiCount,
                            'Site: ' + JSON.stringify({ key: R.site.key, file: R.site.file, mods: R.site.mods, rate: R.site.rate, uiScale: R.site.uiScale, audioOffset: R.site.audioOffset, beatmapOffset: R.site.beatmapOffset, userOffsetMs: R.site.userOffsetMs }),
                            'Library: ' + R.lib.sets.length + ' sets · parsed archives ' + R.lib.parsed.size,
                            'Beatmap: ' + (R.beatmap ? R.beatmap.objects.length + ' objects · ' + R.beatmap.data.metadata.version + ' · source ' + R.beatmapSource : 'none'),
                            'Audio: ' + JSON.stringify({ ctx: a.ctxState, ctxTime: round(a.ctxTime, 3), songTime: round(a.songTime, 1), duration: round(a.duration, 1), rate: a.rate, playing: a.playing, offset: round(a.offsetMs, 1), drift: a.driftMs, active: a.active ? { when: a.active.when, offset: a.active.offset, rate: a.active.rate } : null }),
                            'Perf: ' + JSON.stringify({ fps: round(R.perf.frameRate, 1), frameMs: round(R.perf.frameTime, 2), renderMs: round(R.perf.renderMs, 2), trackingHz: round(R.perf.trackingHz, 1) }),
                            'Tracking: ' + JSON.stringify(R.tracking, (k, v) => k === 'nextObjects' ? undefined : v),
                            'Online: ' + R.online.results.length + ' rows · ' + R.online.count + ' responses'
                        ].join('\n');
                    })),
                    card('Decoded beatmap cache', 'Raw .osu captures from WOSU\'s TextDecoder.',
                        tableWrap(['#', 'Title', 'Version', 'Objects', 'Captured'], () => Array.from(R.beatmaps.values()).map((b, i) => ({ cells: [numberCell(i + 1), esc(b.data.metadata.title), esc(b.data.metadata.version), numberCell(b.data.hitObjects.length), new Date(b.at).toLocaleTimeString()] })), { maxHeight: 200 }))
                ]);
            }
            // ---------------------------------------------------------------- Settings
            case 'settings': {
                const theme = THEMES[cfg.theme] || THEMES.neverlose;
                return el('div', {}, [
                    card('Appearance', 'Theme, accent colors, scaling, opacity and layout.', [
                        selectCtl('theme', 'Theme', 'Premium dark themes.', THEME_KEYS.map(k => ({ value: k, label: THEMES[k].name }))),
                        colorCtl('accent', 'Primary accent', 'Overrides the theme accent.', theme.accent),
                        colorCtl('accent2', 'Secondary accent', 'Overrides the theme secondary color.', theme.accent2),
                        rangeCtl('uiScale', 'UI scaling', 'Scales the whole menu interface.', 0.7, 1.5, 0.05, 'x'),
                        rangeCtl('opacity', 'Window opacity', 'Menu background opacity.', 0.3, 1, 0.02, ''),
                        toggle('compact', 'Compact layout', 'Dense cards and icon-only sidebar.'),
                        toggle('sidebarCollapsed', 'Collapse sidebar', 'Animated sidebar collapse.'),
                        toggle('hideMenu', 'Hide menu', 'Hide the launcher too; use your keybind to restore.'),
                        btnbar([
                            btn('Reset accents', () => { cfg.accent = ''; cfg.accent2 = ''; saveConfig(); applyTheme(true); refreshActiveSection(true); }, 'small'),
                            btn('Center window', () => { cfg.menuRect.centered = false; saveConfig(); applyUiState(); }, 'small'),
                            btn('Cycle theme', cycleTheme, 'small')
                        ])
                    ]),
                    moduleCard('autoTheme', 'Automatic theme switching', 'Switch themes from saved preferences.', () => [
                        toggle('autoTheme.enabled', 'Auto theme', 'Enable automatic switching.'),
                        selectCtl('autoTheme.mode', 'Switch mode', 'How the theme is chosen.', [{ value: 'time', label: 'Time of day' }, { value: 'kiai', label: 'Kiai sections' }, { value: 'random', label: 'Random per check' }]),
                        selectCtl('autoTheme.dayTheme', 'Day theme', 'Theme during daytime.', THEME_KEYS.map(k => ({ value: k, label: THEMES[k].name }))),
                        selectCtl('autoTheme.nightTheme', 'Night theme', 'Theme at night.', THEME_KEYS.map(k => ({ value: k, label: THEMES[k].name }))),
                        numberCtl('autoTheme.dayStart', 'Day starts', 'Hour (0–23).', 0, 23, 1, 'h'),
                        numberCtl('autoTheme.nightStart', 'Night starts', 'Hour (0–23).', 0, 23, 1, 'h'),
                        kv(() => 'Current hour: ' + new Date().getHours() + '\nCurrent theme: ' + (THEMES[cfg.theme] || {}).name + '\nLast check: ' + new Date(R.lastThemeCheck || now()).toLocaleTimeString())
                    ]),
                    moduleCard('shortcutEditor', 'Keyboard shortcut editor', 'Click a key then press any combination to assign it.', () => [
                        keybindRows(),
                        btnbar([btn('Reset keybinds', () => { cfg.keybinds = clone(DEFAULT_KEYBINDS); saveConfig(); refreshActiveSection(true); notify('configLoaded', 'Keybinds reset', 'Default shortcuts restored.'); }, 'small danger')]),
                        el('div', { class: 'wo-note', text: 'Right Shift is the default menu key. Shortcuts only fire on their exact combination and never synthesize gameplay input.' })
                    ]),
                    moduleCard('customNotifications', 'Notification settings', 'Appearance, duration and per-event toggles.', () => [
                        toggle('notify.enabled', 'Enable notifications', 'Master notification switch.'),
                        selectCtl('notify.position', 'Position', 'Screen corner for toasts.', [{ value: 'top-right', label: 'Top right' }, { value: 'top-left', label: 'Top left' }, { value: 'bottom-right', label: 'Bottom right' }, { value: 'bottom-left', label: 'Bottom left' }]),
                        rangeCtl('notify.duration', 'Duration', 'How long toasts stay visible.', 1000, 12000, 250, ' ms'),
                        rangeCtl('notify.max', 'Max visible', 'Maximum stacked toasts.', 1, 12, 1, ''),
                        rangeCtl('notify.radius', 'Corner radius', 'Toast border radius.', 0, 24, 1, ' px'),
                        rangeCtl('notify.blur', 'Backdrop blur', 'Toast blur amount.', 0, 40, 1, ' px'),
                        colorCtl('notify.customColor', 'Accent color', 'Toast accent override.', '#a970ff'),
                        btn('Send test notification', () => notify('info', 'Test notification', 'Custom notifications are working.'), 'small'),
                        el('h3', { text: 'Event types', style: 'margin:12px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;' }),
                        ...NOTIFY_TYPES.map(n => toggle('notify.types.' + n.id, n.name, 'Notify on ' + n.name.toLowerCase() + '.'))
                    ]),
                    card('Data & configuration', 'Persistence through Tampermonkey storage.', [
                        btnbar([
                            btn('Export all settings', exportConfigBackup, 'primary small'),
                            btn('Import all settings', async () => { const f = await pickFile(); if (f) importConfigBackup(safeParse(f.text, null)); }, 'small'),
                            btn('Export statistics', () => exportStats('json'), 'small'),
                            btn('Reset configuration', () => modal('Reset configuration', 'Reset all settings to defaults (configurations and session data are kept)?', restoreDefaults, 'Reset'), 'small danger'),
                            btn('Clear saved data', () => modal('Clear saved data', 'Delete all WOSU Enhancement Suite stored data and reload?', resetEverything, 'Delete'), 'small danger')
                        ]),
                        kv(() => ['Storage backend: ' + Store.mode, 'Active config: ' + activeConfigName(), 'Configurations: ' + configs.list.length, 'Session started: ' + new Date(session.startedAt).toLocaleString(), 'Stored keys: ' + Store.keys().join(', ')].join('\n'))
                    ]),
                    card('About', 'WOSU — Advanced Live Enhancement Suite', [
                        el('div', { class: 'wo-note', html: '<b>Version ' + VERSION + '</b> · Tampermonkey userscript for https://wosu.dino.icu/*<br><br>This suite is read-only: it observes WOSU\'s decoded beatmaps, Web Audio clock, frame loop and IndexedDB library. It does not send input, alter scores, bypass anything or contact any server.<br><br>Integration points are verified against the WOSU source repository (parser, archive, MusicTrack, AudioEngine, PlayerScreen, Settings, idb).' }),
                        btnbar([btn('Open diagnostics', () => setSection('debug'), 'small'), btn('Open module manager', () => setSection('modules'), 'small')])
                    ])
                ]);
            }
            default: return el('div', { class: 'wo-note', text: 'Unknown section.' });
        }
    }

    // =======================================================================
    // 18. Configuration manager, keybinds, module list, diagnostics table
    // =======================================================================
    function configSnapshot(type) {
        if (type === 'visual') return { visuals: clone(cfg.visuals), hud: clone(cfg.hud) };
        if (type === 'performance') return { perf: clone(cfg.perf), modules: Object.fromEntries(['performancePresets', 'densityHeatmap', 'audioWaveform', 'timingDriftGraph', 'liveEventLog', 'debugConsole', 'integrationDiagnostics'].map(k => [k, !!cfg.modules[k]])) };
        return clone(cfg);
    }
    function applyConfigSettings(type, settings) {
        if (type === 'visual') { cfg.visuals = mergeDeep(DEFAULTS.visuals, settings.visuals || {}); cfg.hud = mergeDeep(DEFAULTS.hud, settings.hud || {}); applyHudStyles(); }
        else if (type === 'performance') { cfg.perf = mergeDeep(DEFAULTS.perf, settings.perf || {}); if (settings.modules) for (const k of Object.keys(settings.modules)) cfg.modules[k] = !!settings.modules[k]; }
        else cfg = mergeDeep(DEFAULTS, settings || {});
        saveConfig(); applyTheme(); applyUiState();
    }
    function createConfig(name, type, description) {
        const c = { id: uid(), name, description: description || '', type, createdAt: now(), settings: configSnapshot(type) };
        configs.list.push(c); configs.activeId = c.id;
        if (type === 'visual') configs.visualId = c.id;
        if (type === 'performance') configs.performanceId = c.id;
        saveConfigs(); logEvent('config', 'Configuration created: ' + name + ' (' + type + ')');
        notify('configLoaded', 'Configuration created', name);
        refreshActiveSection(true);
    }
    function loadConfigById(id, quiet) {
        const c = configs.list.find(x => x.id === id); if (!c) return;
        applyConfigSettings(c.type, c.settings);
        configs.activeId = id;
        if (c.type === 'visual') configs.visualId = id;
        if (c.type === 'performance') configs.performanceId = id;
        saveConfigs(); rebuildSections();
        if (!quiet) { logEvent('config', 'Configuration loaded: ' + c.name); notify('configLoaded', 'Configuration loaded', c.name + ' · ' + c.type); }
    }
    function applyVisualConfig(id) {
        const c = configs.list.find(x => x.id === id); if (!c) return;
        applyConfigSettings('visual', c.settings); configs.visualId = id; saveConfigs(); refreshActiveSection(true);
        notify('configLoaded', 'Visual config applied', c.name); logEvent('config', 'Visual configuration applied: ' + c.name);
    }
    function applyPerformanceConfig(id) {
        const c = configs.list.find(x => x.id === id); if (!c) return;
        applyConfigSettings('performance', c.settings); configs.performanceId = id; saveConfigs(); refreshActiveSection(true);
        notify('configLoaded', 'Performance config applied', c.name); logEvent('config', 'Performance configuration applied: ' + c.name);
    }
    function exportConfig(id) {
        const c = configs.list.find(x => x.id === id) || configs.list[0]; if (!c) return;
        download('wosu-config-' + c.name.replace(/[^a-z0-9_-]+/gi, '_') + '.json', JSON.stringify({ kind: 'wosu-enhance-config', version: VERSION, config: c }, null, 2));
        logEvent('export', 'Configuration exported: ' + c.name);
    }
    async function importConfig() {
        const f = await pickFile(); if (!f) return;
        const data = safeParse(f.text, null);
        if (!data || data.kind !== 'wosu-enhance-config' || !isObj(data.config)) { notify('info', 'Invalid config', 'Not a WOSU enhancement configuration file.'); return; }
        const c = data.config;
        if (configs.list.some(x => x.id === c.id)) c.id = uid();
        c.name = (c.name || 'Imported') + ' (imported)'; c.createdAt = now();
        configs.list.push(c); saveConfigs(); refreshActiveSection(true);
        notify('configLoaded', 'Configuration imported', c.name); logEvent('import', 'Configuration imported: ' + c.name);
    }
    function restoreDefaults() {
        cfg = clone(DEFAULTS); cfgSaveNow(); applyTheme(); applyUiState(); applyHudStyles(); rebuildSections();
        notify('configLoaded', 'Defaults restored', 'All settings are back to their defaults.'); logEvent('config', 'Configuration reset to defaults');
    }
    function resetEverything() {
        for (const k of Store.keys()) Store.del(k);
        cfg = clone(DEFAULTS);
        configs = { list: [{ id: 'default', name: 'Default', description: 'Built-in baseline configuration', type: 'full', createdAt: now(), settings: clone(DEFAULTS) }], activeId: 'default', visualId: 'default', performanceId: 'default' };
        session = { startedAt: now(), plays: 0, beatmapsLoaded: 0, notifications: 0, favorites: [], history: [], bookmarks: [], colorPresets: [], eventLog: [], errors: [], stats: { framesObserved: 0, playMs: 0, objectsTracked: 0, maxObjectsOnScreen: 0 } };
        cfgSaveNow(); saveConfigs(); saveSession(); applyTheme(); applyUiState(); rebuildSections();
        notify('configLoaded', 'All data cleared', 'Fresh configuration and session created.'); logEvent('config', 'All stored data cleared');
    }
    function configListBlock() {
        const box = el('div', { class: 'wo-list' });
        box.addEventListener('click', e => {
            const item = e.target.closest('[data-value]'); if (!item) return;
            const id = item.dataset.value, act = e.target.dataset.act;
            const c = configs.list.find(x => x.id === id); if (!c) return;
            if (act === 'load') loadConfigById(id);
            else if (act === 'rename') inputModal('Rename configuration', 'New name:', c.name, name => { c.name = name; saveConfigs(); refreshActiveSection(true); logEvent('config', 'Renamed to ' + name); });
            else if (act === 'desc') inputModal('Configuration description', 'Description for ' + c.name + ':', c.description || '', d => { c.description = d; saveConfigs(); refreshActiveSection(true); });
            else if (act === 'duplicate') { const copy = clone(c); copy.id = uid(); copy.name = c.name + ' (copy)'; copy.createdAt = now(); configs.list.push(copy); saveConfigs(); refreshActiveSection(true); notify('configLoaded', 'Configuration duplicated', copy.name); }
            else if (act === 'export') exportConfig(id);
            else if (act === 'delete') {
                if (configs.list.length <= 1) { notify('info', 'Cannot delete', 'At least one configuration is required.'); return; }
                modal('Delete configuration', 'Delete “' + c.name + '”?', () => {
                    configs.list = configs.list.filter(x => x.id !== id);
                    if (configs.activeId === id) configs.activeId = configs.list[0].id;
                    saveConfigs(); refreshActiveSection(true); notify('configLoaded', 'Configuration deleted', c.name);
                }, 'Delete');
            } else if (act === 'snapshot') {
                c.settings = configSnapshot(c.type); saveConfigs(); refreshActiveSection(true);
                notify('configLoaded', 'Snapshot updated', 'Current settings saved into ' + c.name);
            }
        });
        dyn(box, () => configs.list.map(c => {
            const active = c.id === configs.activeId;
            return '<div class="wo-list-item" data-value="' + esc(c.id) + '"><span class="wo-tag">' + esc(c.type.slice(0, 4).toUpperCase()) + (active ? ' · ACTIVE' : '') + '</span><div class="wo-grow"><b>' + esc(c.name) + '</b> <span class="wo-muted">· ' + esc(c.description || 'no description') + ' · ' + new Date(c.createdAt).toLocaleDateString() + '</span></div>' +
                '<button class="wo-btn small" data-act="load">Load</button><button class="wo-btn small" data-act="snapshot">Save current</button><button class="wo-btn small" data-act="rename">Rename</button><button class="wo-btn small" data-act="desc">Desc</button><button class="wo-btn small" data-act="duplicate">Copy</button><button class="wo-btn small" data-act="export">Export</button><button class="wo-btn small danger" data-act="delete">✕</button></div>';
        }).join(''));
        return box;
    }
    function renderModuleList() {
        const box = el('div', { class: 'wo-list' });
        box.addEventListener('change', e => {
            const inp = e.target.closest('input[data-mod]'); if (!inp) return;
            const id = inp.dataset.mod;
            cfg.modules[id] = id === 'moduleManager' ? true : inp.checked;
            if (id === 'moduleManager' && !inp.checked) inp.checked = true; // always available
            saveConfig(); logEvent('module', (cfg.modules[id] ? 'Enabled' : 'Disabled') + ' module ' + id);
            rebuildSections();
        });
        box.addEventListener('click', e => {
            const b = e.target.closest('button[data-open]'); if (!b) return;
            setSection(b.dataset.open);
        });
        const moduleSection = {
            beatmapTimeline: 'timeline', bpmGraph: 'timeline', timingInspector: 'timeline', objectInspector: 'inspector',
            sliderInspector: 'inspector', spinnerInspector: 'inspector', difficultyComparison: 'analyzer', sessionStats: 'session',
            playbackHistory: 'history', favoriteBeatmaps: 'history', beatmapSearch: 'inspector', customCrosshair: 'visuals',
            colorPresets: 'visuals', hudProfiles: 'hud', densityHeatmap: 'analyzer', audioWaveform: 'audio', timingDriftGraph: 'audio',
            liveEventLog: 'session', debugConsole: 'debug', moduleManager: 'modules', customNotifications: 'settings',
            shortcutEditor: 'settings', compactMode: 'session', statsExport: 'session', autoTheme: 'settings',
            objectPreview: 'timeline', sectionBookmarks: 'session', configBackup: 'configs', integrationDiagnostics: 'debug', performancePresets: 'performance'
        };
        dyn(box, () => {
            const q = (R.ui.moduleQuery || '').toLowerCase();
            const groups = {};
            for (const m of MODULES) {
                if (q && (m.name + ' ' + m.desc + ' ' + m.group).toLowerCase().indexOf(q) === -1) continue;
                (groups[m.group] || (groups[m.group] = [])).push(m);
            }
            let html = '';
            for (const g of Object.keys(groups).sort()) {
                html += '<div class="wo-note" style="margin:8px 0 3px;letter-spacing:.12em;text-transform:uppercase;">' + esc(g) + '</div>';
                for (const m of groups[g]) {
                    const on = m.id === 'moduleManager' || moduleOn(m.id);
                    html += '<div class="wo-list-item" data-value="' + m.id + '"><span class="wo-tag">' + (on ? 'ON' : 'OFF') + '</span><div class="wo-grow"><b>' + esc(m.name) + '</b><br><span class="wo-muted">' + esc(m.desc) + '</span></div><label class="wo-switch"><input type="checkbox" data-mod="' + m.id + '"' + (on ? ' checked' : '') + '><i></i></label><button class="wo-btn small" data-open="' + (moduleSection[m.id] || 'dashboard') + '">Open</button></div>';
                }
            }
            return html || '<div class="wo-note">No modules match “' + esc(q) + '”.</div>';
        });
        return box;
    }
    function diagnosticsTable() {
        return tableWrap(['Component', 'Status', 'Detail'], () => diagnostics().map(c => ({ cells: [esc(c.name), pill(c.status.toUpperCase(), c.status === 'ok' ? 'ok' : c.status === 'bad' ? 'bad' : 'warn'), esc(c.detail)] })), { maxHeight: 280 });
    }
    function comboFromEvent(e) {
        const code = e.code || e.key || '';
        if (!code) return null;
        // A modifier key pressed on its own is a valid shortcut (Right Shift by
        // default). Its own modifier flag must not be added twice.
        const parts = [];
        if (e.ctrlKey && code !== 'ControlLeft' && code !== 'ControlRight') parts.push('Ctrl');
        if (e.altKey && code !== 'AltLeft' && code !== 'AltRight') parts.push('Alt');
        if (e.shiftKey && code !== 'ShiftLeft' && code !== 'ShiftRight') parts.push('Shift');
        if (e.metaKey && code !== 'MetaLeft' && code !== 'MetaRight') parts.push('Meta');
        parts.push(code);
        return parts.join('+');
    }
    function keybindRows() {
        const box = el('div', { class: 'wo-list' });
        box.addEventListener('click', e => {
            const b = e.target.closest('button[data-bind]'); if (!b) return;
            R.captureAction = b.dataset.bind; b.textContent = 'Press keys…'; b.classList.add('active');
            notify('info', 'Recording shortcut', 'Press the new key combination (Escape cancels).');
        });
        dyn(box, () => BIND_ACTIONS.map(a => {
            const combo = cfg.keybinds[a.id] || '—';
            const conflict = Object.keys(cfg.keybinds).filter(k => k !== a.id && cfg.keybinds[k] === combo);
            return '<div class="wo-list-item"><span class="wo-tag">KEY</span><div class="wo-grow">' + esc(a.name) + (conflict.length ? ' <span class="wo-muted">· conflicts with ' + esc(conflict.join(', ')) + '</span>' : '') + '</div><button class="wo-capture" data-bind="' + a.id + '">' + esc(R.captureAction === a.id ? 'Press keys…' : combo) + '</button></div>';
        }).join(''));
        return box;
    }
    function cycleTheme() {
        const i = THEME_KEYS.indexOf(cfg.theme);
        cfg.theme = THEME_KEYS[(i + 1) % THEME_KEYS.length];
        saveConfig(); applyTheme(); refreshActiveSection(true);
        notify('configLoaded', 'Theme', THEMES[cfg.theme].name);
    }
    function runAction(action) {
        switch (action) {
            case 'menu': setMenuOpen(!cfg.menuOpen); break;
            case 'toggleHud': cfg.hud.enabled = !cfg.hud.enabled; saveConfig(); applyUiState(); refreshActiveSection(true); break;
            case 'toggleVisuals': onConfigChange('visuals.enabled', !cfg.visuals.enabled); break;
            case 'cyclePreset': { const keys = Object.keys(PERF_PRESETS), i = keys.indexOf(cfg.perf.preset); applyPerfPreset(keys[(i + 1) % keys.length]); break; }
            case 'compact': cfg.compact = !cfg.compact; saveConfig(); applyUiState(); refreshActiveSection(true); break;
            case 'nextSection': { const i = SECTIONS.findIndex(s => s.id === cfg.activeSection); setSection(SECTIONS[(i + 1) % SECTIONS.length].id); break; }
            case 'prevSection': { const i = SECTIONS.findIndex(s => s.id === cfg.activeSection); setSection(SECTIONS[(i - 1 + SECTIONS.length) % SECTIONS.length].id); break; }
            case 'bookmark': addBookmark(); break;
            case 'favorite': toggleFavorite(); break;
            case 'exportStats': exportStats('json'); break;
            case 'cycleTheme': cycleTheme(); break;
            case 'toggleLightweight': onConfigChange('perf.lightweight', !cfg.perf.lightweight); break;
            case 'toggleCrosshair': onConfigChange('visuals.crosshair.enabled', !cfg.visuals.crosshair.enabled); break;
            case 'openDebug': setMenuOpen(true); setSection('debug'); break;
            case 'resetHud': resetHudPositions(); break;
            case 'openSearch': { setMenuOpen(true); const s = $('#wo-search-input'); if (s) { s.focus(); s.select(); } break; }
        }
    }

    // =======================================================================
    // 19. Refresh pipeline, main loops and lifecycle
    // =======================================================================
    let lastUiRefresh = 0, lastSessionSave = 0, lastTrackingWindow = 0, trackingCount = 0;
    function refreshControlState() {
        const list = R.controlBindings || [];
        for (let i = list.length - 1; i >= 0; i--) {
            const b = list[i];
            const target = b.input || b.select || b.color || b.number || b.text || b.checkbox;
            if (!target || !target.isConnected) { if (target && !target.isConnected) list.splice(i, 1); continue; }
            const v = getPath(cfg, b.path);
            try {
                if (b.checkbox) { b.checkbox.checked = !!v; }
                else if (b.select) { if (document.activeElement !== b.select) b.select.value = String(v ?? ''); }
                else if (b.color) { if (document.activeElement !== b.color) b.color.value = /^#[0-9a-f]{6}$/i.test(String(v)) ? v : (b.fallback || '#a970ff'); }
                else if (b.number || b.text || b.input) {
                    if (document.activeElement !== target) target.value = String(v ?? '');
                    if (b.out) b.out.textContent = (Number(v) || 0) + (b.unit || '');
                }
            } catch (e) { /* ignore detached controls */ }
        }
    }
    function refreshActiveSection(force) {
        if (!R.ui.built) return;
        const t = now();
        if (!force && t - lastUiRefresh < clamp(finite(cfg.perf.updateIntervalMs, 100), 33, 2000)) return;
        lastUiRefresh = t;
        const sec = cfg.activeSection;
        for (const b of (liveBindings[sec] || [])) {
            if (!b.el || !b.el.isConnected) continue;
            let v;
            try { v = b.get(); } catch (e) { v = '—'; }
            const txt = b.fmt ? b.fmt(v) : (v === null || v === undefined ? '' : String(v));
            if (b.el.tagName === 'I' && b.el.parentElement && b.el.parentElement.classList.contains('wo-bar')) {
                if (b.el.style.width !== txt) b.el.style.width = txt;
            } else if (b.el.textContent !== txt) b.el.textContent = txt;
        }
        refreshControlState();
        for (const fn of (sectionRefresh[sec] || [])) { try { fn(); } catch (e) { logError('sectionRefresh:' + sec, e); } }
        updateStatus();
        if (sec === 'session') {
            const slot = $('#wo-event-log-slot');
            if (slot && R.ui.logListBox && !slot.contains(R.ui.logListBox)) slot.appendChild(R.ui.logListBox);
            const f = $('#wo-event-log-slot select');
            if (f && R.ui.logFilter && f.value !== R.ui.logFilter) f.value = R.ui.logFilter;
        }
    }
    function updateStatus() {
        const dot = R.ui.statusDot, txt = R.ui.statusText;
        if (!dot || !txt) return;
        const live = R.audio.playing && R.beatmap;
        dot.classList.toggle('off', !live);
        txt.textContent = live ? 'LIVE · ' + Math.round(R.perf.frameRate) + ' FPS' : R.beatmap ? 'READY · ' + R.beatmap.objects.length + ' OBJ' : 'WAITING FOR BEATMAP';
    }
    function updateHudLoop() { updateHud(); }

    let lastOwnFrame = 0, ownFrames = 0, ownWindowAt = 0;
    function frameLoop(ts) {
        R.rafId = requestAnimationFrame(frameLoop);
        if (!lastOwnFrame) { lastOwnFrame = ts; ownWindowAt = ts; }
        R.perf.ownFrameMs = ts - lastOwnFrame; lastOwnFrame = ts;
        ownFrames++;
        if (ts - ownWindowAt >= 500) { R.perf.ownFps = ownFrames * 1000 / (ts - ownWindowAt); ownFrames = 0; ownWindowAt = ts; }
        if (document.hidden) return;
        const interval = clamp(finite(cfg.perf.canvasIntervalMs, 16), 8, 1000);
        if (cfg.visuals.enabled && ts - R.visual.lastDraw >= interval) {
            R.visual.lastDraw = ts;
            try { drawVisuals(); } catch (e) { logError('drawVisuals', e); }
            trackingCount++;
        }
    }
    function tick() {
        const t = now();
        if (t - R.lastSettingsPoll > 900) { R.lastSettingsPoll = t; try { readSiteSettings(); } catch (e) { logError('readSiteSettings', e); } }
        if (t - R.lastLibPoll > 5000) { R.lastLibPoll = t; void loadLibrary().catch(e => logError('loadLibrary', e)); }
        if (t - R.lastThemeCheck > 45000) { R.lastThemeCheck = t; autoThemeTick(); }
        if (t - lastTrackingWindow >= 1000) {
            R.perf.trackingHz = trackingCount * 1000 / Math.max(1, t - lastTrackingWindow);
            trackingCount = 0; lastTrackingWindow = t;
        }
        if (t - lastUiRefresh >= clamp(finite(cfg.perf.updateIntervalMs, 100), 33, 2000)) {
            try { refreshActiveSection(false); updateHudLoop(); drawGraphs(); } catch (e) { logError('ui tick', e); }
        }
        if (t - lastSessionSave > 20000) { lastSessionSave = t; saveSession(); }
    }

    function onKeyDown(e) {
        if (R.captureAction) {
            e.preventDefault(); e.stopPropagation();
            if (e.key === 'Escape') { R.captureAction = null; refreshActiveSection(true); return; }
            const combo = comboFromEvent(e);
            if (combo) {
                const conflict = Object.keys(cfg.keybinds).find(k => k !== R.captureAction && cfg.keybinds[k] === combo);
                cfg.keybinds[R.captureAction] = combo;
                R.captureAction = null; saveConfig(); refreshActiveSection(true);
                notify('configLoaded', 'Shortcut assigned', combo + (conflict ? ' (conflicts with ' + conflict + ')' : ''));
                logEvent('keybind', 'Assigned ' + combo);
            }
            return;
        }
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) && (target.closest('#wo-root') || target.closest('#wo-hud'))) return;
        const combo = comboFromEvent(e);
        if (!combo) return;
        const action = Object.keys(cfg.keybinds).find(k => cfg.keybinds[k] === combo);
        if (action) {
            e.preventDefault(); e.stopPropagation();
            try { runAction(action); } catch (err) { logError('runAction:' + action, err); }
        }
    }
    function bindGlobalEvents() {
        if (R.globalEventsBound) return;
        R.globalEventsBound = true;
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('pointermove', onMenuDragMove);
        window.addEventListener('pointerup', onMenuDragEnd);
        window.addEventListener('pointermove', onHudPointerMove);
        window.addEventListener('pointerup', onHudPointerUp);
        window.addEventListener('resize', () => { R.visual.transform = null; applyUiState(); }, { passive: true });
        window.addEventListener('visibilitychange', () => { if (!document.hidden) { R.visual.transform = null; resizeOverlay(); refreshActiveSection(true); } });
        window.addEventListener('beforeunload', persistAll);
        window.addEventListener('pagehide', persistAll);
        window.addEventListener('popstate', () => { R.visual.transform = null; logEvent('navigation', 'History navigation'); });
        window.addEventListener('hashchange', () => logEvent('navigation', 'Hash changed'));
        document.addEventListener('fullscreenchange', () => { R.visual.transform = null; resizeOverlay(); });
        try {
            const mo = new MutationObserver(() => {
                const canvas = $('#app canvas');
                if (canvas && !R.wosuCanvasSeen) { R.wosuCanvasSeen = true; R.visual.transform = null; resizeOverlay(); logEvent('game', 'WOSU Pixi canvas detected'); notify('trackingInit', 'WOSU detected', 'Game renderer is ready.'); }
            });
            mo.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) { logError('MutationObserver', e); }
    }
    function persistAll() { cfgSaveNow(); saveConfigs(); saveSession(); }
    function registerCommands() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        try {
            GM_registerMenuCommand('Toggle WOSU Enhancement Suite', () => setMenuOpen(!cfg.menuOpen));
            GM_registerMenuCommand('Open Dashboard', () => { setMenuOpen(true); setSection('dashboard'); });
            GM_registerMenuCommand('Open Debug Console / Diagnostics', () => { setMenuOpen(true); setSection('debug'); });
            GM_registerMenuCommand('Export Statistics', () => exportStats('json'));
            GM_registerMenuCommand('Export Configuration Backup', exportConfigBackup);
        } catch (e) { logError('GM_registerMenuCommand', e); }
    }

    function startDom() {
        if (R.domStarted) return;
        R.domStarted = true;
        R.controlBindings = R.controlBindings || [];
        R.searchIndex = R.searchIndex || [];
        R.timelinePanMs = 0; R.pointer = null; R.timelineHover = null; R.timelineDrag = null;
        injectCSS();
        applyTheme();
        initVisualLayer();
        buildMenu();
        bindGlobalEvents();
        registerCommands();
        R.tickTimer = setInterval(tick, 200);
        R.rafId = requestAnimationFrame(frameLoop);
        void loadLibrary();
        diagnostics();
        notify('trackingInit', 'Enhancement suite active', 'Right Shift opens the menu · live runtime hooks attached.');
        logEvent('boot', 'WOSU Enhancement Suite v' + VERSION + ' initialized (' + R.probeMode + ')');
        saveSession();
    }

    /** Remove our DOM, timers and probe state. WOSU itself is untouched. */
    function destroy() {
        try {
            const probe = (typeof unsafeWindow !== 'undefined' && unsafeWindow.__WO_PROBE__) || window.__WO_PROBE__;
            if (probe && probe.stateTimer) clearInterval(probe.stateTimer);
        } catch { /* ignore */ }
        if (R.tickTimer) clearInterval(R.tickTimer);
        if (R.rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(R.rafId);
        try { persistAll(); } catch { /* ignore */ }
        for (const id of ['wo-root', 'wo-launcher', 'wo-visual', 'wo-hud', 'wo-toasts', 'wo-style']) {
            const n = document.getElementById(id); if (n && n.parentNode) n.parentNode.removeChild(n);
        }
        for (const wrap of document.querySelectorAll('.wo-modal-wrap')) wrap.remove();
        for (const k of Object.keys(liveBindings)) delete liveBindings[k];
        for (const k of Object.keys(sectionRefresh)) delete sectionRefresh[k];
        graphRegistry.length = 0;
        R.ui.built = false; R.ui.menu = null; R.ui.launcher = null; R.ui.sections = {};
        R.domStarted = false; R.globalEventsBound = false;
        try { delete window.__WOSU_ENHANCE_SUITE__; } catch { window.__WOSU_ENHANCE_SUITE__ = undefined; }
    }

    // ---- expose a small read-only API for diagnostics / tests ----
    window.__WOSU_ENHANCE_SUITE__ = {
        version: VERSION,
        get config() { return cfg; },
        get state() { return R; },
        get configs() { return configs; },
        get session() { return session; },
        api: { parseOsu, buildPlayable, createSliderPath, buildControlPoints, difficultyAttributes, computeAnalysis, diagnostics, refresh: () => refreshActiveSection(true), exportStats, loadSelectedBeatmap, loadLibrary, onProbe, installProbe, destroy },
        utils: { fmtTime, fmtTimePrecise, clamp, mergeDeep, hashString }
    };

    // =======================================================================
    // 20. Boot — hooks first (document-start), DOM as soon as it exists
    // =======================================================================
    initProbe();
    try { readSiteSettings(); } catch (e) { logError('initial settings', e); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startDom, { once: true });
    else startDom();
    setTimeout(() => { if (!R.domStarted) startDom(); }, 2500);
})();
