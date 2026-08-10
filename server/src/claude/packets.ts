import path from 'node:path';
import fsp from 'node:fs/promises';
import { PacketSchema, type Packet, type Product, type Clip } from '@shared/types';
import { PACKET_KIND_LABELS, charBudget, type PacketKind, type Menu } from '@shared/constants';
import { paths, toWorkspaceRel, WORKSPACE_ROOT, loadSettings } from '../store/workspace.js';
import { ensureDir, listDirs, readJson, writeJsonAtomic } from '../util/fsx.js';
import { nextSeqId } from '../util/ids.js';
import { readAllGuidelines, readProduct, listProductFiles } from '../store/projects.js';
import { getFormat } from '../store/formats.js';
import { type JobRef, listClips, logJobEvent } from '../store/jobs.js';
import { broadcast } from '../sse.js';

/** 패킷 인덱스 (부팅 시 스캔으로 재구성) */
const packetIndex = new Map<string, string>(); // packetId → packet.json 절대경로 dir

export function resolvePacketDir(packetId: string): string | null {
  return packetIndex.get(packetId) ?? null;
}

export async function scanPackets(): Promise<void> {
  packetIndex.clear();
  for (const menu of ['menu-a', 'menu-b'] as Menu[]) {
    const projectDirs = await listDirs(paths.menu(menu));
    for (const projectId of projectDirs) {
      if (projectId === 'formats') continue;
      const jobDirs = await listDirs(paths.jobs(menu, projectId));
      for (const jobId of jobDirs) {
        const reqRoot = path.join(paths.job(menu, projectId, jobId), 'requests');
        for (const pid of await listDirs(reqRoot)) {
          packetIndex.set(pid, path.join(reqRoot, pid));
        }
      }
    }
  }
  // 포맷 생성 패킷 (menu-b/formats/_requests)
  const formatReqRoot = path.join(paths.formats(), '_requests');
  for (const pid of await listDirs(formatReqRoot)) {
    packetIndex.set(pid, path.join(formatReqRoot, pid));
  }
}

