import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Download, FileText, Mic, Clapperboard, ShieldCheck, RefreshCw, Wand2, Check } from 'lucide-react';
import { MENU_LABELS, STATE_LABELS } from '@shared/constants';
import { api } from '@/api/client';
import { Badge, Button, Card, Spinner, Textarea } from '@/components/ui';
import { ProgressRail } from '@/components/pipeline';
import { PacketCard, type PacketInfo } from '@/components/PacketCard';
import { ZoneEditor, type ZoneDraft } from '@/components/ZoneEditor';
import { SegmentPicker, type SegmentDraft } from '@/components/SegmentPicker';

interface SourceInfo {
  id: string; url: string; status: string; attempts: number; progress: number;
  error?: string; uploader?: string; license?: string; licenseNote?: string;
}
interface JobDetail {
  id: string; projectId: string; menu: 'menu-a' | 'menu-b'; title: string;
  state: string; progress: number; pipeline: string[]; downloading: boolean;
  sources: SourceInfo[];
  script: { currentVersion: number; approved: boolean };
  rightsConfirmed: boolean; ttsVoice?: string;
  output: { currentVersion?: number; uploadKitReady: boolean };
}
interface ClipInfo {
  id: string; sourceId: string;
  probe?: { width: number; height: number; fps: number; duration: number };
  frames: string[]; frameUrls: string[];
  zones: ZoneDraft[];
  cleanVersions: Array<{ v: number; tier: 1 | 2; filePath: string; createdAt: string }>;
  cleanUrls: Array<{ v: number; url: string }>;
  currentCleanVersion?: number;
  segments: SegmentDraft[];
}
interface SceneLine {
  sceneId: string; narration: string; subtitle: string;
  clipRef?: { clipId: string; suggestedSegment?: { in: number; out: number } };
  imagePrompt?: string;
}
interface ScriptData { version: number; title: string; scenes: SceneLine[]; notes: string }

export default function JobPage() {
  const { jid } = useParams() as { jid: string };
  const [viewState, setViewState] = useState<string | null>(null);

  const job = useQuery({
    queryKey: ['job', jid],
    queryFn: () => api.get<JobDetail>(`/jobs/${jid}`),
    refetchInterval: (q) => (q.state.data?.downloading ? 2000 : false),
  });
  const packets = useQuery({
    queryKey: ['packets'],
    queryFn: () => api.get<PacketInfo[]>('/packets'),
  });

  const j = job.data;
  const panelState = viewState ?? j?.state ?? 'draft';
  const jobPackets = useMemo(
    () => (packets.data ?? []).filter((p) => p.jobId === jid),
    [packets.data, jid],
  );

  if (!j) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="flex gap-5">
      {/* 좌측 진행 레일 */}
      <aside className="w-52 shrink-0">
        <Card className="sticky top-4 p-2.5">
          <p className="mb-1 px-2 text-xs text-slate-400">{MENU_LABELS[j.menu]} / {j.projectId}</p>
          <p className="mb-2.5 px-2 font-semibold">{j.title}</p>
          <ProgressRail pipeline={j.pipeline} state={j.state} onNavigate={setViewState} />
          {(j.state === 'failed' || j.state === 'paused') && (
            <p className="mt-2 px-2 text-xs text-red-500">{STATE_LABELS[j.state]}</p>
          )}
        </Card>
      </aside>

      {/* 중앙 패널 */}
      <main className="min-w-0 flex-1 space-y-4">
        {['draft', 'collecting', 'downloading'].includes(panelState) && <SourcesPanel job={j} />}
        {['analyzing', 'cleaning'].includes(panelState) && <ClipsPanel job={j} />}
        {['scripting', 'script_approved', 'format_selected'].includes(panelState) && (
          <ScriptPanel job={j} packets={jobPackets} />
        )}
        {panelState === 'trimming' && <TrimPanel job={j} />}
        {panelState === 'scening' && <ScenesPanel job={j} packets={jobPackets} />}
        {panelState === 'voicing' && <VoicePanel job={j} />}
        {['assembling', 'review', 'done'].includes(panelState) && (
          <ReviewPanel job={j} packets={jobPackets} />
        )}
      </main>
    </div>
  );
}

