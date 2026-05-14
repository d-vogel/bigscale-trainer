export type ScaleMode = "Ionian" | "Dorian" | "Mixolydian" | "Locrian" | "Whole-half diminished";

export type InstrumentMode = "concert" | "bb" | "eb";

export interface ParsedChord {
  root: string;
  bass: string | null;
  quality: string;
  normalizedQuality: string;
  scaleMode: ScaleMode;
  chordIntervals: number[];
  scaleIntervals: number[];
}

const SHARP_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NOTES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const NOTE_TO_INDEX: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11
};

interface Mapping {
  matcher: (q: string) => boolean;
  normalized: string;
  scaleMode: ScaleMode;
  chordIntervals: number[];
  scaleIntervals: number[];
}

interface ParseOptions {
  allowJazzShorthand?: boolean;
}

const CHORD_MAPPINGS: Mapping[] = [
  {
    matcher: (q) => q === "",
    normalized: "maj",
    scaleMode: "Ionian",
    chordIntervals: [0, 4, 7],
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11]
  },
  {
    matcher: (q) => q.startsWith("maj7") || q.startsWith("mmaj7"),
    normalized: "maj7",
    scaleMode: "Ionian",
    chordIntervals: [0, 4, 7, 11],
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11]
  },
  {
    matcher: (q) => q === "m7b5" || q === "m7(b5)" || q === "ø" || q === "ø7",
    normalized: "m7b5",
    scaleMode: "Locrian",
    chordIntervals: [0, 3, 6, 10],
    scaleIntervals: [0, 1, 3, 5, 6, 8, 10]
  },
  {
    matcher: (q) => q === "dim" || q === "dim7" || q === "o" || q === "o7",
    normalized: "dim7",
    scaleMode: "Whole-half diminished",
    chordIntervals: [0, 3, 6, 9],
    scaleIntervals: [0, 2, 3, 5, 6, 8, 9, 11]
  },
  {
    matcher: (q) => q === "m" || q.startsWith("m6") || q.startsWith("m7") || q.startsWith("m9") || q.startsWith("m11") || q.startsWith("m13"),
    normalized: "m7",
    scaleMode: "Dorian",
    chordIntervals: [0, 3, 7, 10],
    scaleIntervals: [0, 2, 3, 5, 7, 9, 10]
  },
  {
    matcher: (q) => q === "6" || q === "maj6" || q.startsWith("6/9"),
    normalized: "6",
    scaleMode: "Ionian",
    chordIntervals: [0, 4, 7, 9],
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11]
  },
  {
    matcher: (q) => q === "7" || q.startsWith("7") || q.startsWith("9") || q.startsWith("11") || q.startsWith("13"),
    normalized: "7",
    scaleMode: "Mixolydian",
    chordIntervals: [0, 4, 7, 10],
    scaleIntervals: [0, 2, 4, 5, 7, 9, 10]
  }
];

function normalizeAccidental(value: string): string {
  return value.replace(/♭/g, "b").replace(/♯/g, "#");
}

function normalizeQuality(value: string, allowJazzShorthand: boolean): string {
  let quality = value.replace(/\s+/g, "").replace(/Δ/g, "maj");
  if (!quality) {
    return quality;
  }

  if (allowJazzShorthand) {
    if (quality.startsWith("-")) {
      quality = `m${quality.slice(1)}`;
    }
    if (/^min/i.test(quality)) {
      quality = `m${quality.slice(3)}`;
    }
    if (/^M7$/.test(quality)) {
      quality = "maj7";
    }
  }

  return quality;
}

function hasJazzAlias(qualityRaw: string): boolean {
  return /^-/.test(qualityRaw)
    || /^min/i.test(qualityRaw)
    || qualityRaw.includes("ø")
    || qualityRaw.includes("o")
    || qualityRaw.includes("Δ")
    || qualityRaw === "M7";
}

function canonicalRoot(raw: string): string | null {
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }
  const head = normalized[0].toUpperCase();
  const tail = normalized.slice(1);
  const root = `${head}${tail}`;
  return NOTE_TO_INDEX[root] === undefined ? null : root;
}

export function transposeSemitones(mode: InstrumentMode): number {
  if (mode === "bb") {
    return 2;
  }
  if (mode === "eb") {
    return 9;
  }
  return 0;
}

