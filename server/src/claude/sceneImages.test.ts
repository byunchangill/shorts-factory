import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
// 정책은 작업공간을 안 보므로 static import다 (아래 넷만 로드 순서를 탄다)
import * as policy from '@shared/assetPolicy';

/**
 * 씬 이미지 배선 — `result/scenes.json` → 대본 씬의 `imageRef` (2026-08-26).
 *
 * **이 경로는 반만 배선돼 있었다.** `imageRef`를 읽는 코드는 조립뿐이고 채우는 코드가
 * 없어서, 요청서가 이미지를 만들어 놔도 화면에도 조립에도 안 나타났다. 여기서 고정하는 것:
 *
 * 1. 이으면 붙는다 / 어긋나면 **거부한다** (조용히 버리지 않는다)
 * 2. 실물이 있으면 출처가 있어야 한다 — **AI 생성이 정상 경로다**
 * 3. 옛 대본(`imageRef`가 경로 문자열)이 그대로 열린다
 * 4. 요청서 결과는 **한 번만** 반영된다
 */

/*
  이 파일은 임시 폴더에 진짜 파일을 쓰는 통합 검사라 한 건이 수백 ms다.
  윈도우에서는 백신이 임시 폴더를 훑느라 한 번씩 1초를 넘겨서, 기본 5초로는 **결함이
  아닌 이유로** 빨개진다 (실측: 같은 호출이 13ms ~ 1128ms). 넉넉히 잡는다.
*/
vi.setConfig({ testTimeout: 30_000 });

let tmp: string;
let jobs: typeof import('../store/jobs.js');
let projects: typeof import('../store/projects.js');
let packets: typeof import('./packets.js');
let watcher: typeof import('./resultWatcher.js');
/** 카테고리는 한 번만 만든다 (아래 `seed` 주석) */
let projectId: string;
let jobSeq = 1;

/** 1×1 PNG — 진짜 파일이 있어야 「없는 파일을 가리키는가」 검사가 뜻을 갖는다 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'scene-images-'));
  process.env.SHORTS_WORKSPACE = tmp;
  // WORKSPACE_ROOT는 모듈 로드 시점에 정해진다 — 환경변수를 먼저 세운 뒤 불러온다
  [jobs, projects, packets, watcher] = await Promise.all([
    import('../store/jobs.js'),
    import('../store/projects.js'),
    import('./packets.js'),
    import('./resultWatcher.js'),
  ]);
});

/*
  검사마다 작업공간을 비운다. 격리 자체는 잡 id가 달라 이미 되지만, 폴더가 쌓일수록
  파일 I/O가 눈에 띄게 느려진다 (위 지터와 겹치면 30초 상한도 위태롭다).
*/
beforeEach(async () => {
  await fsp.rm(path.join(tmp, 'menu-b'), { recursive: true, force: true });
  await jobs.scanJobs();
  await packets.scanPackets();
  projectId = (await projects.createProject('menu-b', '씬이미지제품')).id;
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
  delete process.env.SHORTS_WORKSPACE;
});


interface Seeded {
  ref: import('../store/jobs.js').JobRef;
  jobDir: string;
}

/**
 * menu-b 잡 + 그 씬 이름들로 된 대본 v1.
 *
 * 🔴 **씬 이름을 부를 때 정할 수 있어야 한다.** 대본은 앱 밖에서 오고 스키마가 `z.string()`이라
 * 위험한 이름도 저장된다 — 그걸 심을 수 없으면 실패 경로 검사를 못 짠다.
 */
async function seedWith(sceneIds: string[]): Promise<Seeded> {
  const job = await jobs.createJob('menu-b', projectId, `편${jobSeq++}`);
  const ref = { menu: 'menu-b' as const, projectId, jobId: job.id };
  await jobs.writeScriptVersion(ref, {
    title: '테스트',
    notes: '',
    scenes: sceneIds.map((sceneId, i) => ({
      sceneId, narration: '한 문장', subtitle: '한 문장', isDownside: i === sceneIds.length - 1,
    })),
  });
  return { ref, jobDir: path.join(tmp, 'menu-b', projectId, 'jobs', job.id) };
}

/** 씬 셋짜리 기본 대본 */
const seed = () => seedWith(['s01', 's02', 's03']);

