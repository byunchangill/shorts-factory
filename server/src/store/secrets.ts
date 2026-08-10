import path from 'node:path';
import { SecretsSchema, type Secrets } from '@shared/types';
import type { ApiKeyName } from '@shared/constants';
import { WORKSPACE_ROOT } from './workspace.js';
import { readJson, writeJsonAtomic } from '../util/fsx.js';

/** API 키 저장 위치 — workspace/ 는 gitignore 대상이므로 커밋되지 않는다 */
const SECRETS_PATH = path.join(WORKSPACE_ROOT, 'secrets.json');

export async function loadSecrets(): Promise<Secrets> {
  const raw = await readJson<unknown>(SECRETS_PATH);
  const parsed = SecretsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : SecretsSchema.parse({});
}

export async function saveSecrets(secrets: Secrets): Promise<void> {
  await writeJsonAtomic(SECRETS_PATH, SecretsSchema.parse(secrets));
}

export async function getKey(name: ApiKeyName): Promise<string> {
  const secrets = await loadSecrets();
  return secrets[name] ?? '';
}

export async function setKey(name: ApiKeyName, value: string): Promise<void> {
  const secrets = await loadSecrets();
  secrets[name] = value.trim();
  await saveSecrets(secrets);
}

export async function hasKey(name: ApiKeyName): Promise<boolean> {
  return (await getKey(name)).length > 0;
}

/** UI 표시용 마스킹 — 끝 4자리만 노출 */
export function maskKey(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return '•'.repeat(Math.min(20, value.length - 4)) + value.slice(-4);
}