export function noteFromIndex(index: number, preferFlats = false): string {
  const wrapped = ((index % 12) + 12) % 12;
  return preferFlats ? FLAT_NOTES[wrapped] : SHARP_NOTES[wrapped];
}

export function noteToIndex(note: string): number | null {
  const idx = NOTE_TO_INDEX[note];
  return idx === undefined ? null : idx;
}

export function transposeNote(note: string, semitones: number, preferFlats = false): string {
  const idx = NOTE_TO_INDEX[note];
  if (idx === undefined) {
    return note;
  }
  return noteFromIndex(idx + semitones, preferFlats);
}

export function parseChordSymbol(symbol: string, options: ParseOptions = {}): ParsedChord | null {
  const allowJazzShorthand = options.allowJazzShorthand ?? true;
  const clean = symbol.trim();
  if (!clean) {
    return null;
  }

  const match = clean.match(/^([A-Ga-g])([#b♭♯]?)([^/]*)?(?:\/([A-Ga-g])([#b♭♯]?))?$/);
  if (!match) {
    return null;
  }

  const rootRaw = `${match[1].toUpperCase()}${normalizeAccidental(match[2] || "")}`;
  const root = canonicalRoot(rootRaw);
  if (!root) {
    return null;
  }

  const qualityRaw = (match[3] || "").trim();
  if (!allowJazzShorthand && hasJazzAlias(qualityRaw)) {
    return null;
  }
  const quality = normalizeQuality(qualityRaw, allowJazzShorthand);

  const bassRaw = match[4]
    ? `${match[4].toUpperCase()}${normalizeAccidental(match[5] || "")}`
    : null;
  const bass = bassRaw ? canonicalRoot(bassRaw) : null;
  if (bassRaw && !bass) {
    return null;
  }

  const qualityKey = quality.toLowerCase();
  const chosen = CHORD_MAPPINGS.find((entry) => entry.matcher(qualityKey));

  if (!chosen) {
    return null;
  }

  return {
    root,
    bass,
    quality,
    normalizedQuality: chosen.normalized,
    scaleMode: chosen.scaleMode,
    chordIntervals: chosen.chordIntervals,
    scaleIntervals: chosen.scaleIntervals
  };
}

export function buildScale(root: string, intervals: number[], transpose = 0, preferFlats = false): string[] {
  const rootIdx = NOTE_TO_INDEX[root];
  if (rootIdx === undefined) {
    return [];
  }
  return intervals.map((step) => noteFromIndex(rootIdx + transpose + step, preferFlats));
}

export function buildChordTones(root: string, intervals: number[], octave = 3): string[] {
  const rootIdx = NOTE_TO_INDEX[root];
  if (rootIdx === undefined) {
    return [];
  }

  let previousMidi = 12 * (octave + 1) + rootIdx;
  const tones: string[] = [midiToToneNote(previousMidi)];

  for (let i = 1; i < intervals.length; i += 1) {
    let candidate = 12 * (octave + 1) + rootIdx + intervals[i];
    while (candidate <= previousMidi) {
      candidate += 12;
    }
    previousMidi = candidate;
    tones.push(midiToToneNote(candidate));
  }

  return tones;
}

function midiToToneNote(midi: number): string {
  const name = noteFromIndex(midi % 12, false);
  const oct = Math.floor(midi / 12) - 1;
  return `${name}${oct}`;
}

export function transposeChordSymbol(symbol: string, semitones: number): string {
  const parsed = parseChordSymbol(symbol, { allowJazzShorthand: true });
  if (!parsed) {
    return symbol;
  }
  const preferFlats = parsed.root.includes("b");
  const transposedRoot = transposeNote(parsed.root, semitones, preferFlats);
  if (!parsed.bass) {
    return `${transposedRoot}${parsed.quality}`;
  }
  const transposedBass = transposeNote(parsed.bass, semitones, preferFlats);
  return `${transposedRoot}${parsed.quality}/${transposedBass}`;
}

export function splitProgression(input: string): string[] {
  return input
    .split("|")
    .map((bar) => bar.trim())
    .filter((bar) => bar.length > 0);
}
