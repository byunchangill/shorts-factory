import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Copy, Check, X, RefreshCw, Bot, ClipboardPaste, Terminal } from 'lucide-react';
import {
  PACKET_KIND_LABELS, AI_PROVIDERS, AI_PROVIDER_LABELS,
  type PacketKind, type AiProvider,
} from '@shared/constants';
import { api } from '@/api/client';
import { Badge, Button, Card, Modal, Spinner, Textarea } from '@/components/ui';

export interface PacketInfo {
  id: string;
  jobId?: string;
  kind: PacketKind;
  status: 'draft' | 'waiting' | 'received' | 'accepted' | 'rejected';
  dir: string;
  createdAt: string;
  validationErrors: string[];
  executionMode?: 'claude-code' | 'api' | 'manual';
  provider?: AiProvider;
}

interface PacketDetail extends PacketInfo {
  command: string;
  requestMd: string;
  resultSpec: Array<{ file: string; schema: string }>;
}

const STATUS_LABEL: Record<string, { label: string; color: 'slate' | 'blue' | 'green' | 'amber' | 'red' }> = {
  draft: { label: '작성 중', color: 'slate' },
  waiting: { label: 'AI 실행 대기', color: 'amber' },
  received: { label: '결과 도착', color: 'blue' },
  accepted: { label: '수락됨', color: 'green' },
  rejected: { label: '반려됨', color: 'red' },
};

type Tab = 'claude-code' | 'api' | 'manual';

