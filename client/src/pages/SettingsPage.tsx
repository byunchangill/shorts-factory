import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, Input } from '@/components/ui';

interface Settings {
  parallelDownloads: number;
  burnSubtitles: boolean;
  burnDisclosure: boolean;
  ytdlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  iopaintPath: string;
  exportRoot: string;
  exportIncludeSources: boolean;
  exportOnDone: boolean;
  defaultPacketMode: 'claude-code' | 'api' | 'manual';
  defaultAiProvider: 'anthropic' | 'openai' | 'gemini';
  aiModels: { anthropic: string; openai: string; gemini: string };
  typecastVoiceId: string;
  fontPath: string;
  layout: 'fullscreen' | 'framed';
  frameTitle: string;
  insertCards: boolean;
  cardDurationSec: number;
  maxClipExposureSec: number;
}
interface DoctorTool {
  name: string; required: boolean; available: boolean; version?: string; installHint: string;
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
      <h2 className="text-lg font-semibold">설정</h2>

      <Card>
        <h3 className="mb-3 font-medium">도구 상태</h3>
        <ul className="space-y-2">
          {(doctor.data?.tools ?? []).map((t) => (
            <li key={t.name} className="flex items-start gap-2 text-sm">
              <Badge color={t.available ? 'green' : t.required ? 'red' : 'amber'}>
                {t.available ? '설치됨' : '없음'}
              </Badge>
              <div>
                <span className="font-medium">{t.name}</span>
                {t.version && <span className="ml-2 text-xs text-slate-400">{t.version}</span>}
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
            <div key={p} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-slate-500">{p} 모델</span>
              <Input
                value={form.aiModels[p]}
                onChange={(e) => set({ aiModels: { ...form.aiModels, [p]: e.target.value } })}
              />
            </div>
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
            <input
              type="checkbox"
              checked={form.insertCards}
              onChange={(e) => set({ insertCards: e.target.checked })}
            />
            씬 사이에 텍스트 카드 삽입 (원본 연속 노출을 끊고 정보 밀도를 올림)
          </label>
          {form.insertCards && (
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-slate-500">카드 길이</span>
              <Input
                type="number" step="0.5" min={0.5} max={4}
                className="w-24"
                value={form.cardDurationSec}
                onChange={(e) => set({ cardDurationSec: Number(e.target.value) })}
              />
              <span className="text-xs text-slate-400">초</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-slate-500">연속 노출 상한</span>
            <Input
              type="number" min={1} max={30}
              className="w-24"
              value={form.maxClipExposureSec}
              onChange={(e) => set({ maxClipExposureSec: Number(e.target.value) })}
            />
            <span className="text-xs text-slate-400">초 — 초과 시 컷 선택에서 경고</span>
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
          나레이션은 <b>타입캐스트 API</b>로 합성하거나, 작업 화면에서 <b>씬별 음성 파일을 첨부</b>합니다.
          첨부된 씬은 합성하지 않고 그 파일을 그대로 사용합니다.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          타입캐스트 키는 "API 키" 메뉴에서 등록하고, 캐릭터는 작업의 음성 단계에서 미리듣기로 고릅니다.
        </p>
      </Card>

      <Card>
        <h3 className="mb-3 font-medium">도구 경로 (PATH에 없을 때만 수정)</h3>
        <div className="space-y-2">
          {(['ytdlpPath', 'ffmpegPath', 'ffprobePath', 'iopaintPath'] as const).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-sm text-slate-500">{k.replace('Path', '')}</span>
              <Input value={form[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<Settings>)} />
            </div>
          ))}
        </div>
      </Card>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        <Save size={15} /> 저장
      </Button>
    </div>
  );
}
