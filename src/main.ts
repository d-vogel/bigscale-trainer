import * as Tone from "tone";
import { Accidental, Formatter, Renderer, Stave, StaveNote, Voice } from "vexflow";
import "./style.css";
import {
  buildChordTones,
  buildScale,
  InstrumentMode,
  noteFromIndex,
  noteToIndex,
  parseChordSymbol,
  splitProgression,
  transposeChordSymbol,
  transposeSemitones
} from "./theory";

interface Preset {
  id: string;
  name: string;
  author?: string;
  email?: string;
  progression: string;
  bpm: number;
  playChords: boolean;
  loop: boolean;
  metronome: boolean;
  instrument: InstrumentMode;
  notesPerBar?: number;
  lowerMidi?: number;
  upperMidi?: number;
  intervalPractice?: IntervalPractice;
}

interface InstrumentPreset {
  name: string;
  key: InstrumentMode;
  lowerMidi: number;
  upperMidi: number;
}

type IntervalPractice = "seconds" | "thirds" | "fourths" | "fifths" | "sixths" | "sevenths" | "octaves";

const INTERVAL_STEPS: Record<IntervalPractice, number> = {
  seconds: 1,
  thirds: 2,
  fourths: 3,
  fifths: 4,
  sixths: 5,
  sevenths: 6,
  octaves: 7
};

interface AppState {
  progressionText: string;
  bpm: number;
  playChords: boolean;
  loop: boolean;
  metronome: boolean;
  instrument: InstrumentMode;
  currentBar: number;
  currentNoteStep: number;
  isPlaying: boolean;
  lastMidiInLoop: number | null;
  lastDirectionInLoop: 1 | -1;
  notesPerBar: number;
  lowerMidi: number;
  upperMidi: number;
  intervalPractice: IntervalPractice;
}

interface DisplayBar {
  index: number;
  originalChord: string;
  chord: string;
  scaleName: string;
  notes: string[];
  valid: boolean;
  lineNotes: LineNote[];
}

interface LineNote {
  midi: number;
  label: string;
}

const STORAGE_KEY = "bigscale.presets.v1";
const INSTRUMENT_PRESETS_KEY = "bigscale.instrument-presets.v1";
const MIN_NOTES_PER_BAR = 2;
const MAX_NOTES_PER_BAR = 8;
const MIN_LIMIT_MIDI = 48; // C3
const MAX_LIMIT_MIDI = 96; // C7

const AUTUMN_LEAVES = "Am7 | D7 | Gmaj7 | Cmaj7 | F#ø7 | B7 | Em7";

const state: AppState = {
  progressionText: "Cmaj7 | Dm7 | G7 | Cmaj7",
  bpm: 100,
  playChords: true,
  loop: true,
  metronome: false,
  instrument: "concert",
  currentBar: 0,
  currentNoteStep: 0,
  isPlaying: false,
  lastMidiInLoop: null,
  lastDirectionInLoop: 1,
  notesPerBar: 4,
  lowerMidi: 60,
  upperMidi: 84,
  intervalPractice: "seconds"
};

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("App root not found");
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return el;
}

root.innerHTML = `
  <main class="app-shell">
    <header class="top">
      <h1>Big Scale Trainer</h1>
      <p>Practice scales bar-by-bar over looping harmony.</p>
    </header>

    <details class="panel instrument-panel" id="instrument-panel">
      <summary class="instrument-panel-summary">
        <span>Instrument</span>
        <span id="instrument-panel-subtitle" class="instrument-panel-subtitle"></span>
      </summary>

      <div class="instrument-panel-body">
        <div class="grid controls-grid">
          <label>
            Transposition key
            <select id="instrument">
              <option value="concert">Concert (C)</option>
              <option value="bb">Bb instrument</option>
              <option value="eb">Eb instrument</option>
            </select>
          </label>
        </div>

        <div class="pitch-limits-panel" aria-label="Pitch range controls">
          <span class="limit-title">Pitch range</span>
          <div class="range-layout">
            <div class="side-adjuster" aria-label="Low note adjustments">
              <button id="lower-up" type="button" class="arrow-btn" aria-label="Raise low note">▲</button>
              <span id="lower-label" class="limit-label"></span>
              <button id="lower-down" type="button" class="arrow-btn" aria-label="Lower low note">▼</button>
            </div>
            <div id="range-staff" class="mini-staff" aria-hidden="true"></div>
            <div class="side-adjuster" aria-label="High note adjustments">
              <button id="upper-up" type="button" class="arrow-btn" aria-label="Raise high note">▲</button>
              <span id="upper-label" class="limit-label"></span>
              <button id="upper-down" type="button" class="arrow-btn" aria-label="Lower high note">▼</button>
            </div>
          </div>
        </div>

        <div class="instrument-presets-row">
          <select id="instrument-preset-select"></select>
          <button id="load-instrument-preset">Apply</button>
        </div>
      </div>
    </details>

    <details class="panel instrument-panel" id="song-preset-panel">
      <summary class="instrument-panel-summary">
        <span>Song</span>
        <span id="song-preset-subtitle" class="instrument-panel-subtitle"></span>
      </summary>
      <div class="instrument-panel-body">
        <label for="progression">Chord progression (one chord per bar, separated by |)</label>
        <textarea id="progression" rows="3"></textarea>

        <div class="grid controls-grid">
          <label>
            BPM
            <input id="bpm" type="number" min="40" max="300" step="1" />
          </label>

          <label>
            Notes per bar
            <input id="notes-per-bar" type="number" min="2" max="8" step="1" />
          </label>

          <label>
            Interval practice
            <select id="interval-practice">
              <option value="seconds">2nds (stepwise)</option>
              <option value="thirds">3rds</option>
              <option value="fourths">4ths</option>
              <option value="fifths">5ths</option>
              <option value="sixths">6ths</option>
              <option value="sevenths">7ths</option>
              <option value="octaves">Octaves</option>
            </select>
          </label>
        </div>

        <div class="grid toggles-grid">
          <label><input id="toggle-play-chords" type="checkbox" /> Play chords</label>
          <label><input id="toggle-loop" type="checkbox" /> Loop</label>
          <label><input id="toggle-metronome" type="checkbox" /> Metronome</label>
        </div>

        <div class="instrument-presets-row">
          <select id="preset-select"></select>
          <button id="load-preset">Apply</button>
          <button id="download-preset">Download</button>
        </div>
        <div class="instrument-presets-row">
          <input id="preset-name" type="text" placeholder="Save current as…" />
          <button id="save-preset">Save</button>
        </div>
      </div>
    </details>

    <section class="panel sheet-panel">
      <div class="sheet-header">
        <h2>Practice Sheet</h2>
        <div class="row buttons-row">
          <button id="play-pause" class="accent">Play</button>
          <button id="reset">Reset</button>
          <button id="export-midi">Export MIDI</button>
        </div>
      </div>
      <div id="scrolling-sheet" class="scrolling-sheet"></div>
    </section>
  </main>
`;

