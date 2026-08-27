import path from 'node:path';
import type { Job, Script, Clip, Settings, Asset } from '@shared/types';
import type { SceneTiming } from './tts.js';
import { buildSrt, splitLines, wrapKorean, type SubCue } from './subtitles.js';
import { subtitleCharsPerLine } from '@shared/constants';
import { assetLedgerCsv, assetLedgerRows, type AssetSubject } from '@shared/assetPolicy';
import { exportFileName } from './exporter.js';
import { fromWorkspaceRel } from '../store/workspace.js';

/**
 * 캡컷에 끌어다 넣을 폴더 만들기.
 *
 * 캡컷에는 공식 연동 API가 없다. 초안 폴더의 `draft_content.json`을 직접 만드는 길이
 * 있지만 비공식 포맷이라 캡컷이 올라갈 때마다 깨진다 — 편집기가 안 열리는 것이
 * 파일이 없는 것보다 나쁘다. 그래서 **사람이 끌어다 놓는 재료**를 만든다.
 *
 * 핵심은 **이름이 곧 순서**라는 것이다. 캡컷은 여러 파일을 한 번에 끌어다 놓으면
 * 이름 순으로 트랙에 얹는다. 번호를 앞에 붙여 씬 순서가 그대로 타임라인이 되게 한다.
 */

export interface CapcutInput {
  settings: Settings;
  job: Job;
  productName: string;
  jobDir: string;
  script: Script;
  timings: SceneTiming[];
  clips: Clip[];
  /** 자료실에서 이 잡에 담아둔 편집 재료 (짤방·효과음). 없으면 그 폴더가 안 생긴다 */
  assets?: Asset[];
  /**
   * 출처 대장에 실을 소재 전부 — **묶음에 담기는 것보다 넓다.**
   *
   * 씬 이미지는 이 묶음에 **안 담기는데도** 대장에는 실린다(아래 「씬 이미지」 주석).
   * 담긴 것만 신고하면, 그 편이 실제로 무엇을 써서 나갔는지가 묶음마다 다르게 적힌다 —
   * 대장은 「이 묶음에 든 파일 목록」이 아니라 「이 편이 쓴 소재의 출처」다.
   * 비면 `assets`를 쓴다 (옛 호출부 호환).
   */
  ledger?: AssetSubject[];
}

export interface CapcutItem {
  /** 묶음 안에서의 경로 (`01_영상/01_s01.mp4`) */
  name: string;
  /** 복사할 원본 절대경로. `text`가 있으면 비어 있다 */
  src?: string;
  text?: string;
}

/** 씬 번호를 두 자리로 — 열 개가 넘어가면 1, 10, 11, 2 순서로 섞인다 */
const no = (i: number) => String(i + 1).padStart(2, '0');

/**
 * 묶음 안에서 쓸 재료 파일 이름.
 *
 * 제목은 사람이 붙인 값이라 `/`·`:` 같은 글자가 들어올 수 있다 — zip 항목 이름에
 * 그대로 넣으면 없는 폴더를 만들거나 압축이 깨진다. 확장자는 원본 것을 그대로 쓴다.
 */
function assetFileName(a: Asset): string {
  const ext = path.extname(a.file);
  const base = a.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || path.basename(a.file, ext);
  return `${base}${ext}`;
}

/** 씬에 붙는 영상 — 정리본이 있으면 그것, 없으면 원본 */
function sceneVideo(scene: Script['scenes'][number], clips: Clip[], jobDir: string): string | null {
  if (!scene.clipRef) return null;
  const clip = clips.find((c) => c.id === scene.clipRef!.clipId);
  if (!clip) return null;
  const clean = clip.cleanVersions.find((v) => v.v === clip.currentCleanVersion);
  return clean?.filePath ?? path.join(jobDir, 'sources', `${clip.sourceId}.mp4`);
}

