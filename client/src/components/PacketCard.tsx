import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, X, RefreshCw } from 'lucide-react';
import { PACKET_KIND_LABELS, type PacketKind } from '@shared/constants';
import { api } from '@/api/client';
import { Badge, Button, Card, Modal, Textarea } from '@/components/ui';

export interface PacketInfo {
  id: string;
  jobId?: string;
  kind: PacketKind;
  status: 'draft' | 'waiting' | 'received' | 'accepted' | 'rejected';
  dir: string;
  createdAt: string;
  validationErrors: string[];
}

const STATUS_LABEL: Record<string, { label: string; color: 'slate' | 'blue' | 'green' | 'amber' | 'red' }> = {
  draft: { label: '작성 중', color: 'slate' },
  waiting: { label: 'Claude 실행 대기', color: 'amber' },
  received: { label: '결과 도착', color: 'blue' },
  accepted: { label: '수락됨', color: 'green' },
  rejected: { label: '반려됨', color: 'red' },
};

export function PacketCard({ packet, compact }: { packet: PacketInfo; compact?: boolean }) {
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);

  const detail = useQuery({
    queryKey: ['packet', packet.id],
    queryFn: () => api.get<PacketInfo & { command: string; requestMd: string }>(`/packets/${packet.id}`),
    enabled: packet.status === 'waiting' || packet.status === 'received',
  });

  const accept = useMutation({
    mutationFn: () => api.post(`/packets/${packet.id}/accept`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['packets'] }),
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/packets/${packet.id}/reject`, { note }),
    onSuccess: () => {
      setRejectOpen(false);
      void qc.invalidateQueries({ queryKey: ['packets'] });
    },
  });

  const st = STATUS_LABEL[packet.status];
  const command = detail.data?.command ?? '';

  const copyCommand = () => {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className={compact ? 'p-3' : ''}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{PACKET_KIND_LABELS[packet.kind]}</span>
          <Badge color={st.color}>{st.label}</Badge>
        </div>
        <span className="text-xs text-slate-400">{packet.id}</span>
      </div>

      {packet.status === 'waiting' && command && (
        <div className="mt-3 space-y-1.5">
          <p className="text-xs text-slate-500">
            아래 명령을 이 리포의 Claude Code 터미널에서 실행하세요. 결과는 자동으로 감지됩니다.
          </p>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 truncate rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-green-300">
              {command}
            </code>
            <Button variant="secondary" onClick={copyCommand} className="px-2 py-1.5">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </div>
        </div>
      )}

      {packet.status === 'received' && (
        <div className="mt-3 space-y-2">
          {packet.validationErrors.length > 0 ? (
            <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">
              <p className="font-semibold">검증 오류 — 요청서를 다시 실행하세요:</p>
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
        <p className="mb-2 text-sm text-slate-600">
          사유를 적으면 수정 요청서가 자동으로 만들어집니다.
        </p>
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 훅이 약합니다. 가격 비교로 시작해 주세요." />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRejectOpen(false)}>취소</Button>
          <Button variant="danger" onClick={() => reject.mutate()} disabled={!note.trim() || reject.isPending}>
            반려하기
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