export function PacketCard({ packet, compact }: { packet: PacketInfo; compact?: boolean }) {
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<Tab>('claude-code');
  const [copied, setCopied] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const active = packet.status === 'waiting' || packet.status === 'received';
  const detail = useQuery({
    queryKey: ['packet', packet.id],
    queryFn: () => api.get<PacketDetail>(`/packets/${packet.id}`),
    enabled: active,
  });
  const providers = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => api.get<Record<AiProvider, boolean>>('/ai/providers'),
    enabled: active,
  });

  const accept = useMutation({
    mutationFn: () => api.post(`/packets/${packet.id}/accept`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['packets'] }),
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/packets/${packet.id}/reject`, { note }),
    onSuccess: () => {
      setRejectOpen(false);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['packets'] });
    },
  });
  const runApi = useMutation({
    mutationFn: (provider: AiProvider) => {
      setRunning(true);
      setRunError(null);
      return api.post(`/packets/${packet.id}/run`, { provider });
    },
    onError: (e: Error) => {
      setRunning(false);
      setRunError(e.message);
    },
  });
  const paste = useMutation({
    mutationFn: () => api.post<{ errors: string[] }>(`/packets/${packet.id}/paste`, { raw: pasteText }),
    onSuccess: (r) => {
      if (r.errors.length) {
        setRunError(r.errors.join(' / '));
      } else {
        setPasteOpen(false);
        setPasteText('');
        setRunError(null);
      }
      void qc.invalidateQueries({ queryKey: ['packets'] });
    },
    onError: (e: Error) => setRunError(e.message),
  });

  const st = STATUS_LABEL[packet.status];
  const copy = (text: string, tag: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(null), 1500);
  };

  const availableProviders = AI_PROVIDERS.filter((p) => providers.data?.[p]);

  return (
    <Card className={compact ? 'p-3' : ''}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{PACKET_KIND_LABELS[packet.kind]}</span>
          <Badge color={st.color}>{st.label}</Badge>
          {packet.executionMode === 'api' && packet.provider && (
            <Badge color="violet">{AI_PROVIDER_LABELS[packet.provider]}</Badge>
          )}
        </div>
        <span className="text-xs text-slate-400">{packet.id}</span>
      </div>

      {packet.status === 'waiting' && detail.data && (
        <div className="mt-3">
          <div className="mb-2 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {([
              ['claude-code', 'Claude Code', Terminal],
              ['api', 'API 자동', Bot],
              ['manual', '복사/붙여넣기', ClipboardPaste],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5',
                  tab === key ? 'bg-white font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {tab === 'claude-code' && (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500">이 리포의 Claude Code 터미널에서 실행하세요. 결과는 자동 감지됩니다.</p>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 truncate rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-green-300">
                  {detail.data.command}
                </code>
                <Button variant="secondary" className="px-2 py-1.5" onClick={() => copy(detail.data!.command, 'cmd')}>
                  {copied === 'cmd' ? <Check size={14} /> : <Copy size={14} />}
                </Button>
              </div>
            </div>
          )}

          {tab === 'api' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                등록된 API 키로 서버가 직접 실행합니다. 결과가 형식에 안 맞으면 한 번 자동 재시도합니다.
              </p>
              {availableProviders.length === 0 ? (
                <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                  등록된 AI API 키가 없습니다. "API 키" 메뉴에서 Anthropic·OpenAI·Gemini 중 하나를 등록하세요.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableProviders.map((p) => (
                    <Button key={p} variant="secondary" onClick={() => runApi.mutate(p)} disabled={running}>
                      {AI_PROVIDER_LABELS[p]}(으)로 실행
                    </Button>
                  ))}
                </div>
              )}
              {running && (
                <p className="flex items-center gap-1.5 text-sm text-slate-500">
                  <Spinner /> AI가 작성 중… 완료되면 자동으로 표시됩니다
                </p>
              )}
            </div>
          )}

          {tab === 'manual' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                프롬프트를 복사해 GPT·제미나이 등 아무 AI 챗에 붙여넣고, 받은 답변을 다시 이 앱에 붙여넣으세요. (무료)
              </p>
              <div className="flex gap-1.5">
                <Button variant="secondary" onClick={() => copy(detail.data!.requestMd, 'prompt')}>
                  {copied === 'prompt' ? <Check size={14} /> : <Copy size={14} />} 프롬프트 복사
                </Button>
                <Button onClick={() => { setPasteOpen(true); setRunError(null); }}>
                  <ClipboardPaste size={14} /> 결과 붙여넣기
                </Button>
              </div>
            </div>
          )}

          {runError && <p className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{runError}</p>}
        </div>
      )}

      {packet.status === 'received' && (
        <div className="mt-3 space-y-2">
          {packet.validationErrors.length > 0 ? (
            <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">
              <p className="font-semibold">검증 오류 — 다시 실행하거나 결과를 수정하세요:</p>
              <ul className="ml-4 list-disc">
                {packet.validationErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
                <Check size={14} /> 수락
              </Button>
              <Button variant="secondary" onClick={() => setRejectOpen(true)}>
                <X size={14} /> 반려
              </Button>
            </div>
          )}
        </div>
      )}

      {packet.status === 'rejected' && packet.jobId && (
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
          <RefreshCw size={12} /> 반려 사유가 담긴 수정 요청서가 자동 발행되었습니다.
        </p>
      )}

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="반려 사유">
        <p className="mb-2 text-sm text-slate-600">사유를 적으면 수정 요청서가 자동으로 만들어집니다.</p>
        <Textarea
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예: 훅이 약합니다. 가격 비교로 시작해 주세요."
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRejectOpen(false)}>취소</Button>
          <Button variant="danger" onClick={() => reject.mutate()} disabled={!note.trim() || reject.isPending}>
            반려하기
          </Button>
        </div>
      </Modal>

      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} title="AI 답변 붙여넣기">
        <p className="mb-2 text-sm text-slate-600">
          AI가 준 답변을 통째로 붙여넣으세요. 설명 문장이 섞여 있어도 필요한 부분만 자동으로 뽑아냅니다.
        </p>
        {detail.data && (
          <p className="mb-2 text-xs text-slate-500">
            필요한 산출물: {detail.data.resultSpec.map((s) => s.file).join(', ')}
          </p>
        )}
        <Textarea
          rows={12}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder='{"title": "...", "scenes": [...]}'
        />
        {runError && <p className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{runError}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPasteOpen(false)}>취소</Button>
          <Button onClick={() => paste.mutate()} disabled={!pasteText.trim() || paste.isPending}>반영하기</Button>
        </div>
      </Modal>
    </Card>
  );
}