const progressionEl = requiredElement<HTMLTextAreaElement>("#progression");
const bpmEl = requiredElement<HTMLInputElement>("#bpm");
const instrumentEl = requiredElement<HTMLSelectElement>("#instrument");
const notesPerBarEl = requiredElement<HTMLInputElement>("#notes-per-bar");
const intervalPracticeEl = requiredElement<HTMLSelectElement>("#interval-practice");
const playChordsEl = requiredElement<HTMLInputElement>("#toggle-play-chords");
const loopEl = requiredElement<HTMLInputElement>("#toggle-loop");
const metronomeEl = requiredElement<HTMLInputElement>("#toggle-metronome");
const lowerDownEl = requiredElement<HTMLButtonElement>("#lower-down");
const lowerUpEl = requiredElement<HTMLButtonElement>("#lower-up");
const upperDownEl = requiredElement<HTMLButtonElement>("#upper-down");
const upperUpEl = requiredElement<HTMLButtonElement>("#upper-up");
const rangeStaffEl = requiredElement<HTMLDivElement>("#range-staff");
const lowerLabelEl = requiredElement<HTMLSpanElement>("#lower-label");
const upperLabelEl = requiredElement<HTMLSpanElement>("#upper-label");

const playPauseEl = requiredElement<HTMLButtonElement>("#play-pause");
const resetEl = requiredElement<HTMLButtonElement>("#reset");
const exportMidiEl = requiredElement<HTMLButtonElement>("#export-midi");

const scrollingSheetEl = requiredElement<HTMLDivElement>("#scrolling-sheet");

const presetNameEl = requiredElement<HTMLInputElement>("#preset-name");
const savePresetEl = requiredElement<HTMLButtonElement>("#save-preset");
const presetSelectEl = requiredElement<HTMLSelectElement>("#preset-select");
const loadPresetEl = requiredElement<HTMLButtonElement>("#load-preset");
const downloadPresetEl = requiredElement<HTMLButtonElement>("#download-preset");
const songPresetSubtitleEl = requiredElement<HTMLSpanElement>("#song-preset-subtitle");

const instrumentPresetSelectEl = requiredElement<HTMLSelectElement>("#instrument-preset-select");
const loadInstrumentPresetEl = requiredElement<HTMLButtonElement>("#load-instrument-preset");
const instrumentPanelSubtitleEl = requiredElement<HTMLSpanElement>("#instrument-panel-subtitle");

let loopTimer: number | null = null;
let polySynth: Tone.PolySynth | null = null;
let clickSynth: Tone.MembraneSynth | null = null;
let generatedBarsCache: DisplayBar[] = [];
let generatedCacheKey = "";
let nextCycleSeedMidi: number | null = null;
let nextCycleSeedDirection: 1 | -1 = 1;

function clampNotesPerBar(value: number): number {
  return Math.max(MIN_NOTES_PER_BAR, Math.min(MAX_NOTES_PER_BAR, value));
}

