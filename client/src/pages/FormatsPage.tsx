import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Sparkles, X } from 'lucide-react';
import type { Format } from '@shared/types';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Textarea } from '@/components/ui';
import { PacketCard, type PacketInfo } from '@/components/PacketCard';

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

  const [editing, setEditing] = useState<Format | null>(null);

  const formats = useQuery({
    queryKey: ['formats'],
    queryFn: () => api.get<Format[]>('/formats'),
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
      <PageHeader
        title="고유 포맷"
        actions={<Button onClick={() => setWizardOpen(true)}><Sparkles size={16} /> 새 포맷 만들기</Button>}
      />

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
        {(formats.data ?? []).map((f) => <FormatCard key={f.id} format={f} onEdit={() => setEditing(f)} />)}
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
            AI에게 포맷 설계 맡기기
          </Button>
        </div>
      </Modal>

      {editing && <FormatEditor format={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FormatCard({ format: f, onEdit }: { format: Format; onEdit: () => void }) {
  const total = f.structure.beats.reduce((s, b) => s + b.secondsHint, 0);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{f.name}</p>
          {/* 페르소나는 문단이라 여기 넣으면 잘린다 — 아래 dl에서 두 줄로 보여준다 */}
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {[f.branding.channelName, f.tone.speechLevel].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge color="slate">v{f.version}</Badge>
          <Button variant="ghost" onClick={onEdit}><Pencil size={14} /> 수정</Button>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-xs text-slate-500">
          <span>구성 {f.structure.beats.length}단계</span>
          <span>총 {Math.round(total * 10) / 10}초</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {f.structure.beats.map((b, i) => (
            <span key={i} className="rounded-md bg-slate-100 px-2 py-1 text-xs">
              {b.name} <span className="text-slate-400">{b.secondsHint}s</span>
            </span>
          ))}
        </div>
      </div>

      <dl className="space-y-1.5 border-t border-slate-100 pt-3 text-sm text-slate-600">
        <div><dt className="text-xs font-medium text-slate-400">훅</dt><dd className="line-clamp-2">{f.structure.hook}</dd></div>
        <div><dt className="text-xs font-medium text-slate-400">톤</dt><dd className="line-clamp-2">{f.tone.persona}</dd></div>
        <div><dt className="text-xs font-medium text-slate-400">마무리</dt><dd className="line-clamp-2">{f.structure.cta}</dd></div>
      </dl>
    </Card>
  );
}

/**
 * 포맷 수정 — 자주 손보는 값만 폼으로 연다.
 * 씬 템플릿·팔레트 등 나머지 필드는 draft에 그대로 실려 보존된다.
 * 저장하면 서버가 version을 올린다(saveFormat).
 */
function FormatEditor({ format, onClose }: { format: Format; onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Format>(format);
  const set = (patch: Partial<Format>) => setDraft({ ...draft, ...patch });
  const setBeats = (beats: Format['structure']['beats']) =>
    set({ structure: { ...draft.structure, beats } });

  const save = useMutation({
    mutationFn: () => api.put<Format>(`/formats/${format.id}`, draft),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['formats'] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={`포맷 수정 · v${format.version} → v${format.version + 1}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="포맷 이름">
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="채널명">
            <Input
              value={draft.branding.channelName}
              onChange={(e) => set({ branding: { ...draft.branding, channelName: e.target.value } })}
            />
          </Field>
        </div>

        <Field label="말투">
          <Input
            value={draft.tone.speechLevel}
            onChange={(e) => set({ tone: { ...draft.tone, speechLevel: e.target.value } })}
          />
        </Field>

        {/* 페르소나·비트 목적은 한 문단씩 들어간다 — 한 줄 입력으로는 못 고친다 */}
        <Field label="페르소나">
          <Textarea
            rows={3}
            value={draft.tone.persona}
            onChange={(e) => set({ tone: { ...draft.tone, persona: e.target.value } })}
          />
        </Field>

        <Field label="훅 패턴">
          <Textarea
            rows={4}
            value={draft.structure.hook}
            onChange={(e) => set({ structure: { ...draft.structure, hook: e.target.value } })}
          />
        </Field>

        <Field label="마무리 (CTA)">
          <Textarea
            rows={2}
            value={draft.structure.cta}
            onChange={(e) => set({ structure: { ...draft.structure, cta: e.target.value } })}
          />
        </Field>

        <Field label={`씬 구성 · 총 ${Math.round(draft.structure.beats.reduce((s, b) => s + b.secondsHint, 0) * 10) / 10}초`}>
          <div className="space-y-2">
            {draft.structure.beats.map((b, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-2">
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    placeholder="단계 이름"
                    value={b.name}
                    onChange={(e) => setBeats(draft.structure.beats.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <Input
                    className="w-20"
                    type="number"
                    step="0.5"
                    min="0"
                    value={b.secondsHint}
                    onChange={(e) => setBeats(draft.structure.beats.map((x, j) => (j === i ? { ...x, secondsHint: Number(e.target.value) } : x)))}
                  />
                  <Button variant="ghost" aria-label="단계 삭제" onClick={() => setBeats(draft.structure.beats.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </Button>
                </div>
                <Textarea
                  className="mt-2"
                  rows={2}
                  placeholder="이 단계의 목적"
                  value={b.purpose}
                  onChange={(e) => setBeats(draft.structure.beats.map((x, j) => (j === i ? { ...x, purpose: e.target.value } : x)))}
                />
              </div>
            ))}
            <Button variant="secondary" onClick={() => setBeats([...draft.structure.beats, { name: '', purpose: '', secondsHint: 3 }])}>
              <Plus size={14} /> 단계 추가
            </Button>
          </div>
        </Field>

        <Field label="금칙어 (쉼표로 구분)">
          <Input
            value={draft.tone.bannedWords.join(', ')}
            onChange={(e) => set({
              tone: { ...draft.tone, bannedWords: e.target.value.split(',').map((w) => w.trim()).filter(Boolean) },
            })}
          />
        </Field>
      </div>

      {save.error && <p className="mt-3 text-sm text-red-600">{(save.error as Error).message}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>취소</Button>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !draft.name.trim() || draft.structure.beats.some((b) => !b.name.trim())}
        >
          저장
        </Button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
