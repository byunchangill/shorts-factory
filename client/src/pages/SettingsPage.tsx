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
