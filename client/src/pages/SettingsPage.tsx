import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, Input, PageHeader, SearchSelect, Textarea } from '@/components/ui';
import { TARGET_SEC, syllableBudget } from '@shared/constants';

interface Settings {
  parallelDownloads: number;
  burnSubtitles: boolean;
  burnDisclosure: boolean;
  subtitleFontSize: number;
  subtitleBottomRatio: number;
  subtitleOutline: number;
  subtitleMaxChars: number;
  subtitleColor: string;
  subtitleHighlightColor: string;
  ytdlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  iopaintPath: string;
  pythonPath: string;
  exportRoot: string;
  exportIncludeSources: boolean;
  exportOnDone: boolean;
  defaultPacketMode: 'claude-code' | 'api' | 'manual';
  defaultAiProvider: 'anthropic' | 'openai' | 'gemini';
  aiModels: { anthropic: string; openai: string; gemini: string };
  voiceProvider: 'typecast' | 'voicebox';
  typecastVoiceId: string;
  voiceboxUrl: string;
  voiceboxProfileId: string;
  voiceboxInstruct: string;
  voicePitchSemitones: number;
  speechRate: number;
  fontPath: string;
  layout: 'fullscreen' | 'framed';
  frameTitle: string;
  mirror: boolean;
  zoom: number;
  grade: string;
  vsrPath: string;
  vsrPython: string;
  vsrMode: string;
  insertCards: boolean;
  cardDurationSec: number;
  hookMotionMin: number;
  maxClipExposureSec: number;
}
interface DoctorTool {
  name: string; required: boolean; available: boolean; version?: string; path?: string;
  installHint: string;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const doctor = useQuery({
    queryKey: ['doctor'],
    queryFn: () => api.get<{ tools: DoctorTool[]; ok: boolean }>('/system/doctor'),
  });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: () => api.put<Settings>('/settings', form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['doctor'] });
    },
  });

  if (!form) return null;
  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch });

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="설정" />

      <Card>
        <h3 className="mb-3 font-medium">도구 상태</h3>
        <ul className="space-y-2">
          {(doctor.data?.tools ?? []).map((t) => (
            <li key={t.name} className="flex items-start gap-2 text-sm">
              {/* 경로가 길어 줄바꿈되면 배지까지 눌려 글자가 세로로 깨진다 — 배지는 안 줄인다 */}
              <span className="shrink-0">
                <Badge color={t.available ? 'green' : t.required ? 'red' : 'amber'}>
                  {t.available ? '설치됨' : '없음'}
                </Badge>
              </span>
              <div className="min-w-0">
                <span className="font-medium">{t.name}</span>
                {t.version && <span className="ml-2 text-xs text-slate-500">{t.version}</span>}
                {/* PC마다 다른 파일이 뽑힌다 — 어느 것을 쓰는지 감추면 원인을 못 짚는다 */}
                {t.path && <p className="break-all text-xs text-slate-400">{t.path}</p>}
                {!t.available && <p className="text-xs text-slate-500">{t.installHint}</p>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h3 className="mb-3 font-medium">동작 설정</h3>
        <div className="space-y-3 text-sm">
          <div>
            <label className="mb-1 block font-medium">동시 다운로드 수 (1~8)</label>
            <Input
              type="number" min={1} max={8}
              value={form.parallelDownloads}
              onChange={(e) => set({ parallelDownloads: Number(e.target.value) })}
              className="w-24"
            />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.burnSubtitles} onChange={(e) => set({ burnSubtitles: e.target.checked })} />
            자막 번인 (영상에 자막 새기기)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.burnDisclosure} onChange={(e) => set({ burnDisclosure: e.target.checked })} />
            쿠팡파트너스 공시문구 자막 포함 (권장)
          </label>
        </div>
      </Card>

      <SubtitleStyleCard form={form} set={set} />

      <Card>
        <h3 className="mb-3 font-medium">산출물 저장 폴더</h3>
        <div className="space-y-3 text-sm">
          <div>
            <label className="mb-1 block font-medium">내보내기 루트 경로</label>
            <Input
              value={form.exportRoot}
              onChange={(e) => set({ exportRoot: e.target.value })}
              placeholder="비워두면 다운로드 폴더 (예: C:\Users\나\Desktop)"
            />
            <p className="mt-1 text-xs text-slate-500">
              이 폴더 아래에 <b>제품명 폴더</b>가 만들어지고, 그 안에 최종영상·영상·음성·대본·이미지·업로드킷 폴더로 정리됩니다.
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.exportOnDone} onChange={(e) => set({ exportOnDone: e.target.checked })} />
            작업 완료 시 자동으로 내보내기
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.exportIncludeSources}
              onChange={(e) => set({ exportIncludeSources: e.target.checked })}
            />
            다운로드 원본 영상도 포함 (용량이 큽니다)
          </label>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-medium">AI 요청서 실행</h3>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 shrink-0 font-medium">기본 방식</span>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.defaultPacketMode}
              onChange={(e) => set({ defaultPacketMode: e.target.value as Settings['defaultPacketMode'] })}
            >
              <option value="claude-code">Claude Code</option>
              <option value="api">API 자동 실행</option>
              <option value="manual">복사 / 붙여넣기</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 shrink-0 font-medium">기본 AI</span>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.defaultAiProvider}
              onChange={(e) => set({ defaultAiProvider: e.target.value as Settings['defaultAiProvider'] })}
            >
              <option value="anthropic">Claude (Anthropic)</option>
              <option value="openai">GPT (OpenAI)</option>
              <option value="gemini">Gemini (Google)</option>
            </select>
          </div>
          {(['anthropic', 'openai', 'gemini'] as const).map((p) => (
            <ModelPicker
              key={p}
              provider={p}
              value={form.aiModels[p]}
              onPick={(id) => set({ aiModels: { ...form.aiModels, [p]: id } })}
            />
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 font-medium">화면 구성 · 재사용 콘텐츠 대응</h3>
        <p className="mb-3 text-sm text-slate-500">
          외부 영상을 화면 전체에 그대로 채우면 재사용 콘텐츠로 분류될 위험이 큽니다.
          자기 레이어를 덮고 원본 연속 노출을 끊는 설정입니다.
        </p>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 shrink-0 font-medium">레이아웃</span>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.layout}
              onChange={(e) => set({ layout: e.target.value as Settings['layout'] })}
            >
              <option value="framed">프레임 (권장) — 자기 프레임 안에 소스 배치</option>
              <option value="fullscreen">전체화면 — 소스가 화면을 꽉 채움</option>
            </select>
          </div>
          {form.layout === 'framed' && (
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-slate-500">상단 문구</span>
              <Input
                value={form.frameTitle}
                onChange={(e) => set({ frameTitle: e.target.value })}
                placeholder="채널명 등 (비우면 표시 안 함)"
              />
            </div>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.mirror} onChange={(e) => set({ mirror: e.target.checked })} />
            소재 좌우반전 (픽셀이 통째로 달라져 중복 회피에 제일 강함)
          </label>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-slate-500">소재 확대</span>
            <Input
              type="number" step="0.02" min={1} max={1.2}
              className="w-24"
              value={form.zoom}
              onChange={(e) => set({ zoom: Number(e.target.value) })}
            />
            <span className="text-xs text-slate-500">배 — 1이면 원본. 가장자리가 잘려 나갑니다</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-slate-500">채널 그레이딩</span>
            <Input
              value={form.grade}
              onChange={(e) => set({ grade: e.target.value })}
              placeholder="비우면 색보정 안 함"
            />
          </div>
          <p className="-mt-1 pl-30 text-xs text-slate-500">
            계정마다 제각각인 소재 색을 한 룩으로 묶습니다. ffmpeg 필터 문자열이고,
            <b> 편마다 바꾸지 않습니다</b> — 매 편 같은 값이어야 채널 룩이 됩니다.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.insertCards}
              onChange={(e) => set({ insertCards: e.target.checked })}
            />
            씬 사이에 텍스트 카드 삽입 (원본 연속 노출을 끊고 정보 밀도를 올림)
          </label>
          <p className="-mt-1 pl-6 text-xs text-slate-500">
            <b>제품정보리뷰에만 들어갑니다.</b> 해외영상 짜집기는 「음성 = 자막」이라
            말하지 않는 글자를 화면에 띄우지 않습니다 — 켜 둬도 그 메뉴에는 안 붙습니다.
          </p>
          {form.insertCards && (
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-slate-500">카드 길이</span>
              <Input
                type="number" step="0.5" min={0.5} max={4}
                className="w-24"
                value={form.cardDurationSec}
                onChange={(e) => set({ cardDurationSec: Number(e.target.value) })}
              />
              <span className="text-xs text-slate-500">초</span>
            </div>
          )}
          {/*
            훅 게이트. 숫자를 감으로 바꾸면 근거를 잃는다 — 발행 14편 실측에서
            「계속 시청함」과 상관 있는 유일한 변수였고(r=+0.57), 임계 8에서
            통과 11편 중앙값 33.8% / 미달 3편 19.1%였다.
          */}
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-slate-500">훅 변화량 하한</span>
            <Input
              type="number" step="1" min={0} max={60}
              className="w-24"
              value={form.hookMotionMin}
              onChange={(e) => set({ hookMotionMin: Number(e.target.value) })}
            />
            <span className="text-xs text-slate-500">0이면 끔 (권장 8)</span>
          </div>
          <p className="-mt-1 pl-30 text-xs text-slate-500">
            첫 컷의 <b>0~0.5초 화면 변화량</b>이 이 값에 못 미치면 조립을 렌더 전에 막습니다.
            발행 14편 실측에서 「계속 시청함」과 상관 있는 유일한 변수였습니다 —
            <b> 첫 컷 길이로는 걸지 않습니다</b>(표본 7편에서 오판한 적이 있습니다).
          </p>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-slate-500">연속 노출 상한</span>
            <Input
              type="number" min={1} max={30}
              className="w-24"
              value={form.maxClipExposureSec}
              onChange={(e) => set({ maxClipExposureSec: Number(e.target.value) })}
            />
            <span className="text-xs text-slate-500">초 — 초과 시 컷 선택에서 경고</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-slate-500">한글 폰트</span>
            <Input
              value={form.fontPath}
              onChange={(e) => set({ fontPath: e.target.value })}
              placeholder="비우면 자동 탐색 (자막·카드에 필요)"
            />
          </div>
        </div>
        <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-500">
          이 설정들은 재사용 콘텐츠로 분류될 위험을 낮추지만, <b>소스 사용 권리를 대체하지 않습니다.</b>
          원저작자 허락이나 라이선스 확인은 별도로 필요합니다.
        </p>
      </Card>

      <Card>
        <h3 className="mb-3 font-medium">음성</h3>
        <p className="text-sm text-slate-500">
          나레이션은 아래에서 고른 방식으로 합성하거나, 작업 화면에서 <b>씬별 음성 파일을 첨부</b>합니다.
          첨부된 씬은 합성하지 않고 그 파일을 그대로 사용합니다.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="w-28 shrink-0 font-medium">합성 방식</span>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={form.voiceProvider}
            onChange={(e) => set({ voiceProvider: e.target.value as Settings['voiceProvider'] })}
          >
            <option value="typecast">타입캐스트 (클라우드 · API 키 필요)</option>
            <option value="voicebox">Voicebox (내 PC · 무료 · 서버를 켜둬야 함)</option>
          </select>
        </div>

        {form.voiceProvider === 'voicebox' && (
          <div className="mt-3 space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-slate-500">서버 주소</span>
              <Input value={form.voiceboxUrl} onChange={(e) => set({ voiceboxUrl: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-slate-500">목소리 id</span>
              <Input
                value={form.voiceboxProfileId}
                placeholder="음성 단계에서 고르면 여기 채워집니다"
                onChange={(e) => set({ voiceboxProfileId: e.target.value })}
              />
            </div>
            <div>
              <span className="text-slate-500">말투 지시</span>
              <Textarea
                rows={2}
                value={form.voiceboxInstruct}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set({ voiceboxInstruct: e.target.value })}
              />
              <p className="mt-1 text-xs text-slate-500">
                어조를 잡는 값입니다. <b>속도는 아래 낭독 속도가 만듭니다</b> — 말투 지시로는
                실측상 3%밖에 빨라지지 않았습니다.
              </p>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="w-28 shrink-0 font-medium">낭독 속도</span>
          <Input
            type="number" step="0.05" min={0.5} max={2}
            className="w-24"
            value={form.speechRate}
            onChange={(e) => set({ speechRate: Number(e.target.value) })}
          />
          <span className="text-xs text-slate-500">배 (합성 음성에만 적용)</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="w-28 shrink-0 font-medium">음정</span>
          <Input
            type="number" step="1" min={-12} max={12}
            className="w-24"
            value={form.voicePitchSemitones}
            onChange={(e) => set({ voicePitchSemitones: Number(e.target.value) })}
          />
          <span className="text-xs text-slate-500">
            반음 (0이면 그대로 · 양수면 높아짐, 길이는 안 변합니다)
          </span>
        </div>
        <p className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
          이 속도가 <b>대본 분량 기준</b>을 결정합니다. 현재 설정이면 {TARGET_SEC.max}초 영상에
          최대 <b>{syllableBudget(form.speechRate || 1).max}음절</b>
          (권장 {syllableBudget(form.speechRate || 1).recommended}음절)까지 쓸 수 있습니다.
          글자가 아니라 <b>한글 음절</b>입니다 — 공백·기호는 세지 않습니다.
          첨부한 음성 파일은 원본 속도 그대로 사용됩니다.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          타입캐스트 키는 "API 키" 메뉴에서 등록하고, 캐릭터는 작업의 음성 단계에서 미리듣기로 고릅니다.
        </p>
      </Card>

      <Card>
        <h3 className="mb-3 font-medium">도구 경로 (자동으로 못 찾을 때만 수정)</h3>
        <div className="space-y-2">
          {(['ytdlpPath', 'ffmpegPath', 'ffprobePath', 'iopaintPath', 'pythonPath'] as const).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-sm text-slate-500">{k.replace('Path', '')}</span>
              <Input
                value={form[k]}
                placeholder="비우면 자동으로 찾습니다"
                onChange={(e) => set({ [k]: e.target.value } as Partial<Settings>)}
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          비워두면 PC마다 알아서 찾습니다 — 위 "도구 상태"에 실제로 고른 파일 경로가 보입니다.
          파이썬은 <b>글자 검출기가 깔린 것</b>을 골라내므로, 파이썬이 여러 개여도 적어줄 필요가 없습니다.
          자동 선택이 엉뚱한 것을 잡을 때만 여기에 경로를 적으세요.
        </p>
      </Card>

      <Card>
        <h3 className="mb-1 font-medium">VSR (자막 제거)</h3>
        <p className="mb-3 text-sm text-slate-500">
          2차 제거의 1순위입니다. 넘긴 영역 안에서 <b>제 검출기가 글자를 찾은 자리만</b> 지워
          사각형을 통째로 지우는 방식보다 배경이 덜 상합니다. 비워두면 iopaint로,
          그것도 없으면 1차(ffmpeg) 제거만 씁니다.
        </p>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-slate-500">저장소 폴더</span>
            <Input
              value={form.vsrPath}
              onChange={(e) => set({ vsrPath: e.target.value })}
              placeholder="비우면 홈 폴더의 vsr · video-subtitle-remover를 찾습니다"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-slate-500">파이썬</span>
            <Input
              value={form.vsrPython}
              onChange={(e) => set({ vsrPython: e.target.value })}
              placeholder="비우면 저장소 안의 .venv를 씁니다"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-28 shrink-0 text-slate-500">모드</span>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.vsrMode}
              onChange={(e) => set({ vsrMode: e.target.value })}
            >
              <option value="lama">lama (권장 — 이 PC 실측에서 가장 깨끗하고 빨랐음)</option>
              <option value="sttn-auto">sttn-auto</option>
              <option value="sttn-det">sttn-det</option>
              <option value="propainter">propainter (GPU 필요)</option>
              <option value="opencv">opencv</option>
            </select>
          </div>
        </div>
      </Card>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        <Save size={15} /> 저장
      </Button>
    </div>
  );
}

/*
  자막 모양 — 숫자를 만지면서 결과를 바로 본다.

  미리보기는 **서버가 조립과 같은 렌더러(libass)로 그린 진짜 한 장**이다. 화면에서 CSS로
  흉내 내면 폰트·외곽선이 달라 「미리보기와 다른 영상」이 나온다. 값을 고르라고 만든
  화면이 거짓말을 하면 안 된다. 배경은 위아래로 어둡고 밝게 갈라 놨다 — 흰 글자가
  밝은 배경에서 묻히는지 한 장으로 보인다.
*/
/** 미리보기 예시 문장 — 「한 줄 글자 수」에 맞춰 잘라 쓴다 */
const SAMPLE = '세면용품 *여기 두지* 마세요 물때가 금방 끼고 나중에 지워지지 않습니다';

/** 강조 표시(`*`)를 뺀, 화면에 보이는 글자 수 */
const visibleLen = (s: string) => s.replace(/\*/g, '').length;

/**
 * 글자 수에 맞는 예시 문장 만들기.
 *
 * **글자 단위로 자르지 않는다.** 「…금방 끼고 잘」처럼 단어가 끊기거나 한 글자 조각으로
 * 끝나면 한국어 문장으로 읽히지 않아서, 자막이 그렇게 나갈 것처럼 오해하게 된다.
 * 단어를 통째로 채우고, 마지막이 한 글자짜리면 뺀다. 자른 자리에서 강조가 열려 있으면
 * 닫아 준다 — 안 닫으면 별표가 화면에 그대로 찍힌다.
 */
export function sampleForChars(text: string, n: number): string {
  const words = text.split(' ');
  const picked: string[] = [];
  for (const w of words) {
    const next = [...picked, w].join(' ');
    if (visibleLen(next) > n) break;
    picked.push(w);
  }
  // 「잘」·「안」처럼 한 글자로 끝나면 문장이 끊긴 것처럼 보인다
  while (picked.length > 1 && visibleLen(picked[picked.length - 1]) <= 1) picked.pop();
  // 첫 단어부터 넘치면 그 단어만이라도 (글자 수를 아주 작게 잡은 경우)
  const out = (picked.length ? picked : [words[0]]).join(' ');
  return (out.match(/\*/g) ?? []).length % 2 === 1 ? `${out}*` : out;
}

function SubtitleStyleCard({ form, set }: { form: Settings; set: (p: Partial<Settings>) => void }) {
  /*
    예시 문장은 「한 줄 글자 수」에 맞춰 그 길이로 만든다 — 설정한 글자 수가 한 줄에
    들어가는지를 눈으로 봐야 하기 때문이다. 사용자가 직접 치면 그 문장을 쓰고,
    비우면 다시 글자 수에 맞춘 예시로 돌아간다.
  */
  const [customText, setCustomText] = useState<string | null>(null);
  const text = customText ?? sampleForChars(SAMPLE, form.subtitleMaxChars);
  const [debounced, setDebounced] = useState(0);
  useEffect(() => {
    // 슬라이더를 끌 때마다 ffmpeg를 부르면 끊긴다 — 손을 멈추면 그린다
    const t = setTimeout(() => setDebounced((n) => n + 1), 250);
    return () => clearTimeout(t);
  }, [
    text, form.subtitleFontSize, form.subtitleBottomRatio, form.subtitleOutline,
    form.subtitleMaxChars, form.subtitleColor, form.subtitleHighlightColor, form.fontPath,
  ]);

  /*
    이 크기에서 한 줄에 몇 자나 들어가는지.
    「한 줄 글자 수」는 우리가 접는 기준일 뿐이고, 화면 폭을 넘으면 렌더러가 한 번 더 접는다.
    두 값이 어긋나면 설정이 아무 일도 안 하는 것처럼 보이므로 한계를 같이 적어 준다.
    이송폭은 글꼴마다 다르다 — 굵은 한글 글꼴 실측(본고딕 Black 118에 14자)에서 나온 어림값이다.
  */
  const usableWidth = 1080 - 30 * 2; // 좌우 여백은 자막 스타일과 같은 값
  const fitsPerLine = Math.floor(usableWidth / (form.subtitleFontSize * 0.64));

  const src = `/api/subtitles/preview?${new URLSearchParams({
    text,
    subtitleFontSize: String(form.subtitleFontSize),
    subtitleBottomRatio: String(form.subtitleBottomRatio),
    subtitleOutline: String(form.subtitleOutline),
    subtitleMaxChars: String(form.subtitleMaxChars),
    subtitleColor: form.subtitleColor,
    subtitleHighlightColor: form.subtitleHighlightColor,
    fontPath: form.fontPath,
    v: String(debounced),
  })}`;

  const slider = (
    label: string, key: 'subtitleFontSize' | 'subtitleBottomRatio' | 'subtitleOutline' | 'subtitleMaxChars',
    min: number, max: number, step: number, hint: string, fmt = (v: number) => String(v),
  ) => (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span className="text-slate-500">{fmt(form[key])}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={form[key]}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<Settings>)}
        className="mt-1 w-full accent-brand-600"
      />
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );

  return (
    <Card>
      <h3 className="mb-1 font-medium">자막 모양</h3>
      <p className="mb-3 text-sm text-slate-500">
        영상을 만들기 전에 여기서 정합니다. 모든 잡에 같은 값이 쓰입니다 —
        채널 룩이라 편마다 바꾸지 않습니다.
      </p>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="w-full max-w-sm space-y-4 text-sm">
          {slider('글자 크기', 'subtitleFontSize', 40, 200, 2,
            '1080 기준. 크게 키우면 한 줄 글자 수를 줄여야 넘치지 않습니다')}
          {slider('높이 (아래에서)', 'subtitleBottomRatio', 0.05, 0.8, 0.01,
            '하단 20%는 쇼츠 UI(계정명·설명·버튼)가 덮습니다',
            (v) => `${Math.round(v * 100)}%`)}
          {slider('외곽선 두께', 'subtitleOutline', 0, 20, 1,
            '밝은 배경에서 흰 글자가 묻히면 올립니다')}
          {slider('한 줄 글자 수', 'subtitleMaxChars', 6, 30, 1,
            fitsPerLine < form.subtitleMaxChars
              ? `이 크기에서는 한 줄에 약 ${fitsPerLine}자까지 들어갑니다 — `
                + '더 크게 잡아도 화면 폭에서 렌더러가 접습니다'
              : `넘으면 줄을 바꿉니다 (이 크기의 한 줄 한계는 약 ${fitsPerLine}자)`)}
          <FontPicker value={form.fontPath} onPick={(fontPath) => set({ fontPath })} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="text-slate-500">글자색</span>
              <input
                type="color" value={form.subtitleColor}
                onChange={(e) => set({ subtitleColor: e.target.value })}
                className="h-8 w-12 rounded border border-slate-300"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-slate-500">강조색</span>
              <input
                type="color" value={form.subtitleHighlightColor}
                onChange={(e) => set({ subtitleHighlightColor: e.target.value })}
                className="h-8 w-12 rounded border border-slate-300"
              />
            </label>
          </div>
          <div>
            <label className="mb-1 block font-medium">미리보기 문장</label>
            <Input
              value={text}
              onChange={(e) => setCustomText(e.target.value || null)}
            />
            <p className="mt-1 text-xs text-slate-500">
              한 줄 글자 수({form.subtitleMaxChars}자)에 맞춰 <b>단어 단위로</b> 만든 예시입니다 —
              이 문장이 한 줄로 나오면 그 글자 수가 실제로 들어간다는 뜻입니다.
              직접 쳐도 되고, 비우면 예시로 돌아갑니다.
              대본에서 <code>*별표*</code>로 감싼 부분이 강조색으로 나갑니다(낭독에는 영향 없음).
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <img
            src={src}
            alt="자막 미리보기"
            className="w-[203px] rounded-lg border border-slate-300"
          />
          <p className="mt-1 text-center text-xs text-slate-500">실제 조립과 같은 렌더러</p>
        </div>
      </div>
    </Card>
  );
}

/*
  글꼴 고르기 — **무료 글꼴만** 목록에 올린다.

  깔린 글꼴을 전부 보여 주면 안 된다. 윈도우에 딸려 오는 글꼴(맑은 고딕 등)은 영상에
  새겨 배포해도 되는지가 라이선스마다 다르다. 서버가 자유 이용이 명시된 것만 골라 준다.
*/
function FontPicker({ value, onPick }: { value: string; onPick: (path: string) => void }) {
  const qc = useQueryClient();
  const fonts = useQuery({
    queryKey: ['fonts'],
    queryFn: () => api.get<{ fonts: Array<{ filePath: string; label: string; license: string }> }>('/fonts'),
  });
  /*
    구글 폰트에서 받을 수 있는 한국어 글꼴. 눈누 같은 모음 사이트는 글꼴마다 배포처와
    이용 범위가 달라 한 번에 못 받는다 — 구글 폰트는 전부 OFL이라 통째로 받을 수 있다.
  */
  const available = useQuery({
    queryKey: ['fonts-available'],
    queryFn: () => api.get<{ families: Array<{ family: string; installed: boolean }> }>('/fonts/available'),
  });
  const install = useMutation({
    mutationFn: () => api.post<{ installed: string[]; skipped: string[]; failed: string[] }>('/fonts/install'),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['fonts'] });
      void qc.invalidateQueries({ queryKey: ['fonts-available'] });
      alert(`글꼴 ${r.installed.length}종을 받았습니다.`
        + (r.skipped.length ? `
이미 있던 것 ${r.skipped.length}종` : '')
        + (r.failed.length ? `
못 받은 것 ${r.failed.length}종: ${r.failed.join(', ')}` : ''));
    },
    onError: (e: Error) => alert(e.message),
  });
  const notYet = (available.data?.families ?? []).filter((f) => !f.installed).length;
  const list = fonts.data?.fonts ?? [];
  const options = [
    { value: '', label: '자동 (설치된 것 중에서 고름)' },
    // 표에 없는 글꼴을 경로로 직접 지정했을 수도 있다 — 목록에 없다고 선택을 잃으면 안 된다
    ...(value && !list.some((f) => f.filePath === value)
      ? [{ value, label: value.split(/[\/]/).pop() ?? value, hint: '직접 지정' }]
      : []),
    ...list.map((f) => ({ value: f.filePath, label: f.label, hint: f.license })),
  ];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">글꼴</span>
        <span className="text-xs text-slate-500">무료 글꼴 {list.length}종</span>
      </div>
      <SearchSelect
        options={options}
        value={value}
        onPick={onPick}
        placeholder="글꼴 이름으로 검색"
        emptyText="그 이름의 무료 글꼴이 없습니다"
      />
      {notYet > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-2">
          <span className="text-xs text-slate-600">
            구글 폰트에서 <b>{notYet}종</b>을 더 받을 수 있습니다 (전부 OFL · 약 40MB)
          </span>
          <Button
            variant="secondary"
            className="ml-auto"
            onClick={() => install.mutate()}
            disabled={install.isPending}
          >
            {install.isPending ? '받는 중… (1~2분)' : '무료 글꼴 더 받기'}
          </Button>
        </div>
      )}
      <p className="mt-1 text-xs text-slate-500">
        자유 이용이 확인된 글꼴 중 <b>이 PC에 깔린 것</b>만 보입니다. 굵을수록 배경에 안 묻힙니다.
        목록에 없는 글꼴은 아래 「한글 폰트」 칸에 글꼴 파일 경로를 직접 적으면 그대로 씁니다 —
        이용 범위(영상 삽입·배포)는 직접 확인하세요.
      </p>
    </div>
  );
}

