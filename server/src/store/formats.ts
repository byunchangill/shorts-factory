import path from 'node:path';
import { FormatSchema, type Format } from '@shared/types';
import { paths } from './workspace.js';
import { ensureDir, exists, listDirs, readJson, slugify, writeJsonAtomic } from '../util/fsx.js';

export async function listFormats(): Promise<Format[]> {
  const dirs = await listDirs(paths.formats());
  const formats: Format[] = [];
  for (const dir of dirs) {
    const raw = await readJson<unknown>(path.join(paths.format(dir), 'format.json'));
    const parsed = FormatSchema.safeParse(raw);
    if (parsed.success) formats.push(parsed.data);
  }
  return formats.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getFormat(id: string): Promise<Format | null> {
  const raw = await readJson<unknown>(path.join(paths.format(id), 'format.json'));
  const parsed = FormatSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function saveFormat(input: Omit<Format, 'id' | 'createdAt'> & { id?: string }): Promise<Format> {
  let id = input.id ?? slugify(input.name);
  if (!input.id) {
    let candidate = id;
    let n = 1;
    while (await exists(paths.format(candidate))) {
      n += 1;
      candidate = `${id}-${n}`;
    }
    id = candidate;
  }
  const existing = input.id ? await getFormat(input.id) : null;
  const format = FormatSchema.parse({
    ...input,
    id,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    version: existing ? existing.version + 1 : 1,
  });
  await ensureDir(path.join(paths.format(id), 'reference'));
  await writeJsonAtomic(path.join(paths.format(id), 'format.json'), format);
  return format;
}