/** 씬 이미지 요청서를 만들고 `result/`에 산출물을 심는다 (`.done`은 안 만든다 — 직접 부른다) */
async function publishResult(
  seeded: Seeded,
  scenes: unknown,
  files: Record<string, Buffer> = {},
): Promise<string> {
  const packet = await packets.createPacket({ kind: 'scene-images', jobRef: seeded.ref });
  const resultDir = path.join(tmp, packet.dir, 'result');
  await fsp.mkdir(resultDir, { recursive: true });
  await fsp.writeFile(path.join(resultDir, 'scenes.json'), JSON.stringify(scenes), 'utf8');
  for (const [name, data] of Object.entries(files)) {
    await fsp.writeFile(path.join(resultDir, name), data);
  }
  return packet.id;
}

/** 출처를 다 갖춘 항목 하나. 검사마다 한 군데씩만 망가뜨린다 */
function entry(patch: Record<string, unknown> = {}) {
  return {
    sceneId: 's01',
    imagePrompt: '밝은 주방',
    imageFile: 's01.png',
    sourceUrl: 'https://pixabay.com/photos/kitchen-1/',
    downloadedAt: '2026-08-26',
    hasFace: false,
    ...patch,
  };
}

async function errorsOf(packetId: string): Promise<string[]> {
  const p = await packets.readPacket(packetId);
  return p?.validationErrors ?? [];
}

describe('씬 이미지 배선 — 이으면 붙는다', () => {
  it('scenes.json의 imageFile이 그 씬의 imageRef가 된다', async () => {
    const s = await seed();
    const pid = await publishResult(s, [entry()], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);

    expect(await errorsOf(pid)).toEqual([]);
    const script = await jobs.readScript(s.ref, 1);
    const ref = script!.scenes.find((x) => x.sceneId === 's01')!.imageRef;
    expect(ref?.sourceUrl).toBe('https://pixabay.com/photos/kitchen-1/');
    expect(ref?.hasFace).toBe(false);
    // 이미지를 안 낸 씬은 안 건드린다
    expect(script!.scenes.find((x) => x.sceneId === 's02')!.imageRef).toBeUndefined();
  });

  /*
    🔴 **요청서 폴더가 아니라 잡의 `scenes/`를 가리켜야 한다.** `result/`는 AI의 작업
    자리라 요청서를 다시 발행하거나 지우면 사라진다 — 대본이 가리키는 파일이 그렇게
    사라지면 조립이 통째로 막힌다. 업로드 킷이 `output/`으로 복사되는 것과 같은 결이다.
  */
  it('이미지를 잡의 scenes/로 옮기고 그 경로를 가리킨다', async () => {
    const s = await seed();
    const pid = await publishResult(s, [entry()], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);

    const script = await jobs.readScript(s.ref, 1);
    const file = script!.scenes[0].imageRef!.file;
    expect(file).toContain('/scenes/');
    expect(file).not.toContain('requests');
    // 상대경로가 실물을 가리키는가 — 기록과 실물이 갈리면 조립이 날것의 ffmpeg 오류로 죽는다
    const abs = path.join(tmp, file);
    expect(await fsp.readFile(abs)).toEqual(PNG);
  });

  /** 작업공간 규칙 — 덮어쓰지 않고 `_v{n}`으로 쌓는다. 옛 판의 대본이 가리키던 그림이 남는다 */
  it('같은 씬 이미지를 다시 받으면 _v2로 쌓이고 옛 파일이 남는다', async () => {
    const s = await seed();
    await watcher.ingestPacketResult(await publishResult(s, [entry()], { 's01.png': PNG }));
    const first = (await jobs.readScript(s.ref, 1))!.scenes[0].imageRef!.file;

    await watcher.ingestPacketResult(await publishResult(s, [entry()], { 's01.png': PNG }));
    const second = (await jobs.readScript(s.ref, 1))!.scenes[0].imageRef!.file;

    expect(first).toContain('s01_v1.png');
    expect(second).toContain('s01_v2.png');
    expect(await fsp.readFile(path.join(tmp, first))).toEqual(PNG); // 옛 파일이 그대로 있다
  });

  /**
   * 🔴 대본은 **판을 가르지 않는다.** `writeScriptVersion`을 쓰면 승인이 풀려
   * 그 잡이 음성 단계에서 뒤로 밀린다 — 바뀐 것은 문장이 아니라 붙는 재료다.
   */
  it('대본 버전이 안 올라가고 승인 상태도 안 흔들린다', async () => {
    const s = await seed();
    await jobs.mutateJob(s.ref, (j) => { j.script.approved = true; });
    const pid = await publishResult(s, [entry()], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);

    const job = await jobs.readJob(s.ref);
    expect(job!.script.currentVersion).toBe(1);
    expect(job!.script.approved).toBe(true);
  });

  /** 프롬프트만 낸 결과는 옛 요청서의 정상 모양이다 — 여기서 막으면 하위호환이 깨진다 */
  it('프롬프트만 있는 옛 형식 결과는 그대로 통과하고 대본을 안 건드린다', async () => {
    const s = await seed();
    const pid = await publishResult(s, [
      { sceneId: 's01', imagePrompt: '밝은 주방', negativePrompt: '흐릿함' },
      { sceneId: 's02', imagePrompt: '서랍 안쪽' },
    ]);
    await watcher.ingestPacketResult(pid);

    expect(await errorsOf(pid)).toEqual([]);
    const script = await jobs.readScript(s.ref, 1);
    expect(script!.scenes.every((x) => x.imageRef === undefined)).toBe(true);
  });
});

