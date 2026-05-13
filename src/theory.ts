export type ScaleMode = "Ionian" | "Dorian" | "Mixolydian" | "Locrian" | "Whole-half diminished";

export type InstrumentMode = "concert" | "bb" | "eb";

export interface ParsedChord {
  root: string;
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

const CHORD_MAPPINGS: Mapping[] = [
  {
    matcher: (q) => q.startsWith("maj7") || q.startsWith("mmaj7") || q.startsWith("M7"),
    normalized: "maj7",
    scaleMode: "Ionian",
    chordIntervals: [0, 4, 7, 11],
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11]
  },
  {
    matcher: (q) => q.includes("m7b5") || q.includes("m7(b5)") || q.includes("ø7"),
    normalized: "m7b5",
    scaleMode: "Locrian",
    chordIntervals: [0, 3, 6, 10],
    scaleIntervals: [0, 1, 3, 5, 6, 8, 10]
  },
  {
    matcher: (q) => q.includes("dim7") || q.includes("o7"),
    normalized: "dim7",
    scaleMode: "Whole-half diminished",
    chordIntervals: [0, 3, 6, 9],
    scaleIntervals: [0, 2, 3, 5, 6, 8, 9, 11]
  },
  {
    matcher: (q) => q.startsWith("m7") || q.startsWith("-7"),
    normalized: "m7",
    scaleMode: "Dorian",
    chordIntervals: [0, 3, 7, 10],
    scaleIntervals: [0, 2, 3, 5, 7, 9, 10]
  },
  {
    matcher: (q) => q === "7" || q.startsWith("7") || q.includes("13") || q.includes("9"),
    normalized: "7",
    scaleMode: "Mixolydian",
    chordIntervals: [0, 4, 7, 10],
    scaleIntervals: [0, 2, 4, 5, 7, 9, 10]
  }
];

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

export function parseChordSymbol(symbol: string): ParsedChord | null {
  const clean = symbol.trim();
  if (!clean) {
    return null;
  }

  const match = clean.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!match) {
    return null;
  }

  const rootRaw = `${match[1].toUpperCase()}${match[2] || ""}`;
  const root = canonicalRoot(rootRaw);
  if (!root) {
    return null;
  }

  const qualityRaw = (match[3] || "").trim();
  const quality = qualityRaw.replace(/\s+/g, "");

  let chosen = CHORD_MAPPINGS.find((entry) => entry.matcher(quality));
  if (!chosen) {
    if (quality.startsWith("m") || quality.startsWith("-")) {
      chosen = CHORD_MAPPINGS.find((entry) => entry.normalized === "m7");
    } else {
      chosen = CHORD_MAPPINGS.find((entry) => entry.normalized === "maj7");
    }
  }

  if (!chosen) {
    return null;
  }

  return {
    root,
    quality: qualityRaw,
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
  const parsed = parseChordSymbol(symbol);
  if (!parsed) {
    return symbol;
  }
  const preferFlats = parsed.root.includes("b");
  const transposedRoot = transposeNote(parsed.root, semitones, preferFlats);
  return `${transposedRoot}${parsed.quality}`;
}

export function splitProgression(input: string): string[] {
  return input
    .split("|")
    .map((bar) => bar.trim())
    .filter((bar) => bar.length > 0);
}