function midiLabel(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${noteFromIndex(mod12(midi), false)}${octave}`;
}

function buildRangeNote(midi: number, color: string): StaveNote {
  const vex = midiToVexKey(midi, noteFromIndex(mod12(midi), false));
  const note = new StaveNote({ keys: [vex.key], duration: "q" });
  if (vex.accidental) {
    note.addModifier(new Accidental(vex.accidental), 0);
  }
  note.setStyle({
    fillStyle: color,
    strokeStyle: color
  });
  return note;
}

function renderPitchStaff(staffEl: HTMLDivElement, lowMidi: number, highMidi: number): void {
  staffEl.innerHTML = "";

  const width = 260;
  const height = 170;
  const renderer = new Renderer(staffEl, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const context = renderer.getContext();
  const stave = new Stave(16, 56, width - 32);
  stave.setContext(context).draw();

  const lowNote = buildRangeNote(lowMidi, "#2d6a6a");
  const highNote = buildRangeNote(highMidi, "#bb5a2a");
  Formatter.FormatAndDraw(context, stave, [lowNote, highNote]);

  // Recalculate viewport after each change so extreme notes stay visible.
  const svg = staffEl.querySelector("svg");
  if (!svg) {
    return;
  }

  const graphics = Array.from(svg.querySelectorAll("g, path, line, rect, ellipse, circle, text, polygon, polyline"));
  if (graphics.length === 0) {
    return;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of graphics) {
    try {
      const box = (node as SVGGraphicsElement).getBBox();
      if (box.width === 0 && box.height === 0) {
        continue;
      }
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    } catch {
      // Ignore elements that cannot provide a bbox.
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return;
  }

  const padX = 18;
  const padY = 28;
  const viewBoxX = minX - padX;
  const viewBoxY = minY - padY;
  const viewBoxW = maxX - minX + padX * 2;
  const viewBoxH = maxY - minY + padY * 2;
  svg.setAttribute("viewBox", `${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
}

function resetGenerationState(): void {
  generatedBarsCache = [];
  generatedCacheKey = "";
  nextCycleSeedMidi = null;
  nextCycleSeedDirection = 1;
}

function applyPitchLimits(low: number, high: number): void {
  state.lowerMidi = Math.max(MIN_LIMIT_MIDI, Math.min(low, MAX_LIMIT_MIDI - 1));
  state.upperMidi = Math.min(MAX_LIMIT_MIDI, Math.max(high, MIN_LIMIT_MIDI + 1));
  if (state.lowerMidi >= state.upperMidi) {
    state.upperMidi = Math.min(MAX_LIMIT_MIDI, state.lowerMidi + 1);
  }
  state.currentNoteStep = 0;
  state.lastMidiInLoop = null;
  state.lastDirectionInLoop = 1;
  resetGenerationState();
}

function getBars(): string[] {
  return splitProgression(state.progressionText);
}

function getDisplayBarsBase(): DisplayBar[] {
  const bars = getBars();
  const semitones = transposeSemitones(state.instrument);

  const displayBars: DisplayBar[] = bars.map((bar, idx) => {
    const parsed = parseChordSymbol(bar);
    if (!parsed) {
      return {
        index: idx,
        originalChord: bar,
        chord: bar,
        scaleName: "Unknown",
        notes: [] as string[],
        valid: false,
        lineNotes: []
      };
    }

    const preferFlats = parsed.root.includes("b");
    const notes = buildScale(parsed.root, parsed.scaleIntervals, semitones, preferFlats);
    const chord = transposeChordSymbol(bar, semitones);

    return {
      index: idx,
      originalChord: bar,
      chord,
      scaleName: parsed.scaleMode,
      notes,
      valid: true,
      lineNotes: []
    };
  });

  return displayBars;
}

function getGenerationCacheKey(): string {
  return [
    state.progressionText,
    state.instrument,
    state.notesPerBar,
    state.lowerMidi,
    state.upperMidi,
    state.intervalPractice
  ].join("|");
}

function regenerateBars(seedMidi: number | null, seedDirection: 1 | -1): void {
  const baseBars = getDisplayBarsBase();
  const result = applyContinuousLine(baseBars, seedMidi, seedDirection);
  generatedBarsCache = baseBars;
  generatedCacheKey = getGenerationCacheKey();
  nextCycleSeedMidi = result.lastMidi;
  nextCycleSeedDirection = result.lastDirection;
}

function getDisplayBars(): DisplayBar[] {
  const key = getGenerationCacheKey();
  if (generatedBarsCache.length === 0 || generatedCacheKey !== key) {
    regenerateBars(null, 1);
  }
  return generatedBarsCache;
}

function applyContinuousLine(
  bars: DisplayBar[],
  seedMidi: number | null,
  seedDirection: 1 | -1
): { lastMidi: number | null; lastDirection: 1 | -1 } {
  const firstValid = bars.find((bar) => bar.valid && bar.notes.length > 0);
  if (!firstValid) {
    return { lastMidi: null, lastDirection: seedDirection };
  }

  const lowerBound = state.lowerMidi;
  const upperBound = state.upperMidi;
  const intervalStep = INTERVAL_STEPS[state.intervalPractice];
  const useProvidedSeed = seedMidi !== null;
  let emitSeedAsFirstNote = !useProvidedSeed;
  let direction: 1 | -1 = seedDirection;
  let currentMidi: number;

  // Continue from provided seed when available; otherwise start on tonic of first bar.
  if (useProvidedSeed) {
    currentMidi = seedMidi as number;
  } else {
    const tonicPc = noteToIndex(firstValid.notes[0]);
    if (tonicPc === null) {
      return { lastMidi: null, lastDirection: direction };
    }
    currentMidi = findTonicStartMidi(tonicPc, lowerBound, upperBound);
  }

  let lastMidi = currentMidi;

  for (const bar of bars) {
    bar.lineNotes = [];
    if (!bar.valid || bar.notes.length === 0) {
      continue;
    }

    const pcs = bar.notes
      .map((note) => noteToIndex(note))
      .filter((pc): pc is number => pc !== null);

    if (pcs.length === 0) {
      continue;
    }

    const scaleMidis = buildScaleMidisInRange(pcs, lowerBound, upperBound);
    if (scaleMidis.length === 0) {
      continue;
    }

    for (let i = 0; i < state.notesPerBar; i += 1) {
      if (emitSeedAsFirstNote) {
        emitSeedAsFirstNote = false;
        bar.lineNotes.push({
          midi: currentMidi,
          label: noteFromIndex(currentMidi % 12, bar.chord.includes("b"))
        });
        lastMidi = currentMidi;
        continue;
      }

      let candidate = findNextMidiByInterval(currentMidi, scaleMidis, intervalStep, direction);
      if (candidate === currentMidi && scaleMidis.length > 1) {
        direction = direction === 1 ? -1 : 1;
        candidate = findNextMidiByInterval(currentMidi, scaleMidis, intervalStep, direction);
      }
      currentMidi = clampMidi(candidate, lowerBound, upperBound);

      if (currentMidi >= upperBound) {
        direction = -1;
      } else if (currentMidi <= lowerBound) {
        direction = 1;
      }

      bar.lineNotes.push({
        midi: currentMidi,
        label: noteFromIndex(currentMidi % 12, bar.chord.includes("b"))
      });
      lastMidi = currentMidi;
    }
  }

  return { lastMidi, lastDirection: direction };
}

function clampMidi(midi: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, midi));
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function findTonicStartMidi(tonicPc: number, low: number, high: number): number {
  const tonicCandidates: number[] = [];
  for (let midi = low; midi <= high; midi += 1) {
    if (mod12(midi) === tonicPc) {
      tonicCandidates.push(midi);
    }
  }

  if (tonicCandidates.length === 0) {
    return low;
  }

  const center = (low + high) / 2;
  let best = tonicCandidates[0];
  let bestDistance = Math.abs(best - center);
  for (const candidate of tonicCandidates) {
    const distance = Math.abs(candidate - center);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function buildScaleMidisInRange(pcs: number[], low: number, high: number): number[] {
  const midis: number[] = [];
  for (let midi = low; midi <= high; midi += 1) {
    if (pcs.includes(mod12(midi))) {
      midis.push(midi);
    }
  }
  return midis;
}

function findDirectionalAnchorIndex(currentMidi: number, scaleMidis: number[], direction: number): number {
  if (scaleMidis.length === 0) {
    return 0;
  }

  if (direction < 0) {
    // Descending: anchor to the nearest scale note at or below current pitch.
    for (let i = scaleMidis.length - 1; i >= 0; i -= 1) {
      if (scaleMidis[i] <= currentMidi) {
        return i;
      }
    }
    return 0;
  }

  // Ascending: anchor to the nearest scale note at or above current pitch.
  for (let i = 0; i < scaleMidis.length; i += 1) {
    if (scaleMidis[i] >= currentMidi) {
      return i;
    }
  }
  return scaleMidis.length - 1;
}

function findNextMidiByInterval(currentMidi: number, scaleMidis: number[], intervalStep: number, direction: number): number {
  if (scaleMidis.length === 0) {
    return currentMidi;
  }

  const currentIndex = findDirectionalAnchorIndex(currentMidi, scaleMidis, direction);
  const targetIndex = currentIndex + direction * intervalStep;
  const clampedIndex = Math.max(0, Math.min(scaleMidis.length - 1, targetIndex));
  return scaleMidis[clampedIndex];
}

function playBarAudio(bar: string): void {
  const parsed = parseChordSymbol(bar);
  if (!parsed || !polySynth) {
    return;
  }
  const notes = buildChordTones(parsed.root, parsed.chordIntervals, 3);
  const duration = (60 / state.bpm) * 4 * 0.95;
  polySynth.triggerAttackRelease(notes, duration, Tone.now());
}

function triggerMetronome(): void {
  if (!clickSynth) {
    return;
  }
  clickSynth.triggerAttackRelease("C2", "8n", Tone.now());
}


function stopLoop(): void {
  if (loopTimer !== null) {
    window.clearInterval(loopTimer);
    loopTimer = null;
  }
  state.isPlaying = false;
  state.currentNoteStep = 0;
  render();
}

async function startLoop(): Promise<void> {
  const bars = getDisplayBars();
  if (bars.length === 0) {
    return;
  }

  await Tone.start();

  if (!polySynth) {
    polySynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: "triangle"
      },
      envelope: {
        attack: 0.01,
        decay: 0.08,
        sustain: 0.35,
        release: 0.6
      }
    }).toDestination();
    polySynth.volume.value = -10;
  }

  if (!clickSynth) {
    clickSynth = new Tone.MembraneSynth().toDestination();
    clickSynth.volume.value = -16;
  }

  stopLoop();
  state.isPlaying = true;
  regenerateBars(state.lastMidiInLoop, state.lastDirectionInLoop);

  const step = () => {
    const nowBars = getDisplayBars();
    if (nowBars.length === 0) {
      stopLoop();
      return;
    }

    const idx = state.currentBar % nowBars.length;
    const atBarStart = state.currentNoteStep === 0;

    if (atBarStart) {
      const barChord = nowBars[idx].originalChord;
      if (state.metronome) {
        triggerMetronome();
      }
      if (state.playChords) {
        playBarAudio(barChord);
      }
    }

    render();

    const currentBarData = nowBars[idx];
    const currentNote = currentBarData?.lineNotes[state.currentNoteStep];
    if (currentNote) {
      state.lastMidiInLoop = currentNote.midi;
      const nextStepInBar = state.currentNoteStep + 1;
      const nextNote = nextStepInBar < currentBarData.lineNotes.length
        ? currentBarData.lineNotes[nextStepInBar]
        : (nowBars[idx + 1]?.lineNotes[0] ?? (state.loop ? nowBars[0]?.lineNotes[0] : undefined));
      if (nextNote) {
        state.lastDirectionInLoop = nextNote.midi >= currentNote.midi ? 1 : -1;
      }
    }

    state.currentNoteStep += 1;
    if (state.currentNoteStep >= state.notesPerBar) {
      state.currentNoteStep = 0;
      const next = idx + 1;
      if (next >= nowBars.length) {
        if (state.loop) {
          regenerateBars(nextCycleSeedMidi, nextCycleSeedDirection);
          state.currentBar = 0;
        } else {
          stopLoop();
          return;
        }
      } else {
        state.currentBar = next;
      }
    }
  };

  step();
  const stepMs = (60 / state.bpm) * 4 * 1000 / state.notesPerBar;
  loopTimer = window.setInterval(step, stepMs);
  render();
}