describe('씬 이미지 배선 — 어긋나면 거부한다', () => {
  /*
    🔴 **조용히 버리지 않는다.** 버리면 사용자는 「반영됨」만 보고 이미지가 왜 안 붙는지
    모른다. `scriptRuleErrors`(단점 씬 누락)와 같은 태도다.
  */
  it('대본에 없는 씬을 가리키면 거부하고 아무것도 안 붙인다', async () => {
    const s = await seed();
    const pid = await publishResult(s,
      [entry(), entry({ sceneId: 's99', imageFile: 'x.png' })], { 's01.png': PNG, 'x.png': PNG });
    await watcher.ingestPacketResult(pid);

    const errors = await errorsOf(pid);
    expect(errors.join(' ')).toContain('s99');
    expect(errors.join(' ')).toContain('s01'); // 있는 씬을 알려줘야 고칠 수 있다
    // 🔴 한 항목이 틀리면 **전부** 안 붙는다 — 반쯤 붙으면 무엇이 반영됐는지 알 수 없다
    const script = await jobs.readScript(s.ref, 1);
    expect(script!.scenes.every((x) => x.imageRef === undefined)).toBe(true);
  });

  it('출처 URL이 없으면 거부한다', async () => {
    const s = await seed();
    const pid = await publishResult(s, [entry({ sourceUrl: undefined })], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);
    expect((await errorsOf(pid)).join(' ')).toContain('출처 URL');
  });

  /** 🔴 `hasFace` 미표시는 「인물 없음」이 아니라 「안 봤음」이다 */
  it('인물 표시를 빠뜨리면 거부한다', async () => {
    const s = await seed();
    const pid = await publishResult(s, [entry({ hasFace: undefined })], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);
    expect((await errorsOf(pid)).join(' ')).toContain('인물 포함 여부');
  });

  it('식별 가능한 인물이 있으면 거부한다 — 자료실과 같은 규칙이다', async () => {
    const s = await seed();
    const pid = await publishResult(s, [entry({ hasFace: true })], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);
    expect((await errorsOf(pid)).join(' ')).toContain('초상권');
  });

  it('블랙리스트에서 받은 그림은 거부한다', async () => {
    const s = await seed();
    const pid = await publishResult(s,
      [entry({ sourceUrl: 'https://pinterest.com/pin/1' })], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);
    expect((await errorsOf(pid)).join(' ')).toContain('핀터레스트');
  });

  /*
    🔴 **기록이 실물과 갈리는 것을 여기서 막는다.** 없는 파일을 가리키는 `imageRef`를
    적어 두면 화면에는 「이미지 있음」인데 조립이 날것의 ffmpeg 오류로 죽는다.
  */
  it('scenes.json만 있고 그림이 없으면 거부한다', async () => {
    const s = await seed();
    const pid = await publishResult(s, [entry()]); // 파일을 안 심는다
    await watcher.ingestPacketResult(pid);
    expect((await errorsOf(pid)).join(' ')).toContain('파일이 없습니다');
  });

  /** 이 값은 앱 밖에서 온다 — 그대로 경로에 붙으면 작업공간 밖을 읽는다 */
  it('폴더를 벗어나는 파일명은 거부한다', async () => {
    const s = await seed();
    for (const bad of ['../../settings.json.png', 'sub/s01.png', '..\\x.png']) {
      const pid = await publishResult(s, [entry({ imageFile: bad })]);
      await watcher.ingestPacketResult(pid);
      expect((await errorsOf(pid)).join(' ')).toContain('result/ 바로 아래');
    }
  });

  it('그림이 아닌 파일은 거부한다', async () => {
    const s = await seed();
    const pid = await publishResult(s, [entry({ imageFile: 's01.svg' })], { 's01.svg': PNG });
    await watcher.ingestPacketResult(pid);
    expect((await errorsOf(pid)).join(' ')).toContain('그림 파일이 아닙니다');
  });

  it('같은 씬이 두 번 나오면 거부한다 — 어느 쪽을 쓸지 알 수 없다', async () => {
    const s = await seed();
    const pid = await publishResult(s,
      [entry(), entry({ imageFile: 'b.png' })], { 's01.png': PNG, 'b.png': PNG });
    await watcher.ingestPacketResult(pid);
    expect((await errorsOf(pid)).join(' ')).toContain('두 번');
  });

  it('대본이 아직 없으면 거부하고 이유를 말한다', async () => {
    const job = await jobs.createJob('menu-b', projectId, `대본없음${jobSeq++}`);
    const ref = { menu: 'menu-b' as const, projectId, jobId: job.id };
    const pid = await publishResult({ ref, jobDir: '' }, [entry()], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);
    expect((await errorsOf(pid)).join(' ')).toContain('대본이 아직 없습니다');
  });
});

