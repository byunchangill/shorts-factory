import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Download, FileText, Mic, Clapperboard, ShieldCheck, RefreshCw, Wand2, Check,
  Play, Trash2, FolderOpen, Upload, Star,
} from 'lucide-react';
import { MENU_LABELS, STATE_LABELS, PACKET_KIND_DESCRIPTIONS } from '@shared/constants';
import { api } from '@/api/client';
import { VOICE_KO, voiceLabel } from '@/voiceNames';
import { TTS_END_EVENT } from '@/api/sse';
import {
  Badge, Breadcrumb, Button, Card, ConfirmDialog, PageHeader, SearchSelect, Spinner, Textarea,
} from '@/components/ui';
import { ProgressRail, StepGuide } from '@/components/pipeline';
import { PacketCard, type PacketInfo } from '@/components/PacketCard';
import { ZoneEditor, type ZoneDraft } from '@/components/ZoneEditor';
import { SegmentPicker, type SegmentDraft } from '@/components/SegmentPicker';
import { AssetPicker } from '@/components/AssetPicker';

interface SourceInfo {
  id: string; url: string; origin: 'url' | 'file'; status: string; attempts: number; progress: number;
  error?: string; uploader?: string; license?: string; licenseNote?: string;
}
interface JobDetail {
  id: string; projectId: string; menu: 'menu-a' | 'menu-b'; title: string;
  state: string; progress: number; pipeline: string[]; downloading: boolean;
  sources: SourceInfo[];
  script: { currentVersion: number; approved: boolean };
  rightsConfirmed: boolean;
  /** 자료실에서 이 편에 담아둔 짤방·효과음 id */
  assets: string[];
  typecastVoiceId?: string;
  sceneVoiceFiles: Record<string, string>;
  exportedAt?: string;
  output: { currentVersion?: number; uploadKitReady: boolean };
}
interface ClipInfo {
  id: string; sourceId: string;
  probe?: { width: number; height: number; fps: number; duration: number };
  frames: Array<{ file: string; t: number; recommended: boolean }>;
  frameUrls: string[];
  zones: ZoneDraft[];
  cleanVersions: Array<{ v: number; tier: 1 | 2; filePath: string; createdAt: string }>;
  cleanUrls: Array<{ v: number; url: string }>;
  currentCleanVersion?: number;
  segments: SegmentDraft[];
  selectedUrl?: string; // 고른 장면만 이어붙이고 소리를 뺀 영상
}
interface SceneLine {
  sceneId: string; narration: string; subtitle: string;
  clipRef?: { clipId: string; suggestedSegment?: { in: number; out: number } };
  imagePrompt?: string;
}
interface ScriptData { version: number; title: string; scenes: SceneLine[]; notes: string }
interface ProductData {
  product: { name: string; price: string; features: string[]; sellingPoints: string[] };
  files: Array<{ name: string; url: string }>;
}