function readPresets(): Preset[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Preset[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry) => typeof entry.name === "string" && typeof entry.progression === "string");
  } catch {
    return [];
  }
}

function writePresets(presets: Preset[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function readInstrumentPresets(): InstrumentPreset[] {
  const raw = window.localStorage.getItem(INSTRUMENT_PRESETS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as InstrumentPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeInstrumentPresets(presets: InstrumentPreset[]): void {
  window.localStorage.setItem(INSTRUMENT_PRESETS_KEY, JSON.stringify(presets));
}

function refreshInstrumentPresetSelect(): void {
  const presets = readInstrumentPresets();
  instrumentPresetSelectEl.innerHTML = "";
  if (presets.length === 0) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No instrument presets";
    instrumentPresetSelectEl.appendChild(empty);
    return;
  }
  for (let i = 0; i < presets.length; i++) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = presets[i].name;
    instrumentPresetSelectEl.appendChild(option);
  }
}

function parseYaml(yamlText: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const lines = yamlText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.substring(0, colonIndex).trim();
    const valueStr = trimmed.substring(colonIndex + 1).trim();

    let value: unknown;
    if (valueStr === "true") {
      value = true;
    } else if (valueStr === "false") {
      value = false;
    } else if (!isNaN(Number(valueStr))) {
      value = Number(valueStr);
    } else if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
      value = valueStr.slice(1, -1);
    } else {
      value = valueStr;
    }

    obj[key] = value;
  }

  return obj;
}