describe('AI 생성 이미지가 정상 경로다', () => {
  /*
    🔴 정책이 「인물이 필요하면 AI로 만든 그림을 쓰라」고 말한다. 그 그림에는 받아온
    페이지가 없으므로, `sourceUrl`을 URL로만 받으면 **시키는 대로 한 결과가 늘 거부된다**.
  */
  it('출처가 AI생성이면 URL이 없어도 통과한다', async () => {
    const s = await seed();
    const pid = await publishResult(s,
      [entry({ sourceUrl: policy.AI_GENERATED, license: '어떤 모델' })], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);

    expect(await errorsOf(pid)).toEqual([]);
    const script = await jobs.readScript(s.ref, 1);
    expect(script!.scenes[0].imageRef!.sourceUrl).toBe(policy.AI_GENERATED);
  });

  /** 자료실과 **같은 판정 함수**를 쓴다 — 두 벌이면 한쪽만 AI를 알아본다 */
  it('자료실 쪽도 같은 값을 알아본다', () => {
    expect(policy.classifySource(policy.AI_GENERATED).kind).toBe('ai');
    expect(policy.assetPolicyProblems({
      id: 'local:memes/a.gif', title: 'a', sourceUrl: policy.AI_GENERATED, hasFace: false,
    })).toEqual([]);
  });
});

describe('하위호환 — 옛 대본이 그대로 열린다', () => {
  /*
    🔴 실제 파일로 확인한다. 기존 `script_v{n}.json`은 `imageRef`가 경로 문자열이거나
    아예 없다 — 안 열리면 그 잡은 화면에서도 조립에서도 통째로 막힌다.
  */
  it('imageRef가 경로 문자열인 옛 대본 파일이 객체로 승격돼 읽힌다', async () => {
    const s = await seed();
    const file = jobs.scriptPath(s.ref, 1);
    await fsp.writeFile(file, JSON.stringify({
      version: 1,
      title: '옛 대본',
      notes: '',
      scenes: [
        { sceneId: 's01', narration: 'ㄱ', subtitle: 'ㄱ', imageRef: 'menu-b/제품/jobs/j1/scenes/s01.png' },
        { sceneId: 's02', narration: 'ㄴ', subtitle: 'ㄴ' },
      ],
    }), 'utf8');

    const script = await jobs.readScript(s.ref, 1);
    expect(script).not.toBeNull();
    expect(script!.scenes[0].imageRef).toEqual({ file: 'menu-b/제품/jobs/j1/scenes/s01.png' });
    expect(script!.scenes[1].imageRef).toBeUndefined();
  });

  /**
   * 🔴 승격이 **출처를 지어내지 않는다.** 「기록이 없다」를 「기록이 있다」로 바꿔 주면
   * 게이트가 통째로 죽는다 — 옛 이미지는 막히고, 요청서를 다시 받아 고친다.
   */
  it('승격된 옛 이미지는 출처가 없어 조립 게이트에 걸린다', async () => {
    const s = await seed();
    const file = jobs.scriptPath(s.ref, 1);
    await fsp.writeFile(file, JSON.stringify({
      version: 1, title: '옛 대본', notes: '',
      scenes: [{ sceneId: 's01', narration: 'ㄱ', subtitle: 'ㄱ', imageRef: 'x/s01.png' }],
    }), 'utf8');

    const script = await jobs.readScript(s.ref, 1);
    const why = policy.assetLogError('menu-b', policy.sceneImageSubjects(script!.scenes));
    expect(why).toContain('씬 s01 이미지');
    expect(why).toContain('출처 URL');
  });

  it('새로 붙인 imageRef도 다시 읽으면 그대로다 (쓰기-읽기 왕복)', async () => {
    const s = await seed();
    await watcher.ingestPacketResult(await publishResult(s, [entry()], { 's01.png': PNG }));
    const again = await jobs.readScript(s.ref, 1);
    expect(again!.scenes[0].imageRef!.downloadedAt).toBe('2026-08-26');
  });
});

