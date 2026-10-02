// Local project library: one folder per project under <userData>/projects,
// holding a small meta.json (listed often) and a larger notes.json (loaded on open).
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_NOTES, type NoteEvent, type Project, type ProjectSettings, type ProjectSummary } from '../shared/ipc';
import { INSTRUMENTS, isInstrumentId, MAX_CAPO, type InstrumentId } from '../shared/instruments';
import { isMeterId } from '../shared/meters';

interface StoredMeta extends ProjectSummary {
  schemaVersion: 1;
  sourcePath: string;
}

const ID_PATTERN = /^[a-f0-9]{32}$/;
/** The notes as transcribed, kept once the user edits notes.json. */
const ORIGINAL_NOTES = 'notes.original.json';

function projectsDir(): string {
  return path.join(app.getPath('userData'), 'projects');
}

/** Returns null for anything that is not one of our generated ids, so ids can never escape the projects folder. */
function projectDir(id: string): string | null {
  return ID_PATTERN.test(id) ? path.join(projectsDir(), id) : null;
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(data));
  await rename(temp, file);
}

async function readMeta(dir: string): Promise<StoredMeta | null> {
  try {
    const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')) as StoredMeta;
    if (meta.schemaVersion !== 1) return null;
    return { ...meta, settings: normalizeSettings(meta.settings) };
  } catch {
    return null;
  }
}

/** Brings settings saved by older versions up to date. */
function normalizeSettings(settings: Partial<ProjectSettings>): ProjectSettings {
  // Piano, violin and accordion were briefly supported; their projects reopen as guitar.
  const instrument: InstrumentId = isInstrumentId(settings.instrument) ? settings.instrument : 'guitar';
  const sameInstrument = instrument === settings.instrument;
  const { tunings } = INSTRUMENTS[instrument];
  return {
    instrument,
    tuningId: sameInstrument && tunings.some((t) => t.id === settings.tuningId) ? settings.tuningId! : null,
    tempo: settings.tempo ?? null,
    // Settings added later default to automatic detection.
    capo: sameInstrument ? (settings.capo ?? null) : null,
    meter: isMeterId(settings.meter) ? settings.meter : null,
    chords: settings.chords ?? true,
    techniques: settings.techniques ?? true,
    tempoChanges: settings.tempoChanges ?? true,
  };
}

function toSummary({ schemaVersion: _version, sourcePath: _path, ...summary }: StoredMeta): ProjectSummary {
  return summary;
}

export function isValidSettings(value: unknown): value is ProjectSettings {
  if (typeof value !== 'object' || value === null) return false;
  const { instrument, tuningId, tempo, capo, meter, chords, techniques, tempoChanges } = value as Record<string, unknown>;
  return (
    isInstrumentId(instrument) &&
    (tuningId === null || INSTRUMENTS[instrument].tunings.some((t) => t.id === tuningId)) &&
    (tempo === null || (typeof tempo === 'number' && Number.isFinite(tempo) && tempo >= 20 && tempo <= 400)) &&
    (capo === null || (Number.isInteger(capo) && (capo as number) >= 0 && (capo as number) <= MAX_CAPO)) &&
    (meter === null || isMeterId(meter)) &&
    typeof chords === 'boolean' &&
    typeof techniques === 'boolean' &&
    typeof tempoChanges === 'boolean'
  );
}

const isFiniteNumber = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function isValidNotes(value: unknown): value is NoteEvent[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_NOTES &&
    value.every((note: unknown) => {
      if (typeof note !== 'object' || note === null) return false;
      const { start, duration, pitch, velocity, string, attack, bend, release, slideIn, slideOut, vibrato } = note as Record<string, unknown>;
      const optional = (value: unknown, valid: (v: unknown) => boolean) => value === undefined || valid(value);
      const isBoolean = (v: unknown) => typeof v === 'boolean';
      return (
        optional(attack, (v) => isFiniteNumber(v, 0, 1)) &&
        optional(bend, (v) => isFiniteNumber(v, 0, 4)) &&
        optional(slideIn, (v) => isFiniteNumber(v, -24, 24)) &&
        optional(slideOut, (v) => isFiniteNumber(v, -24, 24)) &&
        optional(release, isBoolean) &&
        optional(vibrato, isBoolean) &&
        isFiniteNumber(start, 0, 24 * 3600) &&
        isFiniteNumber(duration, 0, 3600) &&
        Number.isInteger(pitch) &&
        isFiniteNumber(pitch, 0, 127) &&
        isFiniteNumber(velocity, 0, 1) &&
        (string === undefined || (Number.isInteger(string) && isFiniteNumber(string, 0, 11)))
      );
    })
  );
}