/**
 * 캡컷 묶음에 담을 것들.
 *
 * 자막은 SRT로 넣는다 — 캡컷이 자막 트랙으로 바로 읽는다. 시각은 조립과 같은 계산을
 * 써야 편집기에서 밀리지 않으므로 나레이션 길이를 누적해 잡는다.
 */
export function planCapcut(input: CapcutInput): CapcutItem[] {
  const { settings, job, productName, jobDir, script, timings, clips } = input;
  const assets = input.assets ?? [];
  const items: CapcutItem[] = [];
  const cues: SubCue[] = [];
  const lines: string[] = [
    `# ${script.title || job.title} — 캡컷 재료`,
    '',
    '이 폴더를 통째로 캡컷에 끌어다 놓으세요. **파일 이름 순서가 곧 씬 순서입니다.**',
    '',
    '| 씬 | 길이 | 나레이션 | 자막 |',
    '|---|---|---|---|',
  ];

  let cursor = 0;
  // 안내문이 없는 폴더를 설명하지 않게 실제로 담긴 영상 수를 센다 (아래 주석)
  let videoCount = 0;
  for (const [i, scene] of script.scenes.entries()) {
    const timing = timings[i];
    const dur = timing?.duration ?? scene.durationHint ?? 0;

    const video = sceneVideo(scene, clips, jobDir);
    if (video) {
      videoCount++;
      items.push({ name: `01_영상/${no(i)}_${scene.sceneId}.mp4`, src: video });
    }
    if (timing) {
      items.push({
        name: `02_음성/${no(i)}_${scene.sceneId}${path.extname(timing.audioFile)}`,
        src: path.join(jobDir, 'voice', timing.audioFile),
      });
    }
    const text = scene.subtitle || scene.narration;
    // 캡컷 SRT도 같은 규칙 — 웹 조립과 자막이 어긋나면 안 된다
    if (text) cues.push(...splitLines(wrapKorean(text, Math.min(settings.subtitleMaxChars, subtitleCharsPerLine(settings.subtitleFontSize))), cursor, dur));
    cursor += dur;

    lines.push(`| ${no(i)} | ${dur.toFixed(1)}초 | ${scene.narration} | ${scene.subtitle} |`);
  }

  items.push({ name: '03_자막/자막.srt', text: buildSrt(cues) });

  lines.push('');
  lines.push(`총 길이 약 ${cursor.toFixed(1)}초`);
  lines.push('');
  /*
    🔴 **없는 폴더를 설명하지 않는다** (2026-08-27 검증 지적).

    씬 이미지로 만든 편은 `sceneVideo()`가 늘 `null`이라 `01_영상/`이 통째로 안 생기는데,
    안내문은 「`01_영상` — 씬 순서대로」라고 **있다고 적어 뒀다.** 사용자는 영상이 든
    줄 알고 풀었다가 소리만 있는 것을 본다 — 「안 담긴다」보다 **「담겼다고 안내한다」가
    더 나쁘다**(기록이 실물과 갈린다).

    **씬 이미지를 묶음에 담을지는 설계 판단이라 이번에 넓히지 않았다** (`TODO.md` 1-1).
    대신 왜 비었는지와 어디서 받는지를 안내문이 말한다.
  */
  const sceneImages = script.scenes.filter((s) => s.imageRef).length;
  if (videoCount) {
    lines.push('- `01_영상` — 씬 순서대로. 정리본(자막·워터마크 지운 것)이 있으면 그쪽입니다');
  } else if (sceneImages) {
    lines.push(`- **영상 재료가 없습니다** — 이 편은 씬 이미지 ${sceneImages}장으로 만든 편입니다.`);
    lines.push('  그림은 이 묶음에 안 들어갑니다. 「제품 폴더로 내보내기」의 `이미지` 폴더에서 받거나,');
    lines.push('  웹 자동 조립으로 완성본을 만드세요');
  }
  lines.push('- `02_음성` — 씬별 나레이션. 영상이 있으면 번호가 짝입니다');
  lines.push('- `03_자막` — SRT. 캡컷에서 자막 트랙으로 바로 읽힙니다');
  /*
    편집 재료는 **번호를 안 붙인다.** 씬 폴더는 이름이 곧 순서지만 짤방·효과음은
    타임라인에 자동으로 얹힐 것이 아니라 사람이 필요할 때 골라 쓰는 것이다.
    번호를 붙이면 씬과 짝인 것처럼 보여 오히려 헷갈린다.
  */
  const memes = assets.filter((a) => a.kind === 'meme');
  const sfx = assets.filter((a) => a.kind === 'sfx');
  for (const a of memes) {
    items.push({ name: `04_짤방/${assetFileName(a)}`, src: fromWorkspaceRel(a.file) });
  }
  for (const a of sfx) {
    items.push({ name: `05_효과음/${assetFileName(a)}`, src: fromWorkspaceRel(a.file) });
  }
  if (memes.length) lines.push(`- \`04_짤방\` — 담아둔 ${memes.length}개. 필요한 자리에 직접 얹으세요`);
  if (sfx.length) lines.push(`- \`05_효과음\` — 담아둔 ${sfx.length}개`);

  /*
    🔴 **출처 대장을 같이 넣는다** (2026-08-26 사용자 결정).

    조립 게이트(`assetLogError`)는 **웹 자동 조립 한 갈래에만** 걸린다. 캡컷 갈래는
    막지 않기로 했으므로 — 사람이 편집기에서 직접 고르고 바꾸는 길이다 — 대신
    **무엇을 어디서 받아 썼는지가 재료와 같이 나가야** 한다. 안 그러면 정책이 있는
    갈래와 없는 갈래가 갈려 발행 뒤 되짚을 근거가 한쪽에만 남는다.

    출처가 없는 자료는 빈 칸이 아니라 **「미기록」**으로 나간다 — 빈 칸은
    「신고할 것이 없음」으로 읽힌다.

    `변형` 칸은 **앱이 거는 값이 아니다.** 캡컷 재료는 좌우반전·그레이딩·확대가 안 걸린
    원본이고 그 작업을 편집기에서 사람이 한다 — 설정값을 적으면 그 자체가 거짓말이 된다.
  */
  /*
    🔴 **대장은 묶음에 든 것보다 넓다** (2026-08-27). 씬 이미지는 이 묶음에 안 담기는데도
    여기 실린다 — 그 편이 실제로 그 그림으로 나가기 때문이다. 담긴 것만 신고하면
    이미지로 만든 편에는 **대장이 아예 안 붙어**, 출처를 다 적어 놓고도 그 기록이
    묶음에서 사라진다 (검증 실측: 이미지 편 묶음에 CSV가 없었다).
  */
  const ledger = input.ledger ?? assets;
  if (ledger.length) {
    items.push({
      name: `업로드킷/${exportFileName(productName, job.title, '에셋출처.csv')}`,
      text: assetLedgerCsv(assetLedgerRows(ledger, '없음 (캡컷에서 직접 겁니다)')),
    });
    lines.push('- `업로드킷/…에셋출처.csv` — 이 편이 쓴 소재의 출처 대장'
      + ' (묶음에 안 담긴 씬 이미지도 실립니다). 「미기록」이 있으면 자료실에서 채우세요');
  }

  lines.push('');
  lines.push('좌우반전·색보정·확대는 캡컷에서 직접 거세요. 웹에서 합치면 설정값이 자동으로 걸립니다.');
  items.push({ name: '읽어보세요.md', text: lines.join('\n') });

  // 업로드킷도 같이 — 편집이 끝나면 바로 올려야 한다
  items.push({
    name: `업로드킷/${exportFileName(productName, job.title, '업로드킷.md')}`,
    src: path.join(jobDir, 'output', 'upload-kit.md'),
  });
  return items;
}