/*
  🔴 **이 두 검사는 성공 경로만 밟던 그물이 놓친 자리다** (2026-08-26 리뷰).
  646개 단위 검사와 48단계 하네스가 둘 다 초록인 채로 지나갔다 — 둘 다 「복사가 다 성공하고
  씬 이름이 멀쩡한」 길만 지나기 때문이다. 실패 경로에 그물을 따로 놓는다.
*/
describe('씬 이미지 배선 — 실패 경로', () => {
  /*
    씬 이름이 그대로 파일명이 된다(`{sceneId}_v{n}.png`). 대본은 앱 밖에서 오고
    `SceneLineSchema.sceneId`는 `z.string()`이라, 「대본에 있으니 안전하다」가 성립하지 않는다.

    막는 이유는 보안보다 **「기록이 실물과 갈린다」**가 먼저다 — `planExport`는 잡의
    `scenes/`만 훑으므로 그림이 그 밖에 있으면 완성본에는 깔리는데 내보내기 폴더에는 없다.
  */
  /*
    🔴 **한 칸만 벗어나는 것으로 잰다.** 「작업공간 밖」까지 나가는 이름으로 재려다
    검사가 스스로 격리를 깼다 — 앞선 실험이 `%TEMP%`에 남긴 파일 때문에 **고친 뒤에도
    빨개졌다.** 자기 tmp 밖을 보는 단언은 남의 찌꺼기를 자기 결함으로 읽는다.

    `scenes/`에서 한 칸만 올라가면 **잡 폴더**이고 그건 이 검사의 tmp 안이다. 그리고
    실제로 아픈 곳이 정확히 거기다 — `planExport`는 `scenes/` **폴더만** 훑으므로,
    한 칸만 벗어나도 완성본에 깔린 그림이 내보내기 「이미지」 폴더에 안 나간다.
  */
  it('씬 이름이 scenes/ 밖을 가리키면 거부하고 그 자리에 파일을 안 만든다', async () => {
    const escaped = '../ESCAPED';
    const s = await seedWith([escaped]);
    const pid = await publishResult(s, [entry({ sceneId: escaped })], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);

    expect((await errorsOf(pid)).join(' ')).toContain('경로 구분자');
    // 🔴 사유만 맞고 파일이 생기면 아무 소용이 없다 — 실물을 본다
    await expect(fsp.access(path.join(s.jobDir, 'ESCAPED_v1.png'))).rejects.toThrow();
    expect(await fsp.readdir(path.join(s.jobDir, 'scenes')).catch(() => [])).toEqual([]);
    const script = await jobs.readScript(s.ref, 1);
    expect(script!.scenes[0].imageRef).toBeUndefined();
  });

  it('씬 이름에 경로 구분자가 있어도 거부한다', async () => {
    for (const bad of ['a/b', 'a\\b', '../../../../../../ESCAPED_OUT']) {
      const s = await seedWith([bad]);
      const pid = await publishResult(s, [entry({ sceneId: bad })], { 's01.png': PNG });
      await watcher.ingestPacketResult(pid);
      expect((await errorsOf(pid)).join(' ')).toContain('경로 구분자');
      expect(await fsp.readdir(path.join(s.jobDir, 'scenes')).catch(() => [])).toEqual([]);
    }
  });

  /*
    🔴 **복사 도중에 던져도 옮긴 그림이 남으면 안 된다.** 되돌리기가 대본 쓰기 실패
    한 갈래에만 걸려 있어 이 경로가 뚫려 있었다 (리뷰 실측). `copyFile` 실패는 도달 가능한
    경로다 — 이 저장소는 이미 윈도우 백신 때문에 `renameWithRetry`를 두고 있다.
  */
  /*
    🔴 **불변식으로 잰다: 성공하지 못한 반영은 그림을 하나도 안 남긴다.**

    처음에는 「복사 도중 실패」라는 **증상 하나**만 검사했다. 그래서 되돌리기를 `catch`로
    적었고, `mutateScript`가 `try` 밖이라 `writeJsonAtomic`(대본 쓰기)의 실패가 그대로
    새어 나갔다 — 두 장이 다 고아로 남았다 (2026-08-27 리뷰 탐침). 실패 지점을 표로 돌려
    **어디서 터지든** 같은 문장이 서는지 본다.
  */
  it.each([
    ['그림 복사(copyFile)', 'copyFile' as const],
    ['대본 쓰기(writeJsonAtomic)', 'rename' as const],
  ])('%s가 실패해도 그림을 하나도 안 남긴다', async (_label, where) => {
    const s = await seedWith(['s01', 's02', 's03']);
    const pid = await publishResult(s,
      ['s01', 's02', 's03'].map((id) => entry({ sceneId: id, imageFile: `${id}.png` })),
      { 's01.png': PNG, 's02.png': PNG, 's03.png': PNG });

    const boom = () => Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    let spy;
    if (where === 'copyFile') {
      // 둘째 장에서 백신·디스크 가득 참이 난 상황
      const real = fsp.copyFile;
      let n = 0;
      spy = vi.spyOn(fsp, 'copyFile').mockImplementation(async (from, to) => {
        if (++n === 2) throw boom();
        return real(from, to);
      });
    } else {
      /*
        복사는 다 끝나고 **대본 쓰기**에서 터진다. `writeJsonAtomic`은 임시 파일에 쓴 뒤
        rename하는데 그 rename이 던진다 — `readJson`과 달리 이쪽은 실패를 삼키지 않는다.
      */
      const real = fsp.rename;
      spy = vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
        if (String(to).includes('script_v')) throw boom();
        return real(from, to);
      });
    }
    await watcher.ingestPacketResult(pid);
    spy.mockRestore();

    // 🔴 불변식 — 어느 쪽에서 터졌든 `scenes/`가 아예 비어 있다
    expect(await fsp.readdir(path.join(s.jobDir, 'scenes')).catch(() => [] as string[])).toEqual([]);
    const script = await jobs.readScript(s.ref, 1);
    expect(script!.scenes.every((x) => x.imageRef === undefined)).toBe(true);
    // 그리고 실패가 기록에 남는다 — 조용히 성공한 척하지 않는다
    expect((await errorsOf(pid)).join(' ')).toContain('반영하지 못했습니다');
  });

  it('복사 도중 실패하면 이미 옮긴 그림까지 도로 치운다', async () => {
    const s = await seedWith(['s01', 's02', 's03']);
    const pid = await publishResult(s,
      ['s01', 's02', 's03'].map((id) => entry({ sceneId: id, imageFile: `${id}.png` })),
      { 's01.png': PNG, 's02.png': PNG, 's03.png': PNG });

    // 둘째 장에서 백신·디스크 가득 참이 난 상황을 만든다
    const realCopy = fsp.copyFile;
    let n = 0;
    const spy = vi.spyOn(fsp, 'copyFile').mockImplementation(async (from, to) => {
      if (++n === 2) {
        const e = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
        throw e;
      }
      return realCopy(from, to);
    });
    await watcher.ingestPacketResult(pid);
    spy.mockRestore();

    // 아무도 안 가리키는 그림이 남지 않는다 (`scenes/`가 아예 비어 있다)
    const left = await fsp.readdir(path.join(s.jobDir, 'scenes')).catch(() => [] as string[]);
    expect(left).toEqual([]);
    const script = await jobs.readScript(s.ref, 1);
    expect(script!.scenes.every((x) => x.imageRef === undefined)).toBe(true);

    /*
      🔴 **반영 실패가 기록에 남는다** (2026-08-27). 예전에는 패킷이 이미
      「받음·오류 없음」으로 굳은 뒤에 반영이 돌아서, 붙은 것이 0장인데 화면은 성공이라고
      말했다 — 문서로만 닫아 두던 구멍이다. 이제 사유가 화면에 뜬다.
    */
    expect((await errorsOf(pid)).join(' ')).toContain('반영하지 못했습니다');
  });
});

