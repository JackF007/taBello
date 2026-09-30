// Local project library: one folder per project under <userData>/projects,
// holding a small meta.json (listed often) and a larger notes.json (loaded on open).
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NoteEvent, Project, ProjectSettings, ProjectSummary } from '../shared/ipc';
import { INSTRUMENTS, isInstrumentId, type InstrumentId } from '../shared/instruments';

interface StoredMeta extends ProjectSummary {
  schemaVersion: 1;
  sourcePath: string;
}

const ID_PATTERN = /^[a-f0-9]{32}$/;

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
    return meta.schemaVersion === 1 ? meta : null;
  } catch {
    return null;
  }
}

function toSummary({ schemaVersion: _version, sourcePath: _path, ...summary }: StoredMeta): ProjectSummary {
  return summary;
}

export function isValidSettings(value: unknown): value is ProjectSettings {
  if (typeof value !== 'object' || value === null) return false;
  const { instrument, tuningId, tempo } = value as Record<string, unknown>;
  return (
    isInstrumentId(instrument) &&
    INSTRUMENTS[instrument].tunings.some((t) => t.id === tuningId) &&
    (tempo === null || (typeof tempo === 'number' && Number.isFinite(tempo) && tempo >= 20 && tempo <= 400))
  );
}

export async function createProject(input: {
  sourcePath: string;
  instrument: InstrumentId;
  notes: NoteEvent[];
  durationSeconds: number;
}): Promise<ProjectSummary> {
  const id = randomUUID().replaceAll('-', '');
  const dir = path.join(projectsDir(), id);
  await mkdir(dir, { recursive: true });

  const now = new Date().toISOString();
  const sourceName = path.basename(input.sourcePath);
  const meta: StoredMeta = {
    schemaVersion: 1,
    id,
    title: sourceName.replace(/\.[^.]+$/, '') || sourceName,
    createdAt: now,
    updatedAt: now,
    sourceName,
    sourcePath: input.sourcePath,
    durationSeconds: input.durationSeconds,
    noteCount: input.notes.length,
    settings: { instrument: input.instrument, tuningId: INSTRUMENTS[input.instrument].tunings[0].id, tempo: null },
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
  const sourceAvailable = await access(meta.sourcePath).then(() => true, () => false);
  return { ...toSummary(meta), sourcePath: meta.sourcePath, sourceAvailable, notes };
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

export async function deleteProject(id: string): Promise<boolean> {
  const dir = projectDir(id);
  if (!dir) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}
