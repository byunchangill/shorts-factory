import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, Input } from '@/components/ui';

interface Settings {
  parallelDownloads: number;
  defaultTtsVoice: string;
  burnSubtitles: boolean;
  burnDisclosure: boolean;
  ytdlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  edgeTtsPath: string;
  iopaintPath: string;
  exportRoot: string;
  exportIncludeSources: boolean;
  exportOnDone: boolean;
  defaultPacketMode: 'claude-code' | 'api' | 'manual';
  defaultAiProvider: 'anthropic' | 'openai' | 'gemini';
  aiModels: { anthropic: string; openai: string; gemini: string };
  ttsEngine: 'auto' | 'typecast' | 'edge-tts';
  typecastVoiceId: string;
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
        <h3 className="mb-3 font-medium">음성(TTS)</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-28 shrink-0 font-medium">엔진</span>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={form.ttsEngine}
            onChange={(e) => set({ ttsEngine: e.target.value as Settings['ttsEngine'] })}
          >
            <option value="auto">자동 (타입캐스트 키 있으면 타입캐스트)</option>
            <option value="typecast">타입캐스트</option>
            <option value="edge-tts">edge-tts (무료)</option>
          </select>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          씬에 음성 파일을 첨부하면 엔진 설정과 무관하게 그 파일이 우선 사용됩니다.
        </p>
      </Card>

      <Card>
        <h3 className="mb-3 font-medium">도구 경로 (PATH에 없을 때만 수정)</h3>
        <div className="space-y-2">
          {(['ytdlpPath', 'ffmpegPath', 'ffprobePath', 'edgeTtsPath', 'iopaintPath'] as const).map((k) => (
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