/*
  🔴 **`received`는 화면·API가 볼 수 있는 유일한 신호다** (2026-08-27 검증 반려).
  그것이 「반영 완료」를 뜻하지 않으면, 사용자는 「반영됨·오류 없음」을 보고 조립을 눌렀다가
  「clipRef도 imageRef도 없음」을 만난다. 하네스가 3회 중 2회 여기서 죽었다.
*/
describe('「받음」은 반영이 끝났다는 뜻이다', () => {
  /*
    폴링으로 재면 창이 좁아 빨개지지 않을 수도 있다. 대신 **패킷이 디스크에 쓰이는 바로
    그 순간** 대본을 동기로 읽어 스냅샷을 뜬다 — 순서가 뒤집혀 있으면 결정적으로 걸린다.
  */
  it('packet.json에 「받음」이 쓰이는 순간 대본에 이미 붙어 있다', async () => {
    const s = await seedWith(['s01']);
    const pid = await publishResult(s, [entry()], { 's01.png': PNG });
    const scriptFile = path.join(s.jobDir, 'script', 'script_v1.json');

    let snapshotAtReceived: string | null = null;
    const realWrite = fsp.writeFile;
    const spy = vi.spyOn(fsp, 'writeFile').mockImplementation(async (file, data, ...rest) => {
      const target = String(file);
      // `writeJsonAtomic`은 임시 파일에 쓴 뒤 rename한다 — 그 임시 파일이 패킷이다
      if (snapshotAtReceived === null && target.includes('packet.json')
        && typeof data === 'string' && data.includes('"received"')) {
        snapshotAtReceived = fs.readFileSync(scriptFile, 'utf8');
      }
      return (realWrite as typeof fsp.writeFile)(file, data as never, ...rest as []);
    });
    await watcher.ingestPacketResult(pid);
    spy.mockRestore();

    expect(snapshotAtReceived, '「받음」이 쓰이는 것을 못 봤다 — 검사가 무력하다').not.toBeNull();
    expect(snapshotAtReceived!).toContain('imageRef');
    expect(snapshotAtReceived!).toContain('s01_v1.png');
  });
});