export async function createProject(input: {
  sourcePath: string;
  instrument: InstrumentId;
  notes: NoteEvent[];
  durationSeconds: number;
  /** Defaults to the file name. */
  title?: string;
  isolated?: boolean;
}): Promise<ProjectSummary> {
  const id = randomUUID().replaceAll('-', '');
  const dir = path.join(projectsDir(), id);
  await mkdir(dir, { recursive: true });

  const now = new Date().toISOString();
  const sourceName = path.basename(input.sourcePath);
  const meta: StoredMeta = {
    schemaVersion: 1,
    id,
    title: input.title ?? (sourceName.replace(/\.[^.]+$/, '') || sourceName),
    createdAt: now,
    updatedAt: now,
    sourceName,
    sourcePath: input.sourcePath,
    durationSeconds: input.durationSeconds,
    noteCount: input.notes.length,
    settings: { instrument: input.instrument, tuningId: null, tempo: null, capo: null, meter: null, chords: true, techniques: true, tempoChanges: true },
    ...(input.isolated ? { isolated: true } : {}),
  };
  await writeJsonAtomic(path.join(dir, 'notes.json'), input.notes);
  await writeJsonAtomic(path.join(dir, 'meta.json'), meta);
  return toSummary(meta);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(projectsDir());
  } catch {
    return [];
  }
  const metas = await Promise.all(entries.filter((e) => ID_PATTERN.test(e)).map((e) => readMeta(path.join(projectsDir(), e))));
  return metas
    .filter((m): m is StoredMeta => m !== null)
    .map(toSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProject(id: string): Promise<Project | null> {
  const dir = projectDir(id);
  const meta = dir && (await readMeta(dir));
  if (!dir || !meta) return null;
  const notes = JSON.parse(await readFile(path.join(dir, 'notes.json'), 'utf8')) as NoteEvent[];
  const exists = (file: string) => access(file).then(() => true, () => false);
  const [sourceAvailable, edited] = await Promise.all([exists(meta.sourcePath), exists(path.join(dir, ORIGINAL_NOTES))]);
  return { ...toSummary(meta), sourcePath: meta.sourcePath, sourceAvailable, notes, edited };
}

export async function getProjectSourcePath(id: string): Promise<string | null> {
  const dir = projectDir(id);
  const meta = dir && (await readMeta(dir));
  return meta ? meta.sourcePath : null;
}

export async function updateProjectSettings(id: string, settings: ProjectSettings): Promise<ProjectSummary | null> {
  const dir = projectDir(id);
  const meta = dir && (await readMeta(dir));
  if (!dir || !meta) return null;
  const updated: StoredMeta = { ...meta, settings, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(path.join(dir, 'meta.json'), updated);
  return toSummary(updated);
}

/** Saves edited notes, keeping the transcribed ones the first time. */
export async function updateProjectNotes(id: string, notes: NoteEvent[]): Promise<ProjectSummary | null> {
  const dir = projectDir(id);
  const meta = dir && (await readMeta(dir));
  if (!dir || !meta) return null;
  const original = path.join(dir, ORIGINAL_NOTES);
  const hasOriginal = await access(original).then(() => true, () => false);
  if (!hasOriginal) await writeFile(original, await readFile(path.join(dir, 'notes.json')));
  await writeJsonAtomic(path.join(dir, 'notes.json'), notes);
  const updated: StoredMeta = { ...meta, noteCount: notes.length, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(path.join(dir, 'meta.json'), updated);
  return toSummary(updated);
}

/** Restores the transcribed notes. */
export async function resetProjectNotes(id: string): Promise<NoteEvent[] | null> {
  const dir = projectDir(id);
  const meta = dir && (await readMeta(dir));
  if (!dir || !meta) return null;
  const original = path.join(dir, ORIGINAL_NOTES);
  const hasOriginal = await access(original).then(() => true, () => false);
  if (hasOriginal) await rename(original, path.join(dir, 'notes.json'));
  const notes = JSON.parse(await readFile(path.join(dir, 'notes.json'), 'utf8')) as NoteEvent[];
  await writeJsonAtomic(path.join(dir, 'meta.json'), { ...meta, noteCount: notes.length, updatedAt: new Date().toISOString() });
  return notes;
}

export async function deleteProject(id: string): Promise<boolean> {
  const dir = projectDir(id);
  if (!dir) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}