// ── 소스 입력 + 다운로드 ──────────────────────────────────────────

function SourcesPanel({ job }: { job: JobDetail }) {
  const qc = useQueryClient();
  const [urls, setUrls] = useState('');
  const addSources = useMutation({
    mutationFn: () =>
      api.put(`/jobs/${job.id}/sources`, {
        urls: urls.split('\n').map((u) => u.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      setUrls('');
      void qc.invalidateQueries({ queryKey: ['job'] });
    },
  });
  const start = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/download/start`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });
  const retry = (sid: string) => api.post(`/jobs/${job.id}/sources/${sid}/retry`).then(() => qc.invalidateQueries({ queryKey: ['job'] }));

  const statusBadge = (s: SourceInfo) => {
    const map: Record<string, { label: string; color: 'slate' | 'blue' | 'green' | 'red' | 'amber' }> = {
      queued: { label: '대기', color: 'slate' },
      downloading: { label: `다운로드 ${s.progress.toFixed(0)}%`, color: 'blue' },
      downloaded: { label: '완료', color: 'green' },
      failed: { label: '실패', color: 'red' },
      skipped: { label: '건너뜀', color: 'amber' },
    };
    const v = map[s.status] ?? map.queued;
    return <Badge color={v.color}>{v.label}</Badge>;
  };

  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 font-semibold"><Download size={17} /> 소스 영상 URL</h3>
      <p className="mb-3 text-sm text-slate-500">
        한 줄에 하나씩, 개수 제한 없이 붙여넣으세요. yt-dlp가 지원하는 모든 사이트를 사용할 수 있습니다.
      </p>
      <Textarea
        rows={5}
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
        placeholder={'https://www.youtube.com/watch?v=...\nhttps://www.tiktok.com/@user/video/...'}
      />
      <div className="mt-2 flex gap-2">
        <Button onClick={() => addSources.mutate()} disabled={!urls.trim() || addSources.isPending}>
          URL 추가
        </Button>
        {job.sources.length > 0 && (
          <Button variant="secondary" onClick={() => start.mutate()} disabled={job.downloading || start.isPending}>
            {job.downloading ? <>다운로드 진행 중… <Spinner /></> : '다운로드 시작'}
          </Button>
        )}
      </div>

      {job.sources.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-400">
              <th className="pb-1.5">URL</th><th className="pb-1.5">상태</th><th className="pb-1.5">업로더</th><th />
            </tr>
          </thead>
          <tbody>
            {job.sources.map((s) => (
              <tr key={s.id} className="border-b border-slate-100">
                <td className="max-w-[280px] truncate py-2 pr-2" title={s.url}>{s.url}</td>
                <td className="py-2 pr-2">
                  {statusBadge(s)}
                  {s.error && <p className="mt-0.5 max-w-[200px] truncate text-xs text-red-500" title={s.error}>{s.error}</p>}
                </td>
                <td className="py-2 pr-2 text-xs text-slate-500">{s.uploader ?? '—'}</td>
                <td className="py-2 text-right">
                  {s.status === 'failed' && (
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void retry(s.id)}>
                      <RefreshCw size={13} /> 재시도
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── 클립 정리 (존 편집 + 1차/2차 제거) ────────────────────────────

function ClipsPanel({ job }: { job: JobDetail }) {
  const qc = useQueryClient();
  const clips = useQuery({
    queryKey: ['clips', job.id],
    queryFn: () => api.get<ClipInfo[]>(`/jobs/${job.id}/clips`),
  });
  const [activeClip, setActiveClip] = useState<string | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [cleaning, setCleaning] = useState<string | null>(null);

  const saveZones = useMutation({
    mutationFn: ({ cid, zones }: { cid: string; zones: ZoneDraft[] }) =>
      api.put(`/jobs/${job.id}/clips/${cid}/zones`, { zones }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['clips'] }),
  });
  const clean = useMutation({
    mutationFn: ({ cid, tier }: { cid: string; tier: 1 | 2 }) => {
      setCleaning(cid);
      return api.post(`/jobs/${job.id}/clips/${cid}/clean`, { tier });
    },
  });
  const toScript = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/packets`, { kind: 'script' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job'] });
      void qc.invalidateQueries({ queryKey: ['packets'] });
    },
  });

  const list = clips.data ?? [];
  const current = list.find((c) => c.id === activeClip) ?? list[0];

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold"><Wand2 size={17} /> 자막/워터마크 제거</h3>
          <Button onClick={() => toScript.mutate()} disabled={toScript.isPending}>
            정리 완료 → 대본 요청서 발행
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => { setActiveClip(c.id); setFrameIdx(0); }}
              className={`rounded-lg border px-3 py-1.5 text-sm ${current?.id === c.id ? 'border-brand-500 bg-brand-50 font-medium' : 'border-slate-200'}`}
            >
              {c.id}
              {c.currentCleanVersion && <Badge color="green">v{c.currentCleanVersion}</Badge>}
            </button>
          ))}
          {list.length === 0 && <p className="text-sm text-slate-400">클립이 없습니다 — 다운로드가 끝나면 자동 생성됩니다.</p>}
        </div>
      </Card>

      {current && current.probe && (
        <Card>
          <div className="mb-2 flex items-center gap-2">
            {current.frameUrls.map((_, i) => (
              <button
                key={i}
                onClick={() => setFrameIdx(i)}
                className={`rounded px-2 py-1 text-xs ${frameIdx === i ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}
              >
                프레임 {i + 1}
              </button>
            ))}
          </div>
          <ZoneEditor
            frameUrl={current.frameUrls[frameIdx]}
            videoWidth={current.probe.width}
            videoHeight={current.probe.height}
            zones={current.zones}
            onChange={(zones) => saveZones.mutate({ cid: current.id, zones })}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              onClick={() => clean.mutate({ cid: current.id, tier: 1 })}
              disabled={current.zones.filter((z) => z.method !== 'inpaint').length === 0 || cleaning === current.id}
            >
              1차 제거 실행 (크롭/블러/보간)
            </Button>
            <Button
              variant="secondary"
              onClick={() => clean.mutate({ cid: current.id, tier: 2 })}
              disabled={current.zones.filter((z) => z.method === 'inpaint').length === 0 || cleaning === current.id}
              title="inpaint 방식으로 지정한 존이 있어야 하며, iopaint 설치 필요"
            >
              AI 인페인팅 (2차)
            </Button>
            {cleaning === current.id && <span className="flex items-center gap-1.5 text-sm text-slate-500"><Spinner /> 처리 중…</span>}
          </div>
          {current.cleanUrls.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-sm font-medium">정리본 미리보기 (v{current.currentCleanVersion})</p>
              <video
                src={current.cleanUrls.find((u) => u.v === current.currentCleanVersion)?.url}
                controls
                className="max-h-72 rounded-lg bg-black"
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── 대본 ──────────────────────────────────────────────────────────

function ScriptPanel({ job, packets }: { job: JobDetail; packets: PacketInfo[] }) {
  const qc = useQueryClient();
  const script = useQuery({
    queryKey: ['script', job.id, job.script.currentVersion],
    queryFn: () => api.get<ScriptData | null>(`/jobs/${job.id}/script`),
    enabled: job.script.currentVersion > 0,
  });
  const issue = useMutation({
    mutationFn: (kind: string) => api.post(`/jobs/${job.id}/packets`, { kind }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['packets'] });
      void qc.invalidateQueries({ queryKey: ['job'] });
    },
  });
  const approve = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/script/approve`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });

  const scriptPackets = packets.filter((p) => ['script', 'revision', 'product-extract'].includes(p.kind));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold"><FileText size={17} /> 대본</h3>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => issue.mutate('product-extract')} disabled={issue.isPending}>
              제품정보 추출 요청서
            </Button>
            <Button onClick={() => issue.mutate('script')} disabled={issue.isPending}>
              대본 요청서 발행
            </Button>
          </div>
        </div>
      </Card>

      {scriptPackets.map((p) => <PacketCard key={p.id} packet={p} />)}

      {script.data && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <p className="font-medium">
              {script.data.title || '(제목 없음)'} <Badge>v{script.data.version}</Badge>
              {job.script.approved && <Badge color="green">승인됨</Badge>}
            </p>
            {!job.script.approved && (
              <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                <Check size={15} /> 대본 승인
              </Button>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-400">
                <th className="pb-1.5 pr-2">씬</th><th className="pb-1.5 pr-2">나레이션</th>
                <th className="pb-1.5 pr-2">자막</th><th className="pb-1.5">소재</th>
              </tr>
            </thead>
            <tbody>
              {script.data.scenes.map((s) => (
                <tr key={s.sceneId} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-2 font-mono text-xs text-slate-400">{s.sceneId}</td>
                  <td className="py-2 pr-2">{s.narration}</td>
                  <td className="py-2 pr-2 text-slate-600">{s.subtitle}</td>
                  <td className="py-2 text-xs text-slate-500">
                    {s.clipRef ? `${s.clipRef.clipId} ${s.clipRef.suggestedSegment ? `(${s.clipRef.suggestedSegment.in}~${s.clipRef.suggestedSegment.out}s)` : ''}` : s.imagePrompt ? '이미지' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ── 컷 선택 (menu-a) ──────────────────────────────────────────────

function TrimPanel({ job }: { job: JobDetail }) {
  const qc = useQueryClient();
  const clips = useQuery({
    queryKey: ['clips', job.id],
    queryFn: () => api.get<ClipInfo[]>(`/jobs/${job.id}/clips`),
  });
  const [activeClip, setActiveClip] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: ({ cid, segments }: { cid: string; segments: SegmentDraft[] }) =>
      api.put(`/jobs/${job.id}/clips/${cid}/segments`, { segments }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['clips'] }),
  });
  const next = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/transition`, { to: 'voicing' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });

  const list = clips.data ?? [];
  const current = list.find((c) => c.id === activeClip) ?? list[0];
  const videoUrl = current
    ? current.cleanUrls.find((u) => u.v === current.currentCleanVersion)?.url ??
      `/media/${job.menu}/${job.projectId}/jobs/${job.id}/sources/${current.sourceId}.mp4`
    : '';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">컷 선택 — 대본 씬에 맞는 구간을 마킹하세요</h3>
          <Button onClick={() => next.mutate()} disabled={next.isPending}>컷 선택 완료 → 음성 생성</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveClip(c.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${current?.id === c.id ? 'border-brand-500 bg-brand-50 font-medium' : 'border-slate-200'}`}
            >
              {c.id} {c.segments.length > 0 && <Badge color="blue">{c.segments.length}구간</Badge>}
            </button>
          ))}
        </div>
      </Card>
      {current && videoUrl && (
        <Card>
          <SegmentPicker
            videoUrl={videoUrl}
            segments={current.segments}
            onChange={(segments) => save.mutate({ cid: current.id, segments })}
          />
        </Card>
      )}
    </div>
  );
}

// ── 씬 이미지 (menu-b) ────────────────────────────────────────────

function ScenesPanel({ job, packets }: { job: JobDetail; packets: PacketInfo[] }) {
  const qc = useQueryClient();
  const issue = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/packets`, { kind: 'scene-images' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['packets'] }),
  });
  const next = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/transition`, { to: 'voicing' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });
  const scenePackets = packets.filter((p) => p.kind === 'scene-images');
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">씬 이미지</h3>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => issue.mutate()} disabled={issue.isPending}>
              씬 이미지 요청서 발행
            </Button>
            <Button onClick={() => next.mutate()} disabled={next.isPending}>이미지 준비 완료 → 음성 생성</Button>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          요청서 결과의 이미지 프롬프트로 이미지를 준비한 뒤, 대본의 imageRef가 채워지면 조립에 사용됩니다.
        </p>
      </Card>
      {scenePackets.map((p) => <PacketCard key={p.id} packet={p} />)}
    </div>
  );
}

// ── 음성 ──────────────────────────────────────────────────────────

function VoicePanel({ job }: { job: JobDetail }) {
  const qc = useQueryClient();
  const voices = useQuery({
    queryKey: ['voices'],
    queryFn: () => api.get<Array<{ id: string; label: string }>>('/tts/voices'),
  });
  const [voice, setVoice] = useState(job.ttsVoice ?? 'ko-KR-SunHiNeural');
  const [runningTts, setRunningTts] = useState(false);
  const tts = useMutation({
    mutationFn: () => {
      setRunningTts(true);
      return api.post(`/jobs/${job.id}/tts`, { voice });
    },
  });
  const next = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/transition`, { to: 'assembling' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });

  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 font-semibold"><Mic size={17} /> TTS 나레이션</h3>
      <div className="flex items-center gap-2">
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
        >
          {(voices.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        <Button onClick={() => tts.mutate()} disabled={tts.isPending}>음성 생성</Button>
        {runningTts && <span className="flex items-center gap-1.5 text-sm text-slate-500"><Spinner /> 생성 중… 완료되면 알림</span>}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        생성이 끝나면 씬별 mp3와 타이밍이 저장되고, 이 타이밍이 자막·조립의 기준이 됩니다.
      </p>
      <div className="mt-4">
        <Button variant="secondary" onClick={() => next.mutate()}>음성 확인 완료 → 조립 단계로</Button>
      </div>
    </Card>
  );
}

// ── 조립 / 검수 ───────────────────────────────────────────────────

function ReviewPanel({ job, packets }: { job: JobDetail; packets: PacketInfo[] }) {
  const qc = useQueryClient();
  const output = useQuery({
    queryKey: ['output', job.id],
    queryFn: () => api.get<{ finalUrl?: string; uploadKit?: string }>(`/jobs/${job.id}/output`),
  });
  const rights = useMutation({
    mutationFn: (confirmed: boolean) => api.post(`/jobs/${job.id}/rights-confirm`, { confirmed }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });
  const assemble = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/assemble`),
  });
  const uploadKit = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/packets`, { kind: 'upload-kit' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['packets'] }),
  });
  const done = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/transition`, { to: 'done' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job'] });
      void qc.invalidateQueries({ queryKey: ['active-jobs'] });
    },
  });

  const kitPackets = packets.filter((p) => p.kind === 'upload-kit');

  return (
    <div className="space-y-4">
      {job.menu === 'menu-a' && (
        <Card className={job.rightsConfirmed ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}>
          <div className="flex items-start gap-3">
            <ShieldCheck size={20} className={job.rightsConfirmed ? 'text-green-600' : 'text-amber-600'} />
            <div className="flex-1">
              <p className="font-medium">소스 영상 사용 권리 확인</p>
              <p className="mt-0.5 text-sm text-slate-600">
                다운로드한 해외 영상의 재사용은 원저작자 허락 또는 라이선스 확인이 필요합니다.
                워터마크를 제거했더라도 저작권은 사라지지 않으며, 확인 책임은 사용자에게 있습니다.
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={job.rightsConfirmed}
                  onChange={(e) => rights.mutate(e.target.checked)}
                />
                모든 소스의 사용 권리를 확인했습니다
              </label>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold"><Clapperboard size={17} /> 최종 조립</h3>
          <div className="flex gap-2">
            <Button
              onClick={() => assemble.mutate()}
              disabled={assemble.isPending || (job.menu === 'menu-a' && !job.rightsConfirmed)}
            >
              {job.output.currentVersion ? '재조립' : '조립 시작'}
            </Button>
            {job.output.currentVersion && (
              <Button variant="secondary" onClick={() => uploadKit.mutate()} disabled={uploadKit.isPending}>
                업로드 킷 요청서
              </Button>
            )}
          </div>
        </div>
        {assemble.isPending && <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-500"><Spinner /> 조립 중… 완료되면 여기에 나타납니다</p>}
        {output.data?.finalUrl && (
          <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row">
            <video src={output.data.finalUrl} controls className="max-h-[480px] rounded-lg bg-black" />
            <div className="space-y-2">
              <p className="text-sm text-slate-600">final_v{job.output.currentVersion}.mp4</p>
              <a href={output.data.finalUrl} download>
                <Button variant="secondary">다운로드</Button>
              </a>
              {job.state === 'review' && (
                <Button onClick={() => done.mutate()}><Check size={15} /> 검수 통과 — 완료 처리</Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {kitPackets.map((p) => <PacketCard key={p.id} packet={p} />)}

      {output.data?.uploadKit && (
        <Card>
          <h3 className="mb-2 font-semibold">업로드 킷</h3>
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{output.data.uploadKit}</pre>
        </Card>
      )}
    </div>
  );
}