/*
  AI 모델 고르기 — 목록을 코드에 박지 않고 **등록된 키로 제공자에게 직접 묻는다.**
  모델은 몇 달마다 바뀌고, 박아 두면 새 모델이 나와도 화면에서 못 고른다.
  키가 없으면 목록을 못 받으므로 직접 입력으로 떨어진다.
*/
function ModelPicker({ provider, value, onPick }: {
  provider: 'anthropic' | 'openai' | 'gemini';
  value: string;
  onPick: (id: string) => void;
}) {
  const models = useQuery({
    queryKey: ['ai-models', provider],
    queryFn: () => api.get<{ models: Array<{ id: string; label: string }>; error?: string }>(
      `/ai/models?provider=${provider}`,
    ),
  });
  const list = models.data?.models ?? [];
  // 지금 쓰는 모델이 목록에 없어도 (구모델·오프라인) 선택은 잃지 않는다
  const options = list.some((m) => m.id === value) || !value
    ? list.map((m) => ({ value: m.id, label: m.label, hint: m.label === m.id ? undefined : m.id }))
    : [{ value, label: value }, ...list.map((m) => ({ value: m.id, label: m.label }))];

  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-slate-500">{provider} 모델</span>
      {list.length === 0 ? (
        <div className="flex-1">
          <Input value={value} onChange={(e) => onPick(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">
            {models.data?.error ?? '모델 목록을 받지 못했습니다'} — 모델 이름을 직접 적으세요.
          </p>
        </div>
      ) : (
        <SearchSelect
          className="flex-1"
          options={options}
          value={value}
          onPick={onPick}
          placeholder={`모델 검색 (${list.length}종)`}
          emptyText="그 이름의 모델이 없습니다"
        />
      )}
    </div>
  );
}
