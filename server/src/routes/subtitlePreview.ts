import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { z } from 'zod';
import { asyncRouter } from '../util/asyncRouter.js';
import { loadSettings } from '../store/workspace.js';
import { run } from '../util/exec.js';
import { assStyleOf, buildAss, wrapKorean } from '../pipeline/subtitles.js';
import { findKoreanFont, fontFamilyOf, filterFileArg } from '../pipeline/fonts.js';
import { familyOfInstalled } from '../pipeline/freeFonts.js';

const router = asyncRouter();

/*
  자막 모양 미리보기 — 설정 화면에서 숫자를 만지는 동안 결과를 그대로 보여준다.

  **조립과 같은 렌더러(libass)로 그린다.** 화면에서 CSS로 흉내 내면 폰트·외곽선이 달라
  「미리보기와 다른 영상」이 나온다 — 값을 고르라고 만든 화면이 거짓말을 하면 안 된다.
  배경은 밝은 회색과 어두운 회색 반반이다. 흰 글자가 밝은 배경에서 묻히는지 한눈에 보인다.
*/
const Query = z.object({
  text: z.string().default('세면용품 *여기 두지* 마세요'),
  subtitleFontSize: z.coerce.number().int().min(40).max(200).optional(),
  subtitleBottomRatio: z.coerce.number().min(0.05).max(0.8).optional(),
  subtitleOutline: z.coerce.number().int().min(0).max(20).optional(),
  subtitleMaxChars: z.coerce.number().int().min(6).max(30).optional(),
  subtitleColor: z.string().optional(),
  subtitleHighlightColor: z.string().optional(),
  /** 아직 저장 안 한 글꼴도 미리 보여 준다 — 저장해야 보이면 고를 수가 없다 */
  fontPath: z.string().optional(),
});

router.get('/subtitles/preview', async (req, res) => {
  const q = Query.parse(req.query);
  const saved = await loadSettings();
  const style = { ...saved, ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) };
  const font = await findKoreanFont(q.fontPath ?? saved.fontPath);

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'subs-preview-'));
  try {
    const assPath = path.join(dir, 'preview.ass');
    const outPath = path.join(dir, 'preview.png');
    await fsp.writeFile(
      assPath,
      buildAss(
        [{ start: 0, end: 1, text: wrapKorean(q.text, style.subtitleMaxChars) }],
        assStyleOf(style, (font && await familyOfInstalled(font)) ?? fontFamilyOf(font)),
      ),
      'utf8',
    );
    const ass = filterFileArg(assPath);
    await run(saved.ffmpegPath, [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0x9a9a9a:s=1080x1920',
      // 위 절반은 어둡게 — 밝은/어두운 배경 양쪽에서 읽히는지 한 장으로 본다
      '-vf', `drawbox=x=0:y=0:w=1080:h=960:color=0x3a3a3a:t=fill,ass=${ass.arg},scale=405:720`,
      '-frames:v', '1', outPath,
    ], { cwd: ass.cwd });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(await fsp.readFile(outPath));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

export default router;
