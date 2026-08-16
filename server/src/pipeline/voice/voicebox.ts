import fsp from 'node:fs/promises';
import type { Settings } from '@shared/types';

/**
 * Voicebox — 로컬에서 도는 음성 합성기 (선택 사용).
 *
 * 타입캐스트와 달리 API 키도 요금도 없고 오프라인으로 돈다. 대신 **서버가 떠 있어야** 한다:
 *   voicebox-server.exe --host 127.0.0.1 --port 17493 --data-dir <작업공간 밖 폴더>
 *
 * `--data-dir`를 반드시 준다 — 안 주면 **현재 폴더에 `data/`를 만들어** 생성물을 쌓는다.
 * 저장소 안에서 띄웠다가 리포에 음성 7MB가 쌓인 적이 있다.
 *
 * 실측으로 정한 것들 (2026-08-16):
 * - **씬 하나에 문장 하나.** 두 문장을 한 번에 주면 뒷문장이 통째로 잘린다 (2.96초로 끝나버렸다)
 * - 말투 지시(`instruct`)로 속도를 올리는 데는 한계가 있다 (초당 7.06 → 7.30자, 3%).
 *   빠른 톤은 배속(`speechRate`)으로 만든다
 * - 한글 표기를 바꾸면 발음이 고쳐진다 ("원상복구비"→"복급이" 오독, "원상복구 비용"은 정상)
 */

export const AUDIO_EXT = '.wav';

/** 생성 완료를 기다리는 최대 시간 — CPU에서 한 문장에 1분 넘게 걸린다 */
const GENERATE_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 2_000;

export interface VoiceboxProfile {
  id: string;
  name: string;
  language: string;
  voiceType: string;
}

const base = (settings: Settings): string => settings.voiceboxUrl.replace(/\/$/, '');

async function call(settings: Settings, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${base(settings)}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voicebox ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

/** 서버가 떠 있는가 — 도구 점검과 화면 안내에 쓴다 */
export async function available(settings: Settings): Promise<boolean> {
  try {
    const res = await fetch(`${base(settings)}/profiles`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 등록된 목소리 목록 — 화면에서 고르게 한다 */
export async function listProfiles(settings: Settings): Promise<VoiceboxProfile[]> {
  const raw = (await (await call(settings, '/profiles')).json()) as Array<Record<string, unknown>>;
  return raw.map((p) => ({
    id: String(p.id),
    name: String(p.name ?? ''),
    language: String(p.language ?? ''),
    voiceType: String(p.voice_type ?? ''),
  }));
}

/**
 * 생성 상태는 SSE(`data: {...}`)로 온다 — JSON으로 바로 읽으면 파싱에서 터진다.
 * 마지막 `data:` 줄이 현재 상태다.
 */
function lastEvent(text: string): { status: string; duration: number; error?: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith('data:'));
  if (!lines.length) throw new Error('Voicebox 상태 응답이 비어 있습니다');
  return JSON.parse(lines[lines.length - 1].slice(5));
}

/**
 * 한 문장을 합성해 파일로 저장한다. 반환값은 음성 길이(초).
 *
 * 길이를 응답에서 그대로 받으므로 ffprobe를 한 번 덜 부른다 —
 * 다만 호출하는 쪽은 파일 기준으로 다시 재도 된다 (같은 값이 나온다).
 */
export async function synthesizeToFile(
  settings: Settings,
  text: string,
  outPath: string,
): Promise<number> {
  if (!settings.voiceboxProfileId) {
    throw new Error('Voicebox 목소리가 선택되지 않았습니다 (설정 → 음성)');
  }

  const started = (await (
    await call(settings, '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        profile_id: settings.voiceboxProfileId,
        text,
        language: 'ko',
        ...(settings.voiceboxInstruct ? { instruct: settings.voiceboxInstruct } : {}),
      }),
    })
  ).json()) as { id?: string };
  if (!started.id) throw new Error('Voicebox가 생성 id를 주지 않았습니다');

  const deadline = Date.now() + GENERATE_TIMEOUT_MS;
  for (;;) {
    const status = lastEvent(await (await call(settings, `/generate/${started.id}/status`)).text());
    if (status.status === 'completed') {
      const audio = await (await call(settings, `/audio/${started.id}`)).arrayBuffer();
      await fsp.writeFile(outPath, Buffer.from(audio));
      return status.duration;
    }
    if (status.status !== 'generating' && status.status !== 'queued') {
      throw new Error(`Voicebox 합성 실패: ${status.error ?? status.status}`);
    }
    if (Date.now() > deadline) throw new Error('Voicebox 합성이 제한 시간을 넘겼습니다');
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