async function loadPresetsFromPublic(): Promise<void> {
  const presetFiles = [
    "autumn-leaves.yaml",
    "modal-workout.yaml",
    "all-the-things-you-are.yaml",
    "blue-bossa.yaml",
    "fly-me-to-the-moon.yaml",
    "giant-steps.yaml",
    "in-a-sentimental-mood.yaml",
    "moments-notice.yaml",
    "solar.yaml",
    "so-what.yaml",
    "stella-by-starlight.yaml",
    "take-five.yaml",
    "the-girl-from-ipanema.yaml",
    "well-you-neednt.yaml"
  ];

  for (const filename of presetFiles) {
    try {
      const response = await fetch(`./presets/songs/${filename}`);
      const yamlText = await response.text();
      const data = parseYaml(yamlText);

      const presets = readPresets();
      const existing = presets.find((p) => p.name === data.name);

      if (!existing) {
        const preset: Preset = {
          id: crypto.randomUUID(),
          name: (data.name as string) || filename,
          author: (data.author as string) || undefined,
          email: (data.email as string) || undefined,
          progression: (data.progression as string) || "Cmaj7",
          bpm: (data.bpm as number) || 100,
          playChords: (data.playChords as boolean) ?? true,
          loop: (data.loop as boolean) ?? true,
          metronome: (data.metronome as boolean) ?? false,
          instrument: (data.instrument as InstrumentMode) || "concert",
          notesPerBar: (data.notesPerBar as number) || 4,
          lowerMidi: (data.lowerMidi as number) || 60,
          upperMidi: (data.upperMidi as number) || 84,
          intervalPractice: (data.intervalPractice as IntervalPractice) || "seconds"
        };
        presets.push(preset);
        writePresets(presets);
      }
    } catch {
      // Silently fail if preset file can't be loaded
    }
  }
}

async function loadInstrumentPresetsFromPublic(): Promise<void> {
  const instrumentFiles = [
    "piano.yaml",
    "concert-flute.yaml",
    "concert-oboe.yaml",
    "concert-bassoon.yaml",
    "concert-clarinet.yaml",
    "bass-clarinet.yaml",
    "soprano-saxophone.yaml",
    "alto-saxophone.yaml",
    "tenor-saxophone.yaml",
    "baritone-saxophone.yaml",
    "trumpet.yaml",
    "french-horn.yaml",
    "trombone.yaml",
    "tuba.yaml",
    "violin.yaml",
    "viola.yaml",
    "cello.yaml",
    "double-bass.yaml",
    "guitar.yaml",
    "bass-guitar.yaml",
    "soprano-voice.yaml",
    "alto-voice.yaml",
    "tenor-voice.yaml",
    "bass-voice.yaml"
  ];

  const existing = readInstrumentPresets();
  const merged = [...existing];

  for (const filename of instrumentFiles) {
    try {
      const response = await fetch(`./presets/instruments/${filename}`);
      const yamlText = await response.text();
      const data = parseYaml(yamlText);
      const name = (data.name as string) || filename;
      const templatePreset: InstrumentPreset = {
        name,
        key: (data.key as InstrumentMode) || "concert",
        lowerMidi: (data.lowerMidi as number) || 48,
        upperMidi: (data.upperMidi as number) || 84
      };
      const existingIdx = merged.findIndex((p) => p.name === name);
      if (existingIdx >= 0) {
        // Keep template presets synchronized when defaults are updated in /public.
        merged[existingIdx] = templatePreset;
      } else {
        merged.push(templatePreset);
      }
    } catch {
      // Silently fail
    }
  }

  writeInstrumentPresets(merged);
}

function refreshPresetSelect(): void {
  const presets = readPresets();
  presetSelectEl.innerHTML = "";

  if (presets.length === 0) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No presets saved";
    presetSelectEl.appendChild(empty);
    return;
  }

  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    const author = preset.author ? ` by ${preset.author}` : "";
    option.textContent = `${preset.name}${author}`;
    presetSelectEl.appendChild(option);
  }

  // Update subtitle with selected preset name
  const selected = presets.find((p) => p.id === presetSelectEl.value) ?? presets[0];
  if (selected) {
    const author = selected.author ? ` by ${selected.author}` : "";
    songPresetSubtitleEl.textContent = `${selected.name}${author}`;
  }
}

