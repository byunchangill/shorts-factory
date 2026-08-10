import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Modal, Textarea } from '@/components/ui';
import { PacketCard, type PacketInfo } from '@/components/PacketCard';

interface FormatData {
  id: string; name: string; version: number;
  structure: { hook: string; beats: Array<{ name: string; purpose: string; secondsHint: number }>; cta: string };
  tone: { persona: string; speechLevel: string };
  branding: { channelName: string };
  typecastVoiceId: string;
}

const WIZARD_QUESTIONS = [
  { key: '채널 컨셉', placeholder: '예: 3만원 이하 가성비 꿀템만 소개하는 채널' },
  { key: '타깃 시청자', placeholder: '예: 자취하는 20~30대' },
  { key: '말투/톤', placeholder: '예: 친한 친구가 추천해주는 반말 톤' },
  { key: '씬 구성 아이디어', placeholder: '예: 문제 상황 → 제품 등장 → 사용 장면 3개 → 가격 공개' },
  { key: '채널명/브랜딩', placeholder: '예: 꿀템창고, 노란색+검정 팔레트' },
] as const;

export default function FormatsPage() {
  const qc = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const formats = useQuery({
    queryKey: ['formats'],
    queryFn: () => api.get<FormatData[]>('/formats'),
  });
  const packets = useQuery({
    queryKey: ['packets'],
    queryFn: () => api.get<PacketInfo[]>('/packets'),
  });

  const issue = useMutation({
    mutationFn: () => api.post('/formats/packets', { wizardAnswers: answers }),
    onSuccess: () => {
      setWizardOpen(false);
      setAnswers({});
      void qc.invalidateQueries({ queryKey: ['packets'] });
    },
  });

  const formatPackets = (packets.data ?? []).filter(
    (p) => p.kind === 'format-create' && (p.status === 'waiting' || p.status === 'received'),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">고유 포맷</h2>
        <Button onClick={() => setWizardOpen(true)}><Sparkles size={16} /> 새 포맷 만들기</Button>
      </div>

      <p className="text-sm text-slate-500">
        고유 포맷은 제품정보리뷰 채널의 뼈대입니다 — 훅 패턴, 씬 구성, 말투, 브랜딩을 한 번 정의하면
        모든 영상이 같은 포맷으로 생산되어 채널 정체성이 쌓입니다.
      </p>

      {formatPackets.map((p) => <PacketCard key={p.id} packet={p} />)}

      {formats.data?.length === 0 && formatPackets.length === 0 && (
        <EmptyState
          message="아직 포맷이 없습니다. 5가지 질문에 답하면 Claude가 포맷을 설계합니다."
          action={<Button onClick={() => setWizardOpen(true)}><Sparkles size={16} /> 포맷 만들기</Button>}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(formats.data ?? []).map((f) => (
          <Card key={f.id}>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">{f.name}</span>
              <Badge color="violet">v{f.version}</Badge>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">채널</dt><dd>{f.branding.channelName}</dd></div>
              <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">훅</dt><dd className="line-clamp-2">{f.structure.hook}</dd></div>
              <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">톤</dt><dd>{f.tone.persona} · {f.tone.speechLevel}</dd></div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-slate-400">구성</dt>
                <dd className="text-xs text-slate-500">
                  {f.structure.beats.map((b) => `${b.name}(${b.secondsHint}s)`).join(' → ')}
                </dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>

      <Modal open={wizardOpen} onClose={() => setWizardOpen(false)} title="고유 포맷 만들기">
        <p className="mb-3 text-sm text-slate-500">
          답변을 바탕으로 포맷 설계 요청서가 만들어집니다. Claude Code에서 실행하면 포맷이 완성됩니다.
        </p>
        <div className="space-y-3">
          {WIZARD_QUESTIONS.map((q) => (
            <div key={q.key}>
              <label className="mb-1 block text-sm font-medium">{q.key}</label>
              <Textarea
                rows={2}
                placeholder={q.placeholder}
                value={answers[q.key] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setWizardOpen(false)}>취소</Button>
          <Button
            onClick={() => issue.mutate()}
            disabled={WIZARD_QUESTIONS.some((q) => !answers[q.key]?.trim()) || issue.isPending}
          >
            요청서 발행
          </Button>
        </div>
      </Modal>
    </div>
  );
}