describe('반영은 프로세스가 죽어도 한 번뿐이다', () => {
  /*
    🔴 반영을 「받음」보다 **먼저** 돌리면서 생긴 창이다 — 반영에 성공한 뒤 패킷 쓰기가
    실패하면 패킷이 `waiting`으로 남아 **스윕이 같은 결과를 또 반영한다.** 대본이
    `script_v2`로 조용히 밀리는 2026-08-23의 그 사고다. `applyStartedAt`이 그걸 막는다
    (`ingesting` 맵은 이 프로세스 안에서만 유효해 못 막는다).
  */
  it('반영 뒤 패킷 쓰기가 실패해도 다시 반영하지 않는다', async () => {
    const s = await seedWith(['s01']);
    const pid = await publishResult(s, [entry()], { 's01.png': PNG });

    // 첫 쓰기(`applyStartedAt`)는 통과시키고 「받음」 쓰기만 터뜨린다
    const realWrite = fsp.writeFile;
    let seen = 0;
    const spy = vi.spyOn(fsp, 'writeFile').mockImplementation(async (file, data, ...rest) => {
      if (String(file).includes('packet.json') && ++seen === 2) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      }
      return (realWrite as typeof fsp.writeFile)(file, data as never, ...rest as []);
    });
    await watcher.ingestPacketResult(pid).catch(() => {});
    spy.mockRestore();

    // 반영은 됐고 패킷은 아직 `waiting`이다 — 스윕이 다시 온다
    expect(await fsp.readdir(path.join(s.jobDir, 'scenes'))).toEqual(['s01_v1.png']);
    expect((await packets.readPacket(pid))!.status).toBe('waiting');

    // 🔴 다시 와도 **두 번째 반영은 없다**
    await watcher.ingestPacketResult(pid);
    expect(await fsp.readdir(path.join(s.jobDir, 'scenes'))).toEqual(['s01_v1.png']);
    // 그리고 「모른다」고 적는다 — 조용히 성공한 척하지 않는다
    expect((await errorsOf(pid)).join(' ')).toContain('앞선 반영 시도');
  });
});