function applyPreset(preset: Preset): void {
  state.progressionText = preset.progression;
  state.bpm = preset.bpm;
  state.playChords = preset.playChords;
  state.loop = preset.loop;
  state.metronome = preset.metronome;
  state.instrument = preset.instrument;
  state.notesPerBar = clampNotesPerBar(preset.notesPerBar ?? 4);
  applyPitchLimits(preset.lowerMidi ?? 60, preset.upperMidi ?? 84);
  state.intervalPractice = preset.intervalPractice ?? "seconds";
  state.currentBar = 0;
  state.currentNoteStep = 0;
  state.lastMidiInLoop = null;
  state.lastDirectionInLoop = 1;
  resetGenerationState();
  render();
}

function savePreset(): void {
  const name = presetNameEl.value.trim();
  if (!name) {
    return;
  }

  const presets = readPresets();
  const id = crypto.randomUUID();
  const preset: Preset = {
    id,
    name,
    progression: state.progressionText,
    bpm: state.bpm,
    playChords: state.playChords,
    loop: state.loop,
    metronome: state.metronome,
    instrument: state.instrument,
    notesPerBar: state.notesPerBar,
    lowerMidi: state.lowerMidi,
    upperMidi: state.upperMidi,
    intervalPractice: state.intervalPractice
  };
  presets.push(preset);
  writePresets(presets);
  presetNameEl.value = "";
  refreshPresetSelect();
}

function downloadPreset(): void {
  const id = presetSelectEl.value;
  if (!id) {
    return;
  }

  const preset = readPresets().find((entry) => entry.id === id);
  if (!preset) {
    return;
  }

  // Generate YAML with placeholders for author and email
  const yaml = `name: ${preset.name}
author: ""
email: ""
progression: ${preset.progression}
bpm: ${preset.bpm}
playChords: ${preset.playChords}
loop: ${preset.loop}
metronome: ${preset.metronome}
instrument: ${preset.instrument}
notesPerBar: ${preset.notesPerBar}
lowerMidi: ${preset.lowerMidi}
upperMidi: ${preset.upperMidi}
intervalPractice: ${preset.intervalPractice}
`;

  const blob = new Blob([yaml], { type: "text/yaml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${preset.name.toLowerCase().replace(/\s+/g, "-")}.yaml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderProgression(): void {
  const bars = getDisplayBars();
  if (bars.length === 0) {
    scrollingSheetEl.innerHTML = `<p class="muted">Enter a progression to see the practice sheet.</p>`;
    return;
  }

  const clampedBar = Math.min(state.currentBar, bars.length - 1);
  const windowBars = buildScrollingWindow(bars, clampedBar);
  renderStaff(windowBars, clampedBar, state.currentNoteStep);
}

function buildScrollingWindow<T extends { index: number }>(bars: T[], currentIndex: number): T[] {
  if (bars.length <= 5) {
    return bars;
  }

  const result: T[] = [];
  for (let offset = -2; offset <= 2; offset += 1) {
    let idx = currentIndex + offset;
    if (state.loop) {
      idx = (idx + bars.length) % bars.length;
    }
    if (idx >= 0 && idx < bars.length) {
      result.push(bars[idx]);
    }
  }

  return result;
}

function renderStaff(bars: DisplayBar[], currentBarIndex: number, currentStep: number): void {
  if (bars.length === 0) {
    scrollingSheetEl.innerHTML = `<p class="muted">No bars to show on staff.</p>`;
    return;
  }
  scrollingSheetEl.innerHTML = "";

  const notationHost = document.createElement("div");
  notationHost.className = "sheet-notation";
  notationHost.id = "sheet-notation-container";
  scrollingSheetEl.appendChild(notationHost);

  const barWidth = 185;
  const width = Math.max(760, bars.length * barWidth + 24);
  const height = 220;

  const renderer = new Renderer(notationHost, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const context = renderer.getContext();
  context.setFont("Arial", 12, "");

  bars.forEach((bar, idx) => {
    const x = 12 + idx * barWidth;
    const y = 78;
    const stave = new Stave(x, y, barWidth);
    if (idx === 0) {
      stave.addClef("treble");
    }
    stave.setContext(context).draw();

    context.setFillStyle(bar.index === currentBarIndex ? "#bb5a2a" : "#5b5244");
    context.fillText(`Bar ${bar.index + 1}: ${bar.chord}`, x + 6, 22);
    context.setFillStyle("#6f6655");
    context.fillText(bar.scaleName, x + 6, 38);

    const tickables = buildBarTickables(bar, bar.index === currentBarIndex, currentStep);
    const voice = new Voice({ num_beats: state.notesPerBar, beat_value: 4 });
    voice.addTickables(tickables);
    Formatter.FormatAndDraw(context, stave, tickables);
  });

  // Scroll to keep current note centered in viewport
  scrollToCurrentNote(bars, currentBarIndex, currentStep);
}

function scrollToCurrentNote(bars: DisplayBar[], currentBarIndex: number, currentStep: number): void {
  if (!scrollingSheetEl) {
    return;
  }

  // Find the position of the current bar in the rendered window
  let currentBarWindowPosition = 2; // default assumption
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].index === currentBarIndex) {
      currentBarWindowPosition = i;
      break;
    }
  }

  const barWidth = 185;
  const noteSpacing = barWidth / state.notesPerBar;
  const clefOffset = 40; // clef width on first bar
  
  // Position of the bar on screen (based on actual position in rendered window)
  const barXInWindow = 12 + currentBarWindowPosition * barWidth;
  
  // Note position within the bar
  const noteXInBar = clefOffset + 8 + (currentStep + 0.5) * noteSpacing;
  const noteXAbsolute = barXInWindow + noteXInBar;
  
  // Center in viewport
  const containerWidth = scrollingSheetEl.offsetWidth;
  const targetScroll = noteXAbsolute - (containerWidth / 2);
  
  scrollingSheetEl.scrollTo({
    left: Math.max(0, targetScroll),
    behavior: "smooth"
  });
}

