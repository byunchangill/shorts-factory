import path from 'node:path';
import { ViralItemSchema, type ViralItem } from '@shared/types';
import { WORKSPACE_ROOT } from './workspace.js';
import { readJson, writeJsonAtomic, withFileLock } from '../util/fsx.js';

/**
 * 보관함.
 *
 * 발굴 결과 전체를 저장하지는 않는다 — 검색은 언제든 다시 돌릴 수 있고,
 * 조회수는 몇 시간이면 낡는다. 사용자가 "이건 만들어보겠다"고 담아둔 것만 남긴다.
 */
const BOARD = path.join(WORKSPACE_ROOT, 'viral-board.json');

export async function readBoard(): Promise<ViralItem[]> {
  const raw = await readJson<unknown[]>(BOARD);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const parsed = ViralItemSchema.safeParse(r);
    return parsed.success ? [parsed.data] : []; // 깨진 항목 하나가 보관함 전체를 막지 않게
  });
}

export async function saveToBoard(item: ViralItem): Promise<ViralItem[]> {
  return withFileLock(BOARD, async () => {
    const board = await readBoard();
    if (board.some((b) => b.video.videoId === item.video.videoId)) return board;
    const next = [ViralItemSchema.parse(item), ...board];
    await writeJsonAtomic(BOARD, next);
    return next;
  });
}

export async function removeFromBoard(videoId: string): Promise<ViralItem[]> {
  return withFileLock(BOARD, async () => {
    const next = (await readBoard()).filter((b) => b.video.videoId !== videoId);
    await writeJsonAtomic(BOARD, next);
    return next;
  });
}