describe('요청서 결과는 한 번만 반영한다', () => {
  /*
    🔴 **인프로세스 `Promise.all`이라야 재현된다** (2026-08-26 검증자 실측: curl 30회로는
    못 봤다 — 프로세스 기동 지터가 창보다 넓다). 서버가 직접 쓴 결과(붙여넣기·API 자동)와
    워처가 같은 `.done`을 거의 동시에 물고 들어오는 것이 실제 경로다.
  */
  it('동시에 두 번 들어와도 이미지가 한 번만 붙는다', async () => {
    const s = await seed();
    const pid = await publishResult(s, [entry()], { 's01.png': PNG });
    await Promise.all([
      watcher.ingestPacketResult(pid),
      watcher.ingestPacketResult(pid),
    ]);

    const scenesDir = path.join(s.jobDir, 'scenes');
    expect(await fsp.readdir(scenesDir)).toEqual(['s01_v1.png']);
    const job = await jobs.readJob(s.ref);
    expect(job!.script.currentVersion).toBe(1); // 버전이 조용히 밀리지 않는다
  });

  it('이미 받은 요청서를 다시 부르면 아무 일도 안 한다', async () => {
    const s = await seed();
    const pid = await publishResult(s, [entry()], { 's01.png': PNG });
    await watcher.ingestPacketResult(pid);
    await watcher.ingestPacketResult(pid);

    expect(await fsp.readdir(path.join(s.jobDir, 'scenes'))).toEqual(['s01_v1.png']);
  });
});

/*
  곁다리로 고친 것에도 그물을 남긴다 (2026-08-27 검증 지적: 고쳐진 것은 확인됐는데
  **그걸 지키는 커밋된 검사가 없었다**).
*/
describe('따라잡기 스윕은 한 건이 터져도 멈추지 않는다', () => {
  it('한 요청서가 던져도 나머지가 반영된다', async () => {
    const a = await seedWith(['s01']);
    const b = await seedWith(['s01']);
    for (const s of [a, b]) {
      const pid = await publishResult(s, [entry()], { 's01.png': PNG });
      // 스윕이 집어가도록 `.done`을 남긴다 (평소엔 워처가 보는 그 파일이다)
      await fsp.writeFile(path.join(tmp, (await packets.readPacket(pid))!.dir, 'result', '.done'), '');
    }

    // 첫 번째로 처리되는 요청서의 패킷 쓰기를 한 번만 터뜨린다
    const realWrite = fsp.writeFile;
    let blown = false;
    const spy = vi.spyOn(fsp, 'writeFile').mockImplementation(async (file, data, ...rest) => {
      if (!blown && String(file).includes('packet.json')) {
        blown = true;
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      }
      return (realWrite as typeof fsp.writeFile)(file, data as never, ...rest as []);
    });
    // 🔴 스윕 자체가 던지면 안 된다 — 던지면 그 회차의 뒤쪽 요청서가 통째로 건너뛰어진다
    await expect(watcher.catchUpPendingResults()).resolves.toBeUndefined();
    spy.mockRestore();
    expect(blown, '터뜨릴 자리를 못 만났다 — 검사가 무력하다').toBe(true);

    // 터진 한 건 말고는 반영된다
    const attached = [
      (await jobs.readScript(a.ref, 1))!.scenes[0].imageRef,
      (await jobs.readScript(b.ref, 1))!.scenes[0].imageRef,
    ].filter(Boolean);
    expect(attached).toHaveLength(1);
  });
});

describe('요청서 명세가 배선을 실제로 알려주는가', () => {
  /*
    명세가 출처 칸을 안 알려주면 결과가 늘 거부되고 그 이유가 어디에도 안 적혀 있다.
    화이트리스트는 **여기 베껴 적지 않는다** — 그건 `assetSourcingRules()`가 검증 규칙에 싣는다.
  */
  it('씬 이미지 요청서에 출처 칸과 AI생성 값이 실린다', async () => {
    const s = await seed();
    const packet = await packets.createPacket({ kind: 'scene-images', jobRef: s.ref });
    const md = await fsp.readFile(path.join(tmp, packet.dir, 'request.md'), 'utf8');

    for (const field of ['sourceUrl', 'license', 'downloadedAt', 'hasFace', 'imageFile']) {
      expect(md).toContain(field);
    }
    expect(md).toContain(policy.AI_GENERATED);
    // 소싱 규칙(화이트리스트)은 검증 규칙 절에서 온다 — 한 벌인지 확인한다
    expect(md).toContain(policy.ASSET_SOURCE_WHITELIST[0].host);
  });
});