function buildBarTickables(bar: DisplayBar, isCurrentBar: boolean, currentStep: number): StaveNote[] {
  if (!bar.valid || bar.lineNotes.length === 0) {
    return Array.from({ length: state.notesPerBar }, () => new StaveNote({ keys: ["b/4"], duration: "qr" }));
  }

  const pitchOffset = transposeSemitones(state.instrument);
  return bar.lineNotes.map((lineNote, idx) => {
    const displayMidi = lineNote.midi + pitchOffset;
    const displayLabel = noteFromIndex(mod12(displayMidi), bar.chord.includes("b"));
    const vex = midiToVexKey(displayMidi, displayLabel);
    const staveNote = new StaveNote({ keys: [vex.key], duration: "q" });
    if (vex.accidental) {
      staveNote.addModifier(new Accidental(vex.accidental), 0);
    }
    if (isCurrentBar && idx === currentStep) {
      staveNote.setStyle({
        fillStyle: "#bb5a2a",
        strokeStyle: "#bb5a2a"
      });
    }
    return staveNote;
  });
}

function midiToVexKey(midi: number, label: string): { key: string; accidental: string | null } {
  const octave = Math.floor(midi / 12) - 1;
  const letter = label[0].toLowerCase();
  const accidental = label.includes("#") ? "#" : label.includes("b") ? "b" : null;
  return {
    key: `${letter}/${octave}`,
    accidental
  };
}

function exportProgressionToMidi(): void {
  const bars = getDisplayBarsBase();
  applyContinuousLine(bars, null, 1);
  if (bars.length === 0) {
    alert("No progression to export.");
    return;
  }

  const events: Array<{ time: number; note: number; duration: number; velocity: number }> = [];
  const notesPerBar = state.notesPerBar;
  const noteDuration = 480; // PPQ / 4 (quarter note in MIDI ticks)

  bars.forEach((bar, barIdx) => {
    if (bar.valid && bar.lineNotes.length > 0) {
      bar.lineNotes.forEach((lineNote, noteIdx) => {
        const time = barIdx * notesPerBar * noteDuration + noteIdx * noteDuration;
        events.push({
          time,
          note: lineNote.midi,
          duration: Math.floor(noteDuration * 0.9),
          velocity: 80
        });
      });
    }
  });

  const midiData = generateSimpleMidi(events);
  downloadMidi(midiData, "bigscale-exercise.mid");
}

function generateSimpleMidi(events: Array<{ time: number; note: number; duration: number; velocity: number }>): Uint8Array {
  // Minimal MIDI file builder
  const trackData: number[] = [];
  let lastTime = 0;

  // Sort events by time
  events.sort((a, b) => a.time - b.time);

  for (const event of events) {
    const deltaTime = event.time - lastTime;
    trackData.push(...encodeVariableLength(deltaTime));
    // Note on
    trackData.push(0x90, event.note, event.velocity);
    // Note off (with delta time for duration)
    trackData.push(...encodeVariableLength(event.duration));
    trackData.push(0x80, event.note, 0x40);
    lastTime = event.time + event.duration;
  }

  // End of track
  trackData.push(0x00, 0xff, 0x2f, 0x00);

  // Build track chunk
  const trackBytes = new Uint8Array(trackData);
  const trackChunk = new Uint8Array(8 + trackBytes.length);
  trackChunk.set([0x4d, 0x54, 0x72, 0x6b], 0); // "MTrk"
  const len = trackBytes.length;
  trackChunk.set([0, 0, (len >> 8) & 0xff, len & 0xff], 4);
  trackChunk.set(trackBytes, 8);

  // Build header chunk
  const headerChunk = new Uint8Array(14);
  headerChunk.set([0x4d, 0x54, 0x68, 0x64], 0); // "MThd"
  headerChunk.set([0, 0, 0, 6], 4); // Header length
  headerChunk.set([0, 0], 8); // Format 0
  headerChunk.set([0, 1], 10); // 1 track
  headerChunk.set([0x01, 0xe0], 12); // 480 PPQ

  // Combine
  const midiFile = new Uint8Array(headerChunk.length + trackChunk.length);
  midiFile.set(headerChunk);
  midiFile.set(trackChunk, headerChunk.length);
  return midiFile;
}

function encodeVariableLength(value: number): number[] {
  const bytes: number[] = [];
  bytes.unshift(value & 0x7f);
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes;
}