export default function JobPage() {
  const { jid } = useParams() as { jid: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [viewState, setViewState] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  // 삭제하면 이 화면이 가리키던 잡이 사라지므로 카테고리 화면으로 돌려보낸다
  const remove = useMutation({
    mutationFn: () => api.del(`/jobs/${jid}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['active-jobs'] });
      void qc.invalidateQueries({ queryKey: ['packets'] });
      navigate(j ? `/project/${j.menu}/${j.projectId}` : '/');
    },
  });

  if (!j) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <PageHeader
        backTo={`/project/${j.menu}/${j.projectId}`}
        backLabel={`${j.projectId} 카테고리로 돌아가기`}
        eyebrow={
          <Breadcrumb
            items={[
              { label: MENU_LABELS[j.menu], to: `/${j.menu}` },
              { label: j.projectId, to: `/project/${j.menu}/${j.projectId}` },
              { label: j.title },
            ]}
          />
        }
        title={j.title}
        actions={
          <Button variant="ghost" onClick={() => { remove.reset(); setConfirmDelete(true); }}>
            <Trash2 size={15} /> 작업 삭제
          </Button>
        }
      />

      <div className="flex gap-5">
        {/* 좌측 진행 레일 */}
        <aside className="w-52 shrink-0">
          <Card className="sticky top-4 p-2.5">
            <ProgressRail menu={j.menu} pipeline={j.pipeline} state={j.state} onNavigate={setViewState} />
            {(j.state === 'failed' || j.state === 'paused') && (
              <p className="mt-2 px-2 text-xs font-medium text-red-600">{STATE_LABELS[j.state]}</p>
            )}
          </Card>
        </aside>

        {/* 중앙 패널 — 바깥 레이아웃이 이미 <main>이라 여기서는 section을 쓴다 */}
        <section className="min-w-0 flex-1 space-y-4">
          {/* 무엇을 하는 단계이고 지금 뭘 해야 하는지 — 패널보다 먼저 읽히도록 맨 위에 둔다 */}
          <StepGuide menu={j.menu} pipeline={j.pipeline} state={j.state} viewing={viewState ?? undefined} />
          {/*
            소재 패널이 열리는 **첫 단계가 메뉴마다 다르다**. 해외영상 짜집기는 `draft`부터지만,
            제품정보리뷰는 포맷을 먼저 고르므로 `format_selected`부터다 (2026-08-23).
            단계 이름만 보고 고르면 제품정보리뷰의 `draft`에 영상 패널이 떠서, 포맷도 안 정한
            잡에 영상을 넣게 된다 — 그 잡은 포맷이 없어 대본을 못 쓴다.
          */}
          {(j.menu === 'menu-a'
            ? ['draft', 'collecting', 'downloading']
            : ['format_selected', 'collecting', 'downloading']
          ).includes(panelState) && (
            <>
              <SourcesPanel job={j} />
              {/*
                제품자료도 여기서 받는다 — 소재 넣는 자리가 곧 「재료를 붓는 자리」다.
                대본 화면에도 그대로 뜨므로 나중에 채워도 된다
              */}
              {j.menu === 'menu-b' && <ProductPanel jobId={j.id} />}
            </>
          )}
          {['analyzing', 'cleaning'].includes(panelState) && <ClipsPanel job={j} />}
          {['scripting', 'script_approved'].includes(panelState) && (
            <>
              {/* 제품자료는 작업마다 따로다 — 대본의 재료라 대본 화면과 같은 자리에 둔다 */}
              <ProductPanel jobId={j.id} />
              <ScriptPanel job={j} packets={jobPackets} />
            </>
          )}
          {panelState === 'scening' && <ScenesPanel job={j} packets={jobPackets} />}
          {/* `trimming`은 없앤 단계다 — 지난 잡이 그 값을 들고 오면 음성 화면을 연다 */}
          {['voicing', 'trimming'].includes(panelState) && <VoicePanel job={j} />}
          {['assembling', 'review', 'done'].includes(panelState) && (
            <ReviewPanel job={j} packets={jobPackets} />
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="영상 작업 삭제"
        pending={remove.isPending}
        error={remove.isError ? `삭제하지 못했습니다 — ${remove.error.message}` : undefined}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirmDelete(false)}
        description={
          <>
            <p>
              <b className="text-slate-800">{j.title}</b> 작업의 소재·클립·대본·요청서·산출물이
              모두 사라집니다.
            </p>
            <p className="text-xs text-slate-500">
              완전히 지우지 않고 <code>workspace/.trash/</code> 로 옮깁니다 — 되돌리려면 그 폴더를
              원래 자리로 옮기면 됩니다. 이미 내보낸 결과물 폴더는 그대로 남습니다.
            </p>
          </>
        }
      />
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
  // 이미 받아둔 영상 첨부 — yt-dlp가 못 받는 사이트의 우회로
  const attach = useMutation({
    mutationFn: (files: FileList) => {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('files', f);
      return api.upload(`/jobs/${job.id}/sources/upload`, fd);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });
  const remove = useMutation({
    mutationFn: (sid: string) => api.del(`/jobs/${job.id}/sources/${sid}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });
  const retry = (sid: string) => api.post(`/jobs/${job.id}/sources/${sid}/retry`).then(() => qc.invalidateQueries({ queryKey: ['job'] }));

  // 전부 받았는데 아직 다음 단계로 안 넘어간 상태 (서버 재시작 등으로 전진이 끊긴 경우)
  const allSourcesReady =
    job.sources.length > 0 &&
    job.sources.every((s) => s.status === 'downloaded' || s.status === 'skipped');

  const statusBadge = (s: SourceInfo) => {
    const map: Record<string, { label: string; color: 'slate' | 'brand' | 'green' | 'red' | 'amber' }> = {
      queued: { label: '대기', color: 'slate' },
      downloading: { label: `다운로드 ${s.progress.toFixed(0)}%`, color: 'brand' },
      downloaded: { label: '완료', color: 'green' },
      failed: { label: '실패', color: 'red' },
      skipped: { label: '건너뜀', color: 'amber' },
    };
    const v = map[s.status] ?? map.queued;
    return <Badge color={v.color}>{v.label}</Badge>;
  };

  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 font-semibold"><Download size={17} /> 영상 주소</h3>
      <p className="mb-3 text-sm text-slate-500">
        한 줄에 하나씩, 개수 제한 없이 붙여넣으세요. yt-dlp가 지원하는 모든 사이트를 사용할 수 있습니다.
      </p>
      <Textarea
        rows={5}
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
        placeholder={'https://www.youtube.com/watch?v=...\nhttps://www.tiktok.com/@user/video/...'}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={() => addSources.mutate()} disabled={!urls.trim() || addSources.isPending}>
          URL 추가
        </Button>
        {job.sources.length > 0 && (
          <Button
            variant={allSourcesReady ? 'primary' : 'secondary'}
            onClick={() => start.mutate()}
            disabled={job.downloading || start.isPending}
          >
            {job.downloading
              ? <>다운로드 진행 중… <Spinner /></>
              : allSourcesReady ? '다음 단계로' : '다운로드 시작'}
          </Button>
        )}
        <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {attach.isPending ? <span className="inline-flex items-center gap-1.5">첨부 중… <Spinner /></span> : '영상 파일 첨부'}
          <input
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            disabled={attach.isPending}
            onChange={(e) => {
              if (e.target.files?.length) attach.mutate(e.target.files);
              e.target.value = ''; // 같은 파일을 다시 고를 수 있게 초기화
            }}
          />
        </label>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        yt-dlp가 받지 못하는 사이트(쇼핑몰 상세페이지 등)는 직접 받은 영상 파일을 첨부하세요.
      </p>
      {(attach.error || remove.error) && (
        <p className="mt-1.5 text-xs text-red-500">{(attach.error ?? remove.error)?.message}</p>
      )}

      {allSourcesReady && !job.downloading && (
        <p className="mt-2 text-sm text-slate-500">
          영상을 모두 받았습니다. <strong>다음 단계로</strong>를 누르면 자막·워터마크 지우기로 넘어갑니다.
        </p>
      )}

      {job.sources.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="pb-1.5">URL</th><th className="pb-1.5">상태</th><th className="pb-1.5">업로더</th><th />
            </tr>
          </thead>
          <tbody>
            {job.sources.map((s) => (
              <tr key={s.id} className="border-b border-slate-100">
                <td className="max-w-[280px] truncate py-2 pr-2" title={s.url}>
                  {s.origin === 'file' && <Badge color="slate">첨부</Badge>} {s.url}
                </td>
                <td className="py-2 pr-2">
                  {statusBadge(s)}
                  {/* 한 줄로 자르면 원인이 안 보인다 — 실패 사유는 두 줄까지 그대로 보여준다 */}
                  {s.error && (
                    <p className="mt-0.5 line-clamp-2 max-w-[460px] text-xs leading-snug text-red-500" title={s.error}>
                      {s.error}
                    </p>
                  )}
                </td>
                <td className="py-2 pr-2 text-xs text-slate-500">{s.uploader ?? '—'}</td>
                <td className="whitespace-nowrap py-2 text-right">
                  {s.status === 'failed' && s.origin === 'url' && (
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void retry(s.id)}>
                      <RefreshCw size={13} /> 재시도
                    </Button>
                  )}
                  {s.status !== 'downloading' && (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs text-red-500"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(s.id)}
                    >
                      <Trash2 size={13} /> 삭제
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
  const [activeFrame, setActiveFrame] = useState<string | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set()); // 한 번에 지우려고 찍어둔 프레임
  const [cleaning, setCleaning] = useState<string | null>(null);
  const [reframing, setReframing] = useState<string | null>(null);
  const [detecting, setDetecting] = useState<string | null>(null);

  const saveZones = useMutation({
    mutationFn: ({ cid, zones }: { cid: string; zones: ZoneDraft[] }) =>
      api.put(`/jobs/${job.id}/clips/${cid}/zones`, { zones }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['clips'] }),
  });
  // 프레임을 지우는 것이 곧 "이 장면은 안 쓴다"는 선택이다 — 남은 것이 대본 소재가 된다
  const deleteFrames = useMutation({
    mutationFn: ({ cid, files }: { cid: string; files: string[] }) =>
      api.del(`/jobs/${job.id}/clips/${cid}/frames?${
        files.map((f) => `file=${encodeURIComponent(f)}`).join('&')}`),
    onSuccess: () => {
      setMarked(new Set());
      void qc.invalidateQueries({ queryKey: ['clips'] });
    },
  });
  /*
    자막 자리 다시 찾기 — 그려둔 존을 버리고 검출기로 새로 잡는다.
    "영상 재생성"은 존이 없는 클립에만 채우므로, 한 번 그린 뒤에는 이 버튼이 유일한 길이다.
    프레임을 뽑아 글자를 찾는 동안(수십 초) 응답을 기다린다 — 끝나면 클립을 다시 읽는다
  */
  const autoZones = useMutation({
    mutationFn: (cid: string) => api.post(`/jobs/${job.id}/clips/${cid}/zones/auto`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['clips'] }); },
    onError: (e: Error) => alert(e.message),
  });
  // 프레임이 5장뿐인 예전 클립, 또는 지운 것을 되살릴 때.
  // 결과는 SSE(clip)로 들어오므로 여기서는 진행 표시만 건다
  const reextract = useMutation({
    mutationFn: (cid: string) => {
      setReframing(cid);
      return api.post(`/jobs/${job.id}/clips/${cid}/frames/reextract`);
    },
  });
  // 정리는 길게 걸려 서버가 즉시 응답하고 결과는 SSE로 온다.
  // 지난 실행의 종료 기록이 남아 있으면 시작하자마자 표시가 꺼지므로 먼저 지운다
  const clean = useMutation({
    mutationFn: ({ cid, tier }: { cid: string; tier: 1 | 2 }) => {
      qc.removeQueries({ queryKey: ['clean-end', job.id, cid] });
      setCleaning(cid);
      return api.post(`/jobs/${job.id}/clips/${cid}/clean`, { tier });
    },
    // 요청 자체가 거부되면(존 없음 등) SSE가 오지 않는다 — 여기서 내린다
    onError: () => setCleaning(null),
  });
  /**
   * 영상 재생성 — 이 단계의 마무리.
   * 고른 장면만 잇고, 그린 존으로 자막·워터마크를 지우고, 소리를 빼고, 대본 단계로 넘어간다.
   * 클립 수만큼 걸리므로 서버는 즉시 답하고 진행은 SSE로 온다.
   */
  const regenerate = useMutation({
    // 존을 가져올 클립은 호출하는 쪽이 넘긴다 — 지금 보고 있는 클립이다
    mutationFn: (zonesFrom?: string) =>
      api.post(`/jobs/${job.id}/regenerate`, { zonesFrom }),
    onError: (e: Error) => alert(e.message),
  });
  const progress = useQuery<{ done: number; total: number; clipId: string } | undefined>({
    queryKey: ['regenerate', job.id],
    enabled: false, // 서버에 물어볼 것이 없다. SSE가 적어둔 값을 구독만 한다
    queryFn: () => undefined,
  });
  const running = progress.data;

  // 재추출 결과는 SSE로 들어온다 — 클립 데이터가 갱신되면 진행 표시를 내린다
  useEffect(() => { setReframing(null); }, [clips.dataUpdatedAt]);

  /**
   * 정리 종료 신호. SSE 핸들러가 캐시에 적어두면 여기서 읽어 표시를 내린다.
   * 클립 데이터 갱신만 보고 판단하면 안 된다 — 존을 저장해도 클립이 갱신되므로
   * 정리가 도는 중에 표시가 먼저 꺼진다.
   */
  const cleanEnd = useQuery<{ at: number; error?: string } | undefined>({
    queryKey: ['clean-end', job.id, cleaning ?? ''],
    enabled: false, // 서버에 물어볼 것이 없다. 캐시 구독만 한다
    queryFn: () => undefined,
  });
  useEffect(() => {
    if (cleaning && cleanEnd.data) setCleaning(null);
  }, [cleaning, cleanEnd.data]);

  const list = clips.data ?? [];
  const current = list.find((c) => c.id === activeClip) ?? list[0];

  // 프레임 + 표시용 URL을 한 덩어리로 (서버가 같은 순서로 내려준다)
  const frames = (current?.frames ?? []).map((f, i) => ({ ...f, url: current!.frameUrls[i] }));
  const shownFrame = frames.find((f) => f.file === activeFrame) ?? frames[0];
  // 1차(크롭·보간·블러)와 2차(AI 인페인팅)는 서로 다른 존을 필요로 한다
  const tier1Zones = (current?.zones ?? []).filter((z) => z.method !== 'inpaint').length;
  const tier2Zones = (current?.zones ?? []).filter((z) => z.method === 'inpaint').length;

  const toggleMark = (file: string) =>
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-semibold"><Wand2 size={17} /> 쓸 장면 고르기</h3>
          {running ? (
            <span className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
              <Spinner /> 영상 만드는 중 {running.done}/{running.total} · {running.clipId}
            </span>
          ) : (
            <Button onClick={() => regenerate.mutate(current?.id)} disabled={regenerate.isPending || list.length === 0}>
              <Wand2 size={15} /> 영상 재생성 → 대본으로
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => { setActiveClip(c.id); setActiveFrame(null); setMarked(new Set()); }}
              className={`rounded-lg border px-3 py-1.5 text-sm ${current?.id === c.id ? 'border-brand-500 bg-brand-50 font-medium' : 'border-slate-200'}`}
            >
              {c.id}
              {c.currentCleanVersion && <Badge color="green">v{c.currentCleanVersion}</Badge>}
            </button>
          ))}
          {list.length === 0 && <p className="text-sm text-slate-500">클립이 없습니다 — 다운로드가 끝나면 자동 생성됩니다.</p>}
        </div>
      </Card>

      {current && current.probe && shownFrame && (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-500">
              전체 {frames.length}장 · <span className="font-medium text-slate-700">남은 장면으로 대본을 씁니다.</span>
              {' '}안 쓸 장면을 지우세요.
            </p>
            <div className="flex shrink-0 items-center gap-1">
              {marked.size > 0 && (
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs text-red-600"
                  disabled={deleteFrames.isPending}
                  onClick={() => deleteFrames.mutate({ cid: current.id, files: [...marked] })}
                >
                  <Trash2 size={12} /> 찍은 {marked.size}장 삭제
                </Button>
              )}
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                title="원본에서 글자를 찾아 자막·워터마크 존을 다시 잡습니다 — 지금 그려둔 존은 지워집니다"
                disabled={autoZones.isPending}
                onClick={() => autoZones.mutate(current.id)}
              >
                {autoZones.isPending
                  ? <span className="inline-flex items-center gap-1">글자 찾는 중… <Spinner /></span>
                  : <><Wand2 size={12} /> 자막 자리 자동 찾기</>}
              </Button>
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                title="원본 영상에서 프레임을 전부 다시 뽑습니다 — 프레임이 몇 장 없는 예전 클립이나, 지운 것을 되살릴 때 쓰세요"
                disabled={reframing === current.id}
                onClick={() => reextract.mutate(current.id)}
              >
                {reframing === current.id
                  ? <span className="inline-flex items-center gap-1">불러오는 중… <Spinner /></span>
                  : <><RefreshCw size={12} /> 전체 프레임 불러오기</>}
              </Button>
            </div>
          </div>
          {/* 왼쪽 = 프레임 목록, 오른쪽 = 고른 프레임. 세로 영상이라 목록이 옆으로 붙어야 둘 다 보인다 */}
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="flex max-h-[560px] flex-wrap content-start gap-2 overflow-y-auto pb-1 lg:w-72 lg:shrink-0">
              {frames.map((f) => (
                <div
                  key={f.file}
                  className={clsx(
                    'relative rounded-lg border-2 p-0.5',
                    marked.has(f.file) ? 'border-red-400 bg-red-50'
                      : shownFrame.file === f.file ? 'border-brand-500' : 'border-transparent',
                  )}
                >
                  <button onClick={() => setActiveFrame(f.file)} className="block" title="이 프레임에 존 그리기">
                    <img
                      src={f.url}
                      alt={`${f.t}초`}
                      className={clsx('h-20 w-auto rounded', marked.has(f.file) && 'opacity-40')}
                      draggable={false}
                    />
                  </button>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-600">
                    <span>{f.t.toFixed(1)}초</span>
                    {f.recommended && <span className="text-brand-600" title="장면이 바뀌는 지점">▸</span>}
                    <button
                      className={clsx('ml-auto', marked.has(f.file) ? 'text-red-500' : 'text-slate-500 hover:text-red-500')}
                      title={marked.has(f.file) ? '삭제 취소' : '삭제할 프레임으로 찍기'}
                      onClick={() => toggleMark(f.file)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="min-w-0 flex-1">
              <ZoneEditor
                frameUrl={shownFrame.url}
                frameTime={shownFrame.t}
                frameTimes={frames.map((f) => f.t)}
                duration={current.probe.duration}
                videoWidth={current.probe.width}
                videoHeight={current.probe.height}
                zones={current.zones}
                onChange={(zones) => saveZones.mutate({ cid: current.id, zones })}
                detecting={detecting}
                onDetect={async (zone) => {
                  setDetecting(zone.id);
                  try {
                    const r = await api.post<{
                      verdict: 'ranges' | 'always' | 'none' | 'unclear';
                      ranges: Array<{ t0: number; t1: number }>;
                      frames: Array<{ t: number; score: number }>;
                    }>(`/jobs/${job.id}/clips/${current.id}/zones/detect`, {
                      zone: { x: zone.x, y: zone.y, w: zone.w, h: zone.h },
                    });
                    // 애매하면 구간을 넣지 않는다 — 틀린 구간이 조용히 적용되면 더 나쁘다
                    if (r.verdict !== 'ranges') {
                      alert({
                        always: '이 영역에는 영상 내내 글자가 있습니다.\n전체 구간으로 두시면 됩니다.',
                        none: '이 영역에서 글자를 찾지 못했습니다.\n영역이 자막에서 벗어났는지 확인해 보세요.',
                        unclear: '구간을 특정하지 못했습니다.\n배경과 잘 구분되지 않는 경우입니다. 직접 골라주세요.',
                      }[r.verdict]);
                      return;
                    }
                    const [best, ...rest] = r.ranges;
                    saveZones.mutate({
                      cid: current.id,
                      zones: current.zones.map((z) =>
                        z.id === zone.id ? { ...z, t0: best.t0, t1: best.t1 } : z),
                    });
                    if (rest.length) {
                      alert(
                        `${best.t0.toFixed(1)}~${best.t1.toFixed(1)}초를 넣었습니다.\n`
                        + `다른 구간도 있습니다: ${rest.map((x) => `${x.t0.toFixed(1)}~${x.t1.toFixed(1)}초`).join(', ')}\n`
                        + '필요하면 존을 하나 더 그려서 그 구간을 지정하세요.',
                      );
                    }
                  } finally {
                    setDetecting(null);
                  }
                }}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => clean.mutate({ cid: current.id, tier: 1 })}
                  disabled={tier1Zones === 0 || cleaning === current.id}
                >
                  1차 제거 실행 (크롭/블러/보간)
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => clean.mutate({ cid: current.id, tier: 2 })}
                  disabled={tier2Zones === 0 || cleaning === current.id}
                >
                  AI 인페인팅 (2차)
                </Button>
                {cleaning === current.id && <span className="flex items-center gap-1.5 text-sm text-slate-500"><Spinner /> 처리 중…</span>}
              </div>
              {/*
                비활성 버튼은 이유를 말해주지 않으면 고장으로 보인다.
                무엇을 해야 눌리는지 그 자리에서 알려준다.
              */}
              {cleaning !== current.id && (tier1Zones === 0 || tier2Zones === 0) && (
                <p className="mt-2 text-xs text-slate-500">
                  {current.zones.length === 0
                    ? '비워두면 "영상 재생성"이 자막·워터마크 자리를 스스로 찾아 지웁니다. 잘못 잡거나 놓치는 곳이 있을 때만 직접 드래그하세요 — 그린 자리가 있으면 그 클립은 그것을 씁니다.'
                    : tier1Zones === 0
                      ? 'AI 인페인팅 존만 있습니다. 1차 제거는 크롭·보간·블러 방식 존이 있어야 실행됩니다.'
                      : 'AI 인페인팅은 존의 방식을 "AI 인페인팅"으로 바꾼 것이 있어야 켜집니다 (iopaint 설치 필요).'}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-6">
            {current.selectedUrl && (
              <div>
                <p className="mb-1.5 text-sm font-medium">
                  이 클립의 결과물 · 고른 {current.segments.length}컷 · 소리 없음
                </p>
                <video src={current.selectedUrl} controls className="max-h-72 rounded-lg bg-black" />
              </div>
            )}
            {current.cleanUrls.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-500">
                  자막만 지운 원본 길이 (v{current.currentCleanVersion})
                </p>
                <video
                  src={current.cleanUrls.find((u) => u.v === current.currentCleanVersion)?.url}
                  controls
                  className="max-h-72 rounded-lg bg-black"
                />
              </div>
            )}
          </div>
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-semibold"><FileText size={17} /> 대본</h3>
            <p className="mt-1 text-xs text-slate-500">
              다시 발행하면 대기 중인 같은 종류 요청서는 정리되고 최신 소재로 새로 만들어집니다.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="secondary"
              title={PACKET_KIND_DESCRIPTIONS['product-extract']}
              onClick={() => issue.mutate('product-extract')}
              disabled={issue.isPending}
            >
              AI에게 제품정보 정리 맡기기
            </Button>
            <Button onClick={() => issue.mutate('script')} disabled={issue.isPending}>
              AI에게 대본 맡기기
            </Button>
          </div>
        </div>
        {issue.error && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {issue.error.message}
            {' '}
            <span className="font-medium">위 "제품자료"에 상세페이지를 올린 뒤 다시 시도하세요.</span>
          </p>
        )}
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
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="pb-1.5 pr-2">씬</th><th className="pb-1.5 pr-2">나레이션</th>
                <th className="pb-1.5 pr-2">자막</th><th className="pb-1.5">소재</th>
              </tr>
            </thead>
            <tbody>
              {script.data.scenes.map((s) => (
                <tr key={s.sceneId} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-2 font-mono text-xs text-slate-500">{s.sceneId}</td>
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
              AI에게 씬 이미지 맡기기
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

interface TypecastVoice {
  id: string;
  name: string;
  model: string;
  emotions: string[];
}
interface EngineInfo {
  provider: 'typecast' | 'voicebox';
  typecastReady: boolean;
  typecastVoices: TypecastVoice[];
  error?: string;
  voiceboxReady: boolean;
  voiceboxProfiles: Array<{ id: string; name: string; language: string; voiceType: string }>;
  voiceboxUrl: string;
}

/*
  자주 쓰는 캐릭터 고정 — 이 PC에서만 쓰는 취향이라 서버 설정에 넣지 않는다.
*/
const PIN_KEY = 'typecastPins';
function readVoicePins(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return [];
  }
}
function writeVoicePins(pins: string[]): string[] {
  localStorage.setItem(PIN_KEY, JSON.stringify(pins));
  return pins;
}

/** ssfm-v30 감정 프리셋 한글 라벨 */
const EMOTION_LABELS: Record<string, string> = {
  normal: '기본', happy: '밝게', sad: '차분하게', angry: '강하게',
  whisper: '속삭임', toneup: '톤 높게', tonedown: '톤 낮게',
  tonemid: '톤 중간',
};

function VoicePanel({ job }: { job: JobDetail }) {
  const qc = useQueryClient();
  const engineInfo = useQuery({
    queryKey: ['tts-engine'],
    queryFn: () => api.get<EngineInfo>('/tts/engine'),
  });
  const script = useQuery({
    queryKey: ['script', job.id, job.script.currentVersion],
    queryFn: () => api.get<ScriptData | null>(`/jobs/${job.id}/script`),
    enabled: job.script.currentVersion > 0,
  });

  const [typecastVoiceId, setTypecastVoiceId] = useState(job.typecastVoiceId ?? '');
  const [pins, setPins] = useState<string[]>(readVoicePins);
  const [emotion, setEmotion] = useState('');
  const [runningTts, setRunningTts] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const voices = engineInfo.data?.typecastVoices ?? [];
  const selectedVoice = voices.find((v) => v.id === typecastVoiceId);

  /*
    캐릭터가 590종이라 목록만 보여 주면 못 찾는다 — 치면서 걸러 고른다.
    순서는 고정 → 한글 이름 → 나머지. 나레이션이 한국어라 로마자만 있는 캐릭터는 뒤로 간다.
  */
  const shownVoices = [...voices]
    .sort((a, b) => voiceLabel(a.name).localeCompare(voiceLabel(b.name), 'ko'))
    .sort((a, b) => Number(!VOICE_KO[a.name]) - Number(!VOICE_KO[b.name]))
    .sort((a, b) => Number(!pins.includes(a.id)) - Number(!pins.includes(b.id)));
  const pinned = pins.map((id) => voices.find((v) => v.id === id)).filter((v) => !!v);

  const pickVoice = (id: string) => {
    setTypecastVoiceId(id);
    setEmotion('');
  };
  const togglePin = () => setPins(writeVoicePins(
    pins.includes(typecastVoiceId) ? pins.filter((p) => p !== typecastVoiceId) : [...pins, typecastVoiceId],
  ));

  // 합성이 끝나면(성공·실패 모두) 스피너를 끈다 — SSE로만 알 수 있다
  useEffect(() => {
    const stop = () => setRunningTts(false);
    window.addEventListener(TTS_END_EVENT, stop);
    return () => window.removeEventListener(TTS_END_EVENT, stop);
  }, []);

  const upload = useMutation({
    mutationFn: ({ sceneId, file }: { sceneId: string; file: File }) => {
      const fd = new FormData();
      fd.append('sceneId', sceneId);
      fd.append('file', file);
      return api.upload(`/jobs/${job.id}/voice/upload`, fd);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });
  const removeUpload = useMutation({
    mutationFn: (sceneId: string) =>
      fetch(`/api/jobs/${job.id}/voice/upload/${sceneId}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });
  const tts = useMutation({
    mutationFn: () => {
      setRunningTts(true);
      return api.post(`/jobs/${job.id}/tts`, { typecastVoiceId, emotion: emotion || undefined });
    },
    onError: (e: Error) => {
      setRunningTts(false);
      alert(e.message);
    },
  });
  const next = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/transition`, { to: 'assembling' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job'] }),
  });

  const preview = async () => {
    if (!typecastVoiceId) return;
    setPreviewing(true);
    try {
      const r = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: typecastVoiceId, emotion: emotion || undefined }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: '미리듣기 실패' }));
        throw new Error(err.error);
      }
      const blob = await r.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      await audio.play();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const scenes = script.data?.scenes ?? [];
  const uploadedCount = scenes.filter((s) => job.sceneVoiceFiles?.[s.sceneId]).length;
  const allUploaded = scenes.length > 0 && uploadedCount === scenes.length;

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-1 flex items-center gap-2 font-semibold"><Mic size={17} /> 나레이션 음성</h3>
        <p className="mb-3 text-sm text-slate-500">
          씬에 음성 파일을 첨부하면 그 파일을 쓰고, 첨부하지 않은 씬만{' '}
          {engineInfo.data?.provider === 'voicebox' ? 'Voicebox' : '타입캐스트'}로 합성합니다.
        </p>

        {/*
          합성 방식은 설정에서 고른다. 여기서는 그 방식에 필요한 것만 묻는다 —
          두 벌을 한 화면에 늘어놓으면 무엇이 실제로 쓰이는지 알 수 없다.
        */}
        {!allUploaded && engineInfo.data?.provider === 'voicebox' && (
          <VoiceboxPicker job={job} engine={engineInfo.data} />
        )}

        {!allUploaded && engineInfo.data?.provider !== 'voicebox' && (
          <div className="space-y-3">
            {engineInfo.data && !engineInfo.data.typecastReady ? (
              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-medium">타입캐스트 API 키가 없습니다</p>
                <p className="mt-0.5">
                  아래 씬 목록에서 음성 파일을 직접 첨부하거나,{' '}
                  <Link to="/keys" className="underline">API 키 메뉴</Link>에서 타입캐스트 키를 등록하세요.
                </p>
              </div>
            ) : (
              <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">캐릭터</span>
                <SearchSelect
                  className="w-64"
                  options={shownVoices.map((v) => ({
                    value: v.id,
                    label: voiceLabel(v.name),
                    pinned: pins.includes(v.id),
                  }))}
                  value={typecastVoiceId}
                  onPick={pickVoice}
                  placeholder={`이름으로 검색 (${voices.length}종)`}
                  emptyText="그 이름의 캐릭터가 없습니다"
                />
                <Button
                  variant="ghost"
                  className="px-2"
                  onClick={togglePin}
                  disabled={!typecastVoiceId}
                  title={pins.includes(typecastVoiceId) ? '고정 해제' : '자주 쓰는 음성으로 고정'}
                >
                  <Star size={15} className={pins.includes(typecastVoiceId) ? 'fill-brand-500 text-brand-500' : ''} />
                </Button>

                {selectedVoice && selectedVoice.emotions.length > 0 && (
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={emotion}
                    onChange={(e) => setEmotion(e.target.value)}
                  >
                    <option value="">감정 기본</option>
                    {selectedVoice.emotions.map((em) => (
                      <option key={em} value={em}>{EMOTION_LABELS[em] ?? em}</option>
                    ))}
                  </select>
                )}

                <Button variant="secondary" onClick={preview} disabled={!typecastVoiceId || previewing}>
                  {previewing ? <Spinner /> : <Play size={14} />} 미리듣기
                </Button>
                {engineInfo.data?.error && (
                  <span className="text-xs text-red-600">캐릭터 목록 오류: {engineInfo.data.error}</span>
                )}
              </div>
              {pinned.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500">고정</span>
                  {pinned.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => pickVoice(v.id)}
                      className={clsx(
                        'rounded-full border px-2.5 py-1 text-xs',
                        v.id === typecastVoiceId
                          ? 'border-brand-400 bg-brand-50 text-brand-700'
                          : 'border-slate-300 hover:border-brand-400',
                      )}
                    >
                      {voiceLabel(v.name)}
                    </button>
                  ))}
                </div>
              )}
              </>
            )}
          </div>
        )}

        {allUploaded && (
          <p className="rounded-md bg-green-50 p-2 text-sm text-green-700">
            모든 씬에 음성 파일이 첨부되어 합성 없이 진행합니다.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => tts.mutate()}
            disabled={tts.isPending || (!allUploaded && !typecastVoiceId)}
          >
            음성 준비 실행
          </Button>
          <Button variant="secondary" onClick={() => next.mutate()}>음성 확인 완료 → 조립 단계로</Button>
          {runningTts && (
            <span className="flex items-center gap-1.5 text-sm text-slate-500"><Spinner /> 준비 중… 완료되면 알림</span>
          )}
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">씬별 음성</h3>
          <span className="text-sm text-slate-500">첨부 {uploadedCount} / {scenes.length}씬</span>
        </div>
        {scenes.length === 0 ? (
          <p className="text-sm text-slate-500">대본이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {scenes.map((s, i) => {
              const uploaded = job.sceneVoiceFiles?.[s.sceneId];
              return (
                <li key={s.sceneId} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
                  <span className="w-10 shrink-0 font-mono text-xs text-slate-500">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate" title={s.narration}>{s.narration}</span>
                  {uploaded ? (
                    <>
                      <Badge color="green">파일 첨부됨</Badge>
                      <audio
                        controls
                        className="h-8"
                        src={`/media/${job.menu}/${job.projectId}/jobs/${job.id}/voice/${uploaded}`}
                      />
                      <Button variant="ghost" className="px-2 py-1" onClick={() => removeUpload.mutate(s.sceneId)}>
                        <Trash2 size={14} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge>타입캐스트 합성 예정</Badge>
                      <label className="cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50">
                        파일 첨부
                        <input
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) upload.mutate({ sceneId: s.sceneId, file });
                          }}
                        />
                      </label>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
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
    onError: (e: Error) => alert(e.message),
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
  const exportInfo = useQuery({
    queryKey: ['export', job.id],
    queryFn: () => api.get<{ targetDir: string; exportedAt?: string; includeSources: boolean }>(`/jobs/${job.id}/export`),
  });
  const runExport = useMutation({
    mutationFn: () => api.post<{ rootDir: string; copied: string[]; skipped: string[] }>(`/jobs/${job.id}/export`),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['export'] });
      void qc.invalidateQueries({ queryKey: ['job'] });
      alert(`${r.copied.length}개 파일을 내보냈습니다.\n${r.rootDir}`);
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
              <p className="font-medium">영상 사용 권리 확인</p>
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
                AI에게 업로드 문구 맡기기
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

      <Card>
        <h3 className="flex items-center gap-2 font-semibold"><Download size={17} /> 따로 내려받기</h3>
        <p className="mt-2 text-sm text-slate-500">
          필요한 것만 브라우저로 바로 받습니다. 여러 개면 zip으로 묶고, 하나면 그대로 받습니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {([
            ['final', '최종영상'],
            ['video', '영상'],
            ['audio', '음성'],
            ['script', '대본·자막'],
            ['uploadKit', '업로드킷'],
          ] as const).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => void api.download(`/jobs/${job.id}/download/${kind}`)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:border-brand-400 hover:text-brand-700"
            >
              <Download size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="mt-4 border-t border-slate-200 pt-3">
          <p className="text-sm font-medium">캡컷에서 직접 편집하기</p>
          <p className="mt-1 text-xs text-slate-500">
            컷 영상·나레이션·자막(SRT)을 <b>씬 순서대로 번호를 붙여</b> 묶어 줍니다.
            캡컷에 통째로 끌어다 놓으면 이름 순으로 트랙에 올라갑니다.
            좌우반전·색보정·확대는 그쪽에서 직접 거세요.
          </p>
          <button
            type="button"
            onClick={() => void api.download(`/jobs/${job.id}/download/capcut`)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:border-brand-400 hover:text-brand-700"
          >
            <Download size={14} /> 캡컷 재료 받기
          </button>
        </div>
        <AssetPicker
          jobId={job.id}
          menu={job.menu}
          picked={job.assets ?? []}
          onChange={() => void qc.invalidateQueries({ queryKey: ['job', job.id] })}
        />
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold"><FolderOpen size={17} /> 제품 폴더로 내보내기</h3>
          <Button variant="secondary" onClick={() => runExport.mutate()} disabled={runExport.isPending}>
            {runExport.isPending ? <><Spinner /> 내보내는 중…</> : '지금 내보내기'}
          </Button>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          최종영상·영상·음성·대본·이미지·업로드킷을 용도별 폴더로 정리해 저장합니다.
          완료 처리하면 자동으로 한 번 더 내보냅니다.
        </p>
        {exportInfo.data && (
          <div className="mt-2 space-y-1 text-sm">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500">저장 위치</span>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{exportInfo.data.targetDir}</code>
            </p>
            {exportInfo.data.exportedAt && (
              <p className="text-xs text-slate-500">
                마지막 내보내기: {new Date(exportInfo.data.exportedAt).toLocaleString('ko-KR')}
              </p>
            )}
            {!exportInfo.data.includeSources && (
              <p className="text-xs text-slate-500">다운로드 원본은 제외됩니다 (설정에서 포함 가능)</p>
            )}
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

// ── 제품자료 (작업마다 따로) ──────────────────────────────────────

export function ProductPanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const data = useQuery({
    queryKey: ['product', jobId],
    queryFn: () => api.get<ProductData>(`/jobs/${jobId}/product`),
  });
  const upload = useMutation({
    // 파일 선택·폴더 선택·드래그 모두 같은 경로로 보낸다.
    // 세 번째 인자의 파일명에 상대경로를 넣으면 서버가 폴더 구조를 살려 저장한다
    mutationFn: (files: Array<{ file: File; path: string }>) => {
      const fd = new FormData();
      for (const { file, path } of files) fd.append('files', file, path);
      return api.upload<{ uploaded: string[]; errors: string[] }>(
        `/jobs/${jobId}/product/files`, fd);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['product'] }),
  });
  const removeFile = useMutation({
    mutationFn: (name: string) =>
      api.del(`/jobs/${jobId}/product/files?file=${encodeURIComponent(name)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['product'] }),
  });

  /** input[type=file]에서 온 목록 — 폴더 선택이면 webkitRelativePath에 경로가 담긴다 */
  const fromInput = (list: FileList) =>
    Array.from(list).map((file) => ({
      file,
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));

  const product = data.data?.product;

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-2 font-medium">쿠팡 상세페이지 첨부</h3>
        <p className="mb-3 text-sm text-slate-500">
          상세페이지 캡처·텍스트를 올리면 "제품정보 추출" 요청서로 AI가 product.json을 만듭니다.
          <br />
          <span className="text-slate-500">
            압축파일(zip)은 자동으로 풀고, 폴더는 구조를 그대로 살려 저장합니다. 끌어다 놓아도 됩니다.
          </span>
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void collectDropped(e.dataTransfer.items).then((files) => {
              if (files.length) upload.mutate(files);
            });
          }}
          className={clsx(
            'rounded-lg border-2 border-dashed py-6 text-center text-sm',
            dragging ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-500',
          )}
        >
          <p className="mb-3">여기로 파일·폴더·압축파일을 끌어다 놓으세요</p>
          <div className="flex justify-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Upload size={15} /> 파일 선택
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) upload.mutate(fromInput(e.target.files));
                  e.target.value = '';
                }}
              />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <FolderOpen size={15} /> 폴더 선택
              <input
                type="file"
                multiple
                className="hidden"
                // 리액트 타입에 없는 비표준 속성 — 폴더 선택을 여는 유일한 방법이다
                {...{ webkitdirectory: '', directory: '' }}
                onChange={(e) => {
                  if (e.target.files?.length) upload.mutate(fromInput(e.target.files));
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
        {upload.isPending && <p className="mt-2 text-sm text-slate-500">올리는 중…</p>}
        {upload.error && <p className="mt-2 text-sm text-red-600">{upload.error.message}</p>}
        {(upload.data?.errors ?? []).length > 0 && (
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {upload.data!.errors.map((e) => <p key={e}>압축을 풀지 못했습니다 — {e}</p>)}
          </div>
        )}
        {(data.data?.files ?? []).length > 0 && (
          <>
            <p className="mt-3 text-xs text-slate-500">첨부 {data.data!.files.length}개</p>
            <ul className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data.data!.files.map((f) => (
                <li key={f.name} className="group relative rounded-lg border border-slate-200 p-1.5 text-xs">
                  {/\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name) ? (
                    <img src={f.url} alt={f.name} className="mb-1 h-24 w-full rounded object-cover" />
                  ) : null}
                  <p className="truncate text-slate-600" title={f.name}>{f.name}</p>
                  <button
                    className="absolute right-1 top-1 rounded bg-white/90 p-1 text-slate-500 opacity-0 hover:text-red-500 group-hover:opacity-100"
                    title="이 자료 삭제"
                    disabled={removeFile.isPending}
                    onClick={() => removeFile.mutate(f.name)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 font-medium">추출된 제품 정보 (product.json)</h3>
        {product?.name ? (
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">제품명</dt><dd className="font-medium">{product.name}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">가격</dt><dd>{product.price}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">핵심 기능</dt><dd>{product.features.join(', ')}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">구매 포인트</dt><dd>{product.sellingPoints.join(', ')}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">아직 추출되지 않았습니다. 작업 화면에서 "제품정보 추출" 요청서를 발행하세요.</p>
        )}
      </Card>
    </div>
  );
}

async function collectDropped(items: DataTransferItemList): Promise<Array<{ file: File; path: string }>> {
  const out: Array<{ file: File; path: string }> = [];

  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, path: prefix ? `${prefix}/${file.name}` : file.name });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries는 한 번에 일부만 준다 — 빈 배열이 올 때까지 반복해야 전부 읽힌다
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, prefix ? `${prefix}/${entry.name}` : entry.name);
    }
  };

  const entries = Array.from(items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  for (const e of entries) await walk(e, '');
  return out;
}


/**
 * Voicebox는 사용자가 켜 둔 로컬 서버다 — 앱이 띄우지 않는다.
 * 꺼져 있으면 "고장"이 아니라 "켜세요"이므로, 켜는 방법을 그 자리에서 알려준다.
 */
function VoiceboxPicker({ job, engine }: { job: JobDetail; engine: EngineInfo }) {
  const qc = useQueryClient();
  const pick = useMutation({
    mutationFn: (voiceboxProfileId: string) => api.put('/settings', { voiceboxProfileId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['tts-engine'] });
    },
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ voiceboxProfileId: string; speechRate: number; voicePitchSemitones: number }>('/settings'),
  });

  if (!engine.voiceboxReady) {
    return (
      <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
        <p className="font-medium">Voicebox 서버가 꺼져 있습니다</p>
        <p className="mt-0.5">
          아래 명령으로 켠 뒤 이 화면을 새로고침하세요. <code>--data-dir</code>를 빼면
          현재 폴더에 생성물이 쌓입니다.
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-white/60 p-2 text-xs">
{`voicebox-server.exe --host 127.0.0.1 --port 17493 \
  --data-dir "C:/Users/chang/AppData/Local/voicebox-data"`}
        </pre>
        <p className="mt-1 text-xs">찾는 주소: {engine.voiceboxUrl}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">목소리</span>
        <select
          className="min-w-[240px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={settings.data?.voiceboxProfileId ?? ''}
          onChange={(e) => pick.mutate(e.target.value)}
        >
          <option value="">선택하세요 ({engine.voiceboxProfiles.length}개)</option>
          {engine.voiceboxProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.voiceType === 'cloned' ? '복제' : '프리셋'} ({p.language})
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-slate-500">
        속도 {settings.data?.speechRate ?? 1}배 · 음정 {settings.data?.voicePitchSemitones ?? 0}반음으로
        합성합니다 (설정에서 바꿉니다). 씬 {job.script.currentVersion > 0 ? '' : ''}하나에 한 문장으로
        나뉘어 있어야 뒷문장이 잘리지 않습니다.
      </p>
    </div>
  );
}