export async function readPacket(packetId: string): Promise<Packet | null> {
  const dir = resolvePacketDir(packetId);
  if (!dir) return null;
  const raw = await readJson<unknown>(path.join(dir, 'packet.json'));
  const parsed = PacketSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writePacket(packet: Packet): Promise<void> {
  const dir = resolvePacketDir(packet.id);
  if (!dir) throw new Error(`패킷 없음: ${packet.id}`);
  await writeJsonAtomic(path.join(dir, 'packet.json'), PacketSchema.parse(packet));
  broadcast('packet', { packetId: packet.id, status: packet.status, kind: packet.kind });
}

export async function listAllPackets(): Promise<Packet[]> {
  const out: Packet[] = [];
  for (const id of packetIndex.keys()) {
    const p = await readPacket(id);
    if (p) out.push(p);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── 요청서 생성 ───────────────────────────────────────────────────

interface CreatePacketOptions {
  kind: PacketKind;
  jobRef?: JobRef;
  formatId?: string;
  /** revision 패킷: 반려 사유 + 이전 결과 경로 */
  revisionNote?: string;
  previousPacketId?: string;
  /** format-create: 마법사에서 수집한 답변 */
  wizardAnswers?: Record<string, string>;
}

export async function createPacket(opts: CreatePacketOptions): Promise<Packet> {
  const { kind, jobRef } = opts;

  let dir: string;
  let existingIds: string[];
  if (jobRef) {
    const reqRoot = path.join(paths.job(jobRef.menu, jobRef.projectId, jobRef.jobId), 'requests');
    existingIds = await listDirs(reqRoot);
    const id = nextSeqId('p', existingIds, kind);
    dir = path.join(reqRoot, id);
  } else {
    const reqRoot = path.join(paths.formats(), '_requests');
    existingIds = await listDirs(reqRoot);
    const id = nextSeqId('p', existingIds, kind);
    dir = path.join(reqRoot, id);
  }
  const id = path.basename(dir);

  await ensureDir(path.join(dir, 'context'));
  await ensureDir(path.join(dir, 'result'));

  const resultSpec = RESULT_SPECS[kind];
  const packet = PacketSchema.parse({
    id,
    jobId: jobRef?.jobId,
    projectId: jobRef?.projectId,
    formatId: opts.formatId,
    kind,
    status: 'waiting',
    dir: toWorkspaceRel(dir),
    resultSpec,
    createdAt: new Date().toISOString(),
    validationErrors: [],
  });

  packetIndex.set(id, dir);
  const requestMd = await buildRequestMd(packet, opts);
  await fsp.writeFile(path.join(dir, 'request.md'), requestMd, 'utf8');
  await writeJsonAtomic(path.join(dir, 'packet.json'), packet);

  if (jobRef) {
    await logJobEvent(jobRef, { type: 'packet.created', packetId: id, kind });
  }
  broadcast('packet', { packetId: id, status: 'waiting', kind });
  return packet;
}

const RESULT_SPECS: Record<PacketKind, Array<{ file: string; schema: string }>> = {
  'product-extract': [{ file: 'product.json', schema: 'product' }],
  script: [{ file: 'script.json', schema: 'script' }],
  'format-create': [{ file: 'format.json', schema: 'format' }],
  'scene-images': [{ file: 'scenes.json', schema: 'json' }],
  'upload-kit': [{ file: 'upload-kit.md', schema: 'markdown' }],
  revision: [{ file: 'script.json', schema: 'script' }],
};

export interface PacketCommands {
  /** 단독 처리 — 빠르고 저렴 */
  fast: string;
  /** 에이전트 팀 처리 — 리서치·검수를 거쳐 품질이 높지만 느리고 토큰을 많이 쓴다 */
  quality: string;
}

/** Claude Code에서 실행할 명령 (UI 복사 버튼용) */
export function packetCommands(packet: Packet): PacketCommands {
  const dir = `workspace/${packet.dir.replace(/^\/?/, '')}`;
  return {
    fast: `claude "/answer-job ${dir}"`,
    quality: `claude "/shorts-content-team ${dir}"`,
  };
}

// ── request.md 빌더 ───────────────────────────────────────────────

async function buildRequestMd(packet: Packet, opts: CreatePacketOptions): Promise<string> {
  const lines: string[] = [];
  const label = PACKET_KIND_LABELS[packet.kind];
  lines.push(`# 요청서: ${label} (${packet.id})`);
  lines.push('');
  lines.push('> 이 문서는 어떤 AI로도 처리할 수 있는 자기완결 요청서입니다.');
  lines.push('> - **파일 접근이 가능한 도구**(Claude Code 등): 이 폴더의 `result/`에 산출물을 작성하고,');
  lines.push('>   마지막에 `result/.done` 빈 파일을 만드세요. 그 외 파일은 수정하지 마세요.');
  lines.push('> - **웹 챗 등 파일을 만들 수 없는 환경**(GPT·제미나이 웹 등): 산출물 내용을 응답 본문에');
  lines.push('>   그대로 출력하세요. 사용자가 앱에 붙여넣으면 앱이 파일로 저장합니다.');
  lines.push('');

  // ① 목적
  lines.push('## 1. 목적');
  lines.push(PURPOSES[packet.kind]);
  lines.push('');

  // ② 지침
  if (opts.jobRef) {
    const guidelines = await readAllGuidelines(opts.jobRef.menu, opts.jobRef.projectId);
    if (Object.keys(guidelines).length) {
      lines.push('## 2. 지침 (반드시 준수)');
      for (const [file, content] of Object.entries(guidelines)) {
        lines.push(`### ${file}`);
        lines.push(content.trim());
        lines.push('');
      }
    }
  }

  // ③ 제품 정보 / 포맷 / 컨텍스트
  if (opts.jobRef) {
    const product = await readProduct(opts.jobRef.menu, opts.jobRef.projectId);
    const productFiles = await listProductFiles(opts.jobRef.menu, opts.jobRef.projectId);
    lines.push('## 3. 제품 정보');
    if (product.name) {
      lines.push('```json');
      lines.push(JSON.stringify(product, null, 2));
      lines.push('```');
    } else {
      lines.push('(아직 product.json이 없습니다)');
    }
    if (productFiles.length) {
      lines.push('');
      lines.push('제품 상세페이지 첨부파일 (필요 시 Read로 확인):');
      const productDir = paths.product(opts.jobRef.menu, opts.jobRef.projectId);
      for (const f of productFiles) {
        lines.push(`- workspace/${toWorkspaceRel(path.join(productDir, f))}`);
      }
    }
    lines.push('');

    // menu-b: 포맷 정보 포함
    if (opts.jobRef.menu === 'menu-b') {
      const fmtId = opts.formatId;
      if (fmtId) {
        const fmt = await getFormat(fmtId);
        if (fmt) {
          lines.push('## 3-1. 고유 포맷 (이 포맷 구조를 그대로 따를 것)');
          lines.push('```json');
          lines.push(JSON.stringify(fmt, null, 2));
          lines.push('```');
          lines.push('');
        }
      }
    }
  }

  // ④ 소재 현황 (menu-a script 패킷)
  if (opts.jobRef && (packet.kind === 'script' || packet.kind === 'revision') && opts.jobRef.menu === 'menu-a') {
    const clips = await listClips(opts.jobRef);
    if (clips.length) {
      lines.push('## 4. 소재 현황 (다운로드된 클립)');
      lines.push('| 클립 ID | 길이(초) | 해상도 | 정리 상태 | 프레임 |');
      lines.push('|---|---|---|---|---|');
      for (const c of clips) {
        const cleaned = c.currentCleanVersion ? `정리본 v${c.currentCleanVersion}` : '원본';
        const frames = c.frames.slice(0, 3).map((f) => `workspace/${f}`).join('<br>');
        lines.push(
          `| ${c.id} | ${c.probe?.duration?.toFixed(1) ?? '?'} | ${c.probe ? `${c.probe.width}x${c.probe.height}` : '?'} | ${cleaned} | ${frames} |`,
        );
      }
      lines.push('');
      lines.push('프레임 이미지를 Read로 열어 실제 화면을 확인한 뒤, 각 씬의 `clipRef`에 어울리는 클립을 지정하세요.');
      lines.push('');
    }
  }

  // revision: 반려 사유
  if (packet.kind === 'revision' && opts.revisionNote) {
    lines.push('## 반려 사유 (이 피드백을 반영해 다시 작성)');
    lines.push(opts.revisionNote);
    if (opts.previousPacketId) {
      lines.push('');
      lines.push(`이전 결과: 같은 잡의 \`requests/${opts.previousPacketId}/result/\` 참조`);
    }
    lines.push('');
  }

  // format-create: 마법사 답변
  if (packet.kind === 'format-create' && opts.wizardAnswers) {
    lines.push('## 사용자 답변 (이를 바탕으로 포맷 설계)');
    for (const [q, a] of Object.entries(opts.wizardAnswers)) {
      lines.push(`- **${q}**: ${a}`);
    }
    lines.push('');
  }

  // ⑤ 산출물 명세
  lines.push('## 산출물 명세');
  lines.push('아래 산출물을 만드세요 (파일 접근이 가능하면 `result/`에 저장, 아니면 응답 본문에 출력):');
  for (const spec of packet.resultSpec) {
    lines.push(`- \`result/${spec.file}\``);
  }
  lines.push('');
  lines.push(OUTPUT_SPECS[packet.kind]);
  lines.push('');

  // ⑥ 검증 규칙
  lines.push('## 검증 규칙');
  // 분량 기준은 배속 설정에 따라 달라지므로 발행 시점의 값으로 치환한다
  const settings = await loadSettings();
  const budget = charBudget(settings.speechRate);
  lines.push(
    VALIDATION_RULES[packet.kind]
      .replace('{SPEECH_RATE}', String(settings.speechRate))
      .replace('{CHAR_MIN}', String(budget.min))
      .replace('{CHAR_MAX}', String(budget.max))
      .replace('{CHAR_REC}', String(budget.recommended)),
  );
  lines.push('');
  lines.push('---');
  lines.push('파일을 만들 수 있는 도구라면, 작성이 끝난 뒤 마지막에 `result/.done` 빈 파일을 생성하세요.');
  return lines.join('\n');
}

const PURPOSES: Record<PacketKind, string> = {
  'product-extract':
    '첨부된 쿠팡 상세페이지 자료(이미지/텍스트)를 읽고 제품 정보를 구조화된 product.json으로 추출한다.',
  script:
    '제품 정보와 지침, 확보된 영상 소재를 바탕으로 쇼핑쇼츠 대본을 작성한다. 각 씬에 사용할 클립을 지정한다.',
  'format-create':
    '사용자 답변을 바탕으로 제품정보리뷰 채널의 고유 포맷(구조/톤/씬 템플릿/브랜딩)을 설계한다.',
  'scene-images':
    '대본의 각 씬에 맞는 이미지 프롬프트(또는 이미지)를 만든다. 포맷의 imageStylePrompt를 일관되게 적용한다.',
  'upload-kit':
    '완성된 영상의 업로드 킷(제목 후보 5개, 설명, 해시태그, 썸네일 문구)을 작성한다.',
  revision: '반려 사유를 반영해 대본을 수정한다. 지침과 검증 규칙은 동일하게 적용된다.',
};

const OUTPUT_SPECS: Record<PacketKind, string> = {
  'product-extract': `product.json 스키마:
\`\`\`json
{
  "name": "제품명",
  "price": "가격 (예: 39,900원)",
  "url": "쿠팡 상품 URL (자료에 있으면)",
  "category": "카테고리",
  "features": ["핵심 기능"],
  "specs": { "사양명": "값" },
  "sellingPoints": ["구매 포인트 (쇼츠 훅으로 쓸 만한 것)"],
  "cautions": ["주의사항/단점 (있으면)"],
  "extractedFrom": ["근거가 된 첨부파일명"]
}
\`\`\``,
  script: `script.json 스키마:
\`\`\`json
{
  "title": "영상 가제",
  "scenes": [
    {
      "sceneId": "s01",
      "narration": "나레이션 문장 (TTS로 읽힘)",
      "subtitle": "화면 자막 (짧게, 나레이션과 달라도 됨)",
      "clipRef": { "clipId": "c01", "suggestedSegment": { "in": 3.0, "out": 7.5 } },
      "durationHint": 5
    }
  ],
  "notes": "선택: 편집자 메모"
}
\`\`\`
- menu-b(제품정보리뷰) 잡이면 clipRef 대신 "imagePrompt"에 씬 이미지 프롬프트를 쓴다.`,
  'format-create': `format.json 스키마 — FormatSchema (shared/types.ts 참조):
\`\`\`json
{
  "name": "포맷 이름",
  "version": 1,
  "structure": { "hook": "훅 패턴", "beats": [{ "name": "비트명", "purpose": "역할", "secondsHint": 5 }], "cta": "CTA 패턴" },
  "tone": { "persona": "화자 캐릭터", "speechLevel": "해요체", "bannedWords": [] },
  "sceneTemplate": { "layout": "레이아웃 규칙", "imageStylePrompt": "이미지 스타일 프롬프트", "subtitleStyle": "자막 스타일", "transition": "전환 규칙" },
  "branding": { "channelName": "채널명", "colorPalette": ["#000000"], "watermarkText": "" },
  "typecastVoiceId": ""
}
\`\`\``,
  'scene-images': `scenes.json: [{ "sceneId": "s01", "imagePrompt": "...", "negativePrompt": "..." }] 배열.
이미지를 직접 생성할 수 있으면 result/에 s01.png 형식으로 저장하고 scenes.json에 "imageFile": "s01.png"를 추가.`,
  'upload-kit': `upload-kit.md 구성: ## 제목 후보 (5개) / ## 설명 / ## 해시태그 / ## 썸네일 문구.
설명 마지막 줄에 쿠팡파트너스 공시문구를 반드시 포함:
"이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."`,
  revision: '수정된 script.json (script 패킷과 동일 스키마)',
};

const VALIDATION_RULES: Record<PacketKind, string> = {
  'product-extract': '- 첨부 자료에 없는 사실을 지어내지 않는다\n- 효능/성능 주장은 자료 원문 근거가 있는 것만 포함',
  script: `- **30초 이내로 끝낸다.** {SPEECH_RATE}배속 낭독 기준 한국어 {CHAR_MIN}~{CHAR_MAX}자 (권장 {CHAR_REC}자)
- 씬 4~5개, 씬당 35~45자. 반전은 1개에 집중 (짧은 분량에 2개를 넣으면 둘 다 약해진다)
- 원본 영상의 문장을 그대로 옮기지 않는다 (구조만 참고)
- 과장 금지: "무조건", "100%", "기적", "완치" 등 사용 금지
- 첫 씬은 3초 훅
- 마지막 씬에 CTA 1문장`,
  'format-create': '- 다른 채널을 그대로 베끼지 않는 고유한 구조일 것\n- beats의 secondsHint 합이 45~55초일 것',
  'scene-images': '- 모든 씬에 동일한 스타일 프롬프트 접두어 적용 (일관성)\n- 실존 인물/브랜드 로고 묘사 금지',
  'upload-kit': '- 제목에 낚시성 허위 표현 금지\n- 공시문구 필수 포함',
  revision: '- script 패킷과 동일한 검증 규칙 + 반려 사유 반영 여부',
};
