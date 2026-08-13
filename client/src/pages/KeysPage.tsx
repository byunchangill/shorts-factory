import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, Input, PageHeader } from '@/components/ui';

interface KeyRow {
  name: string;
  label: string;
  desc: string;
  url: string;
  configured: boolean;
  masked: string;
}
interface KeysResponse {
  keys: KeyRow[];
  googleOauth: { clientIdConfigured: boolean; clientSecretConfigured: boolean; connected: boolean };
}

export default function KeysPage() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['keys'], queryFn: () => api.get<KeysResponse>('/keys') });

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <PageHeader title="API 키" />
        <p className="mt-1 text-sm text-slate-600">
          키는 이 컴퓨터의 <code className="rounded bg-slate-100 px-1 text-slate-800">workspace/secrets.json</code>에만 저장되며
          깃에 커밋되지 않습니다. 필요한 기능의 키만 등록하면 됩니다.
        </p>
      </div>

      {(data.data?.keys ?? []).map((row) => (
        <KeyCard key={row.name} row={row} onChanged={() => qc.invalidateQueries({ queryKey: ['keys'] })} />
      ))}

      <GoogleOauthCard
        state={data.data?.googleOauth}
        onChanged={() => qc.invalidateQueries({ queryKey: ['keys'] })}
      />
    </div>
  );
}

function KeyCard({ row, onChanged }: { row: KeyRow; onChanged: () => void }) {
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(!row.configured);
  const [test, setTest] = useState<{ ok: boolean; detail?: string; error?: string } | null>(null);

  const save = useMutation({
    mutationFn: () => api.put(`/keys/${row.name}`, { value }),
    onSuccess: () => {
      setValue('');
      setEditing(false);
      setTest(null);
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: () => fetch(`/api/keys/${row.name}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => {
      setEditing(true);
      setTest(null);
      onChanged();
    },
  });
  const runTest = useMutation({
    mutationFn: () => api.post<{ ok: boolean; detail?: string; error?: string }>(`/keys/${row.name}/test`),
    onSuccess: (r) => setTest(r),
    onError: (e: Error) => setTest({ ok: false, error: e.message }),
  });

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-slate-500" />
          <span className="font-medium">{row.label}</span>
          <Badge color={row.configured ? 'green' : 'slate'}>{row.configured ? '등록됨' : '미등록'}</Badge>
        </div>
        <a
          href={row.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-brand-600 hover:underline"
        >
          발급받기 <ExternalLink size={12} />
        </a>
      </div>
      <p className="mb-3 text-sm text-slate-500">{row.desc}</p>

      {editing ? (
        <div className="flex gap-2">
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="키를 붙여넣으세요"
            autoComplete="off"
          />
          <Button onClick={() => save.mutate()} disabled={!value.trim() || save.isPending}>저장</Button>
          {row.configured && <Button variant="ghost" onClick={() => setEditing(false)}>취소</Button>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{row.masked}</code>
          <Button variant="secondary" onClick={() => setEditing(true)}>변경</Button>
          <Button variant="secondary" onClick={() => runTest.mutate()} disabled={runTest.isPending}>
            {runTest.isPending ? '확인 중…' : '연결 테스트'}
          </Button>
          <Button variant="ghost" className="px-2" onClick={() => remove.mutate()}>
            <Trash2 size={15} />
          </Button>
        </div>
      )}

      {test && (
        <p className={`mt-2 flex items-center gap-1.5 text-sm ${test.ok ? 'text-green-600' : 'text-red-600'}`}>
          {test.ok ? <Check size={14} /> : <X size={14} />}
          {test.ok ? test.detail ?? '정상 동작' : test.error}
        </p>
      )}
    </Card>
  );
}

function GoogleOauthCard({
  state,
  onChanged,
}: {
  state?: { clientIdConfigured: boolean; clientSecretConfigured: boolean; connected: boolean };
  onChanged: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const save = useMutation({
    mutationFn: () => api.put('/keys/google-oauth', { clientId, clientSecret }),
    onSuccess: () => {
      setClientId('');
      setClientSecret('');
      onChanged();
    },
  });
  const connect = useMutation({
    mutationFn: () => api.get<{ url: string }>('/youtube/oauth/start'),
    onSuccess: (r) => window.open(r.url, '_blank', 'width=520,height=680'),
  });
  const disconnect = useMutation({
    mutationFn: () => api.post('/youtube/oauth/disconnect'),
    onSuccess: onChanged,
  });

  const ready = state?.clientIdConfigured && state?.clientSecretConfigured;

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <KeyRound size={16} className="text-slate-500" />
        <span className="font-medium">구글 계정 연결 (내 채널 분석)</span>
        <Badge color={state?.connected ? 'green' : ready ? 'amber' : 'slate'}>
          {state?.connected ? '연결됨' : ready ? '연결 대기' : '클라이언트 미등록'}
        </Badge>
      </div>
      <p className="mb-3 text-sm text-slate-500">
        내 채널의 비공개 통계(시청 지속시간·트래픽 소스 등)를 보려면 필요합니다. 읽기 전용 권한만 요청하며 무료입니다.
        Google Cloud 콘솔에서 OAuth 클라이언트(데스크톱 앱)를 만들어 아래에 등록하세요 —
        자세한 절차는 <code className="rounded bg-slate-100 px-1 text-slate-800">tools/setup-youtube-oauth.md</code>.
      </p>

      <div className="space-y-2">
        <Input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder={state?.clientIdConfigured ? '클라이언트 ID (등록됨 — 변경 시 입력)' : '클라이언트 ID'}
        />
        <Input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={state?.clientSecretConfigured ? '클라이언트 시크릿 (등록됨 — 변경 시 입력)' : '클라이언트 시크릿'}
        />
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={!clientId.trim() || !clientSecret.trim() || save.isPending}>
            저장
          </Button>
          {ready && !state?.connected && (
            <Button variant="secondary" onClick={() => connect.mutate()}>구글 계정 연결</Button>
          )}
          {state?.connected && (
            <Button variant="ghost" onClick={() => disconnect.mutate()}>연결 해제</Button>
          )}
        </div>
      </div>
    </Card>
  );
}