function downloadMidi(data: Uint8Array, filename: string): void {
  const blob = new Blob([data] as BlobPart[], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function render(): void {
  progressionEl.value = state.progressionText;
  bpmEl.value = String(state.bpm);
  instrumentEl.value = state.instrument;
  notesPerBarEl.value = String(state.notesPerBar);
  intervalPracticeEl.value = state.intervalPractice;
  playChordsEl.checked = state.playChords;
  loopEl.checked = state.loop;
  metronomeEl.checked = state.metronome;
  const pitchOffset = transposeSemitones(state.instrument);
  lowerLabelEl.textContent = midiLabel(state.lowerMidi + pitchOffset);
  upperLabelEl.textContent = midiLabel(state.upperMidi + pitchOffset);
  renderPitchStaff(rangeStaffEl, state.lowerMidi + pitchOffset, state.upperMidi + pitchOffset);
  lowerDownEl.disabled = state.lowerMidi <= MIN_LIMIT_MIDI;
  lowerUpEl.disabled = state.lowerMidi >= state.upperMidi - 1;
  upperDownEl.disabled = state.upperMidi <= state.lowerMidi + 1;
  upperUpEl.disabled = state.upperMidi >= MAX_LIMIT_MIDI;
  playPauseEl.textContent = state.isPlaying ? "Pause" : "Play";
  const keyLabel = state.instrument === "concert" ? "Concert (C)" : state.instrument === "bb" ? "Bb" : "Eb";
  instrumentPanelSubtitleEl.textContent = `${keyLabel} · ${midiLabel(state.lowerMidi + pitchOffset)}–${midiLabel(state.upperMidi + pitchOffset)}`;
  // Update song preset subtitle to reflect currently selected option
  const selectedOption = presetSelectEl.options[presetSelectEl.selectedIndex];
  if (selectedOption && selectedOption.value) {
    songPresetSubtitleEl.textContent = selectedOption.textContent ?? "";
  }
  renderProgression();
}

progressionEl.addEventListener("input", () => {
  state.progressionText = progressionEl.value;
  state.currentBar = 0;
  state.currentNoteStep = 0;
  state.lastMidiInLoop = null;
  state.lastDirectionInLoop = 1;
  resetGenerationState();
  render();
});

bpmEl.addEventListener("input", () => {
  const val = Number.parseInt(bpmEl.value, 10);
  if (!Number.isNaN(val)) {
    state.bpm = Math.max(40, Math.min(300, val));
    if (state.isPlaying) {
      startLoop().catch(() => undefined);
    }
    render();
  }
});

instrumentEl.addEventListener("change", () => {
  state.instrument = instrumentEl.value as InstrumentMode;
  resetGenerationState();
  render();
});

notesPerBarEl.addEventListener("input", () => {
  const val = Number.parseInt(notesPerBarEl.value, 10);
  if (!Number.isNaN(val)) {
    state.notesPerBar = clampNotesPerBar(val);
    state.currentNoteStep = 0;
    state.lastMidiInLoop = null;
    state.lastDirectionInLoop = 1;
    resetGenerationState();
    if (state.isPlaying) {
      startLoop().catch(() => undefined);
    }
    render();
  }
});

intervalPracticeEl.addEventListener("change", () => {
  state.intervalPractice = intervalPracticeEl.value as IntervalPractice;
  state.currentNoteStep = 0;
  state.lastMidiInLoop = null;
  state.lastDirectionInLoop = 1;
  resetGenerationState();
  if (state.isPlaying) {
    startLoop().catch(() => undefined);
  }
  render();
});

playChordsEl.addEventListener("change", () => {
  state.playChords = playChordsEl.checked;
});

loopEl.addEventListener("change", () => {
  state.loop = loopEl.checked;
});

metronomeEl.addEventListener("change", () => {
  state.metronome = metronomeEl.checked;
});

lowerDownEl.addEventListener("click", () => {
  applyPitchLimits(state.lowerMidi - 1, state.upperMidi);
  if (state.isPlaying) {
    startLoop().catch(() => undefined);
  }
  render();
});

lowerUpEl.addEventListener("click", () => {
  applyPitchLimits(state.lowerMidi + 1, state.upperMidi);
  if (state.isPlaying) {
    startLoop().catch(() => undefined);
  }
  render();
});

upperDownEl.addEventListener("click", () => {
  applyPitchLimits(state.lowerMidi, state.upperMidi - 1);
  if (state.isPlaying) {
    startLoop().catch(() => undefined);
  }
  render();
});

upperUpEl.addEventListener("click", () => {
  applyPitchLimits(state.lowerMidi, state.upperMidi + 1);
  if (state.isPlaying) {
    startLoop().catch(() => undefined);
  }
  render();
});

playPauseEl.addEventListener("click", () => {
  if (state.isPlaying) {
    stopLoop();
    return;
  }

  state.currentBar = 0;
  state.currentNoteStep = 0;
  state.lastMidiInLoop = null;
  state.lastDirectionInLoop = 1;
  resetGenerationState();
  startLoop().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start audio", err);
  });
});

resetEl.addEventListener("click", () => {
  stopLoop();
  state.currentBar = 0;
  state.currentNoteStep = 0;
  state.lastMidiInLoop = null;
  state.lastDirectionInLoop = 1;
  resetGenerationState();
  render();
});

savePresetEl.addEventListener("click", () => {
  savePreset();
});

loadPresetEl.addEventListener("click", () => {
  const id = presetSelectEl.value;
  if (!id) return;
  const selected = readPresets().find((entry) => entry.id === id);
  if (selected) {
    applyPreset(selected);
    songPresetSubtitleEl.textContent = presetSelectEl.options[presetSelectEl.selectedIndex]?.textContent ?? "";
  }
});

presetSelectEl.addEventListener("change", () => {
  const option = presetSelectEl.options[presetSelectEl.selectedIndex];
  if (option?.value) songPresetSubtitleEl.textContent = option.textContent ?? "";
});

downloadPresetEl.addEventListener("click", () => {
  downloadPreset();
});

loadInstrumentPresetEl.addEventListener("click", () => {
  const idx = Number(instrumentPresetSelectEl.value);
  const presets = readInstrumentPresets();
  const preset = presets[idx];
  if (!preset) return;
  state.instrument = preset.key;
  applyPitchLimits(preset.lowerMidi, preset.upperMidi);
  resetGenerationState();
  render();
});

exportMidiEl.addEventListener("click", () => {
  exportProgressionToMidi();
});

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat) {
    return;
  }

  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement
    || active instanceof HTMLTextAreaElement
    || active instanceof HTMLSelectElement
    || active instanceof HTMLButtonElement
    || (active instanceof HTMLElement && active.isContentEditable)
  ) {
    return;
  }

  event.preventDefault();
  playPauseEl.click();
});

// Initialize with Autumn Leaves on page load
window.addEventListener("DOMContentLoaded", async () => {
  await loadPresetsFromPublic();
  await loadInstrumentPresetsFromPublic();
  refreshPresetSelect();
  refreshInstrumentPresetSelect();
  state.progressionText = AUTUMN_LEAVES;
  render();
});

refreshPresetSelect();
refreshInstrumentPresetSelect();
render();
