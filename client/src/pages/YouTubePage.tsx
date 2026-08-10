import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { Search, Flame, Users, BarChart3, Plus, ExternalLink } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Input, Modal, Spinner } from '@/components/ui';

interface YtVideo {
  videoId: string; title: string; channelId: string; channelTitle: string;
  publishedAt: string; thumbnail: string; viewCount: number; likeCount: number;
  durationSec: number; url: string;
}
interface YtStatus {
  keyConfigured: boolean;
  oauthConnected: boolean;
  quota: { used: number; total: number; remaining: number };
}

type Tab = 'search' | 'popular' | 'channel' | 'mine';

const TABS: Array<[Tab, string, typeof Search]> = [
  ['search', '키워드/쇼츠 검색', Search],
  ['popular', '인기 쇼츠', Flame],
  ['channel', '타채널 분석', Users],
  ['mine', '내 채널 분석', BarChart3],
];

export default function YouTubePage() {
  const [tab, setTab] = useState<Tab>('search');
  const status = useQuery({ queryKey: ['yt-status'], queryFn: () => api.get<YtStatus>('/youtube/status') });

  const q = status.data?.quota;
  const lowQuota = q && q.remaining < q.total * 0.1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">유튜브 리서치</h2>
        {q && (
          <div className="flex items-center gap-2 text-sm">
            <span className={clsx(lowQuota ? 'text-red-600' : 'text-slate-500')}>
              오늘 사용량 {q.used.toLocaleString()} / {q.total.toLocaleString()} 유닛
            </span>
            <Badge color={lowQuota ? 'red' : 'green'}>{lowQuota ? '한도 임박' : '무료 한도 내'}</Badge>
          </div>
        )}
      </div>

      {status.data && !status.data.keyConfigured && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="font-medium text-amber-900">YouTube API 키가 필요합니다</p>
          <p className="mt-1 text-sm text-amber-800">
            무료 키 하나로 검색·채널 분석·인기 쇼츠를 모두 사용할 수 있습니다 (하루 10,000유닛).
          </p>
          <Link to="/keys"><Button className="mt-3">API 키 등록하기</Button></Link>
        </Card>
      )}

      <nav className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium',
              tab === key ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      {tab === 'search' && <SearchTab />}
      {tab === 'popular' && <PopularTab />}
      {tab === 'channel' && <ChannelTab />}
      {tab === 'mine' && <MineTab connected={!!status.data?.oauthConnected} />}
    </div>
  );
}

// ── 공용 ──────────────────────────────────────────────────────────

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString();
}

function VideoGrid({ videos, onAdd }: { videos: YtVideo[]; onAdd?: (v: YtVideo) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((v) => (
        <Card key={v.videoId} className="p-3">
          <div className="relative">
            {v.thumbnail && <img src={v.thumbnail} alt="" className="mb-2 w-full rounded-lg" />}
            {v.durationSec > 0 && (
              <span className="absolute bottom-3 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">
                {fmtDuration(v.durationSec)}
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-sm font-medium" title={v.title}>{v.title}</p>
          <p className="mt-1 text-xs text-slate-500">{v.channelTitle}</p>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
            <span>조회 {fmtCount(v.viewCount)}</span>
            <span>·</span>
            <span>{v.publishedAt.slice(0, 10)}</span>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <a href={v.url} target="_blank" rel="noreferrer" className="flex-1">
              <Button variant="secondary" className="w-full justify-center text-xs">
                <ExternalLink size={13} /> 열기
              </Button>
            </a>
            {onAdd && (
              <Button className="text-xs" onClick={() => onAdd(v)}>
                <Plus size={13} /> 잡에 추가
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** 검색 결과를 메뉴 A 잡의 소스로 보내는 다이얼로그 */
function AddToJobModal({
  video,
  onClose,
}: {
  video: YtVideo | null;
  onClose: () => void;
}) {
  const [jobId, setJobId] = useState('');
  const jobs = useQuery({
    queryKey: ['active-jobs'],
    queryFn: () => api.get<Array<{ id: string; title: string; projectId: string; menu: string }>>('/jobs/active'),
    enabled: !!video,
  });
  const add = useMutation({
    mutationFn: () => api.post('/youtube/to-job', { jobId, urls: [video!.url] }),
    onSuccess: onClose,
  });

  const menuAJobs = (jobs.data ?? []).filter((j) => j.menu === 'menu-a');

  return (
    <Modal open={!!video} onClose={onClose} title="잡 소스로 추가">
      {video && <p className="mb-3 line-clamp-2 text-sm text-slate-600">{video.title}</p>}
      {menuAJobs.length === 0 ? (
        <p className="text-sm text-slate-500">
          진행 중인 해외영상 짜집기 작업이 없습니다. 먼저 메뉴 A에서 작업을 만드세요.
        </p>
      ) : (
        <>
          <select
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
          >
            <option value="">작업 선택</option>
            {menuAJobs.map((j) => (
              <option key={j.id} value={j.id}>{j.projectId} / {j.title}</option>
            ))}
          </select>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>취소</Button>
            <Button onClick={() => add.mutate()} disabled={!jobId || add.isPending}>추가</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── 탭 1: 키워드/쇼츠 검색 ────────────────────────────────────────

function SearchTab() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [shortsOnly, setShortsOnly] = useState(true);
  const [order, setOrder] = useState<'viewCount' | 'date'>('viewCount');
  const [days, setDays] = useState(30);
  const [adding, setAdding] = useState<YtVideo | null>(null);

  const search = useQuery({
    queryKey: ['yt-search', submitted, shortsOnly, order, days],
    queryFn: () =>
      api.get<YtVideo[]>(
        `/youtube/search?query=${encodeURIComponent(submitted)}&shortsOnly=${shortsOnly}&order=${order}&days=${days}`,
      ),
    enabled: submitted.length > 0,
  });

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-[220px] flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setSubmitted(query)}
            placeholder="검색어 (예: 무선청소기 리뷰)"
          />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={shortsOnly} onChange={(e) => setShortsOnly(e.target.checked)} />
            쇼츠만
          </label>
          <select
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={order}
            onChange={(e) => setOrder(e.target.value as 'viewCount' | 'date')}
          >
            <option value="viewCount">조회수순</option>
            <option value="date">최신순</option>
          </select>
          <select
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>최근 7일</option>
            <option value={30}>최근 30일</option>
            <option value={90}>최근 90일</option>
            <option value={365}>최근 1년</option>
          </select>
          <Button onClick={() => setSubmitted(query)} disabled={!query.trim()}>
            <Search size={15} /> 검색
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">검색 1회당 약 100유닛을 사용합니다 (1시간 캐시).</p>
      </Card>

      {search.isFetching && <div className="flex justify-center py-10"><Spinner /></div>}
      {search.error && <Card className="text-sm text-red-600">{(search.error as Error).message}</Card>}
      {search.data && search.data.length === 0 && <EmptyState message="결과가 없습니다." />}
      {search.data && <VideoGrid videos={search.data} onAdd={setAdding} />}
      <AddToJobModal video={adding} onClose={() => setAdding(null)} />
    </div>
  );
}

// ── 탭 2: 인기 쇼츠 ───────────────────────────────────────────────

function PopularTab() {
  const [categoryId, setCategoryId] = useState('');
  const [shortsOnly, setShortsOnly] = useState(true);
  const [adding, setAdding] = useState<YtVideo | null>(null);

  const categories = useQuery({
    queryKey: ['yt-categories'],
    queryFn: () => api.get<Array<{ id: string; title: string }>>('/youtube/categories'),
  });
  const popular = useQuery({
    queryKey: ['yt-popular', categoryId, shortsOnly],
    queryFn: () =>
      api.get<YtVideo[]>(`/youtube/popular?shortsOnly=${shortsOnly}${categoryId ? `&categoryId=${categoryId}` : ''}`),
  });

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">전체 카테고리</option>
            {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={shortsOnly} onChange={(e) => setShortsOnly(e.target.checked)} />
            쇼츠(3분 이하)만
          </label>
          <span className="text-xs text-slate-500">한국 인기 급상승 · 1유닛만 사용</span>
        </div>
      </Card>

      {popular.isFetching && <div className="flex justify-center py-10"><Spinner /></div>}
      {popular.error && <Card className="text-sm text-red-600">{(popular.error as Error).message}</Card>}
      {popular.data && popular.data.length === 0 && <EmptyState message="조건에 맞는 영상이 없습니다." />}
      {popular.data && <VideoGrid videos={popular.data} onAdd={setAdding} />}
      <AddToJobModal video={adding} onClose={() => setAdding(null)} />
    </div>
  );
}

// ── 탭 3: 타채널 분석 ─────────────────────────────────────────────

interface ChannelHit { channelId: string; title: string; description: string; thumbnail: string }
interface ChannelAnalysisData {
  channelId: string; title: string; thumbnail: string;
  subscriberCount: number; videoCount: number; totalViewCount: number;
  avgViews: number; uploadsPerWeek: number; shortsRatio: number;
  recentVideos: YtVideo[]; topVideos: YtVideo[];
}

function ChannelTab() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<YtVideo | null>(null);

  const hits = useQuery({
    queryKey: ['yt-channels', submitted],
    queryFn: () => api.get<ChannelHit[]>(`/youtube/channels/search?query=${encodeURIComponent(submitted)}`),
    enabled: submitted.length > 0,
  });
  const analysis = useQuery({
    queryKey: ['yt-channel', selected],
    queryFn: () => api.get<ChannelAnalysisData>(`/youtube/channels/${selected}`),
    enabled: !!selected,
  });

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setSubmitted(query)}
            placeholder="채널명 검색"
          />
          <Button onClick={() => setSubmitted(query)} disabled={!query.trim()}>
            <Search size={15} /> 검색
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">채널 검색 100유닛 · 분석은 3유닛만 사용합니다.</p>
      </Card>

      {hits.data && hits.data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {hits.data.map((c) => (
            <button
              key={c.channelId}
              onClick={() => setSelected(c.channelId)}
              className={clsx(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                selected === c.channelId ? 'border-brand-500 bg-brand-50 font-medium' : 'border-slate-200 bg-white',
              )}
            >
              {c.thumbnail && <img src={c.thumbnail} alt="" className="h-6 w-6 rounded-full" />}
              {c.title}
            </button>
          ))}
        </div>
      )}

      {analysis.isFetching && <div className="flex justify-center py-10"><Spinner /></div>}
      {analysis.error && <Card className="text-sm text-red-600">{(analysis.error as Error).message}</Card>}

      {analysis.data && (
        <>
          <Card>
            <div className="flex items-center gap-3">
              {analysis.data.thumbnail && (
                <img src={analysis.data.thumbnail} alt="" className="h-14 w-14 rounded-full" />
              )}
              <div>
                <p className="text-lg font-semibold">{analysis.data.title}</p>
                <p className="text-sm text-slate-500">
                  구독자 {fmtCount(analysis.data.subscriberCount)} · 영상 {analysis.data.videoCount.toLocaleString()}개 ·
                  총 조회 {fmtCount(analysis.data.totalViewCount)}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="최근 평균 조회수" value={fmtCount(analysis.data.avgViews)} />
              <Stat label="주당 업로드" value={`${analysis.data.uploadsPerWeek}편`} />
              <Stat label="쇼츠 비중" value={`${Math.round(analysis.data.shortsRatio * 100)}%`} />
              <Stat label="분석 표본" value={`${analysis.data.recentVideos.length}편`} />
            </div>
          </Card>

          <h3 className="pt-2 font-semibold">인기 영상 TOP 10</h3>
          <VideoGrid videos={analysis.data.topVideos} onAdd={setAdding} />
        </>
      )}
      <AddToJobModal video={adding} onClose={() => setAdding(null)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

// ── 탭 4: 내 채널 분석 (OAuth) ────────────────────────────────────

interface MineData {
  channel: { title: string; thumbnail: string; subscriberCount: number; videoCount: number; totalViewCount: number };
  summary: {
    views: number; estimatedMinutesWatched: number; averageViewDuration: number;
    averageViewPercentage: number; subscribersGained: number; subscribersLost: number;
  };
  daily: Array<{ date: string; views: number; watchMinutes: number }>;
  traffic: Array<{ source: string; views: number }>;
  topVideos: Array<YtVideo & { watchMinutes: number; avgViewDuration: number; avgViewPercentage: number }>;
  days: number;
}

function MineTab({ connected }: { connected: boolean }) {
  const [days, setDays] = useState(28);
  const mine = useQuery({
    queryKey: ['yt-mine', days],
    queryFn: () => api.get<MineData>(`/youtube/me?days=${days}`),
    enabled: connected,
    retry: false,
  });
  const connect = useMutation({
    mutationFn: () => api.get<{ url: string }>('/youtube/oauth/start'),
    onSuccess: (r) => window.open(r.url, '_blank', 'width=520,height=680'),
  });

  if (!connected) {
    return (
      <Card className="border-violet-200 bg-violet-50">
        <p className="font-medium text-violet-900">구글 계정 연결이 필요합니다</p>
        <p className="mt-1 text-sm text-violet-800">
          내 채널의 비공개 통계(시청 지속시간, 트래픽 소스, 영상별 성과)를 보려면 구글 계정을 연결하세요.
          읽기 전용 권한만 요청하며 무료입니다.
        </p>
        <div className="mt-3 flex gap-2">
          <Button onClick={() => connect.mutate()}>구글 계정 연결</Button>
          <Link to="/keys"><Button variant="secondary">API 키 메뉴에서 설정</Button></Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>최근 7일</option>
          <option value={28}>최근 28일</option>
          <option value={90}>최근 90일</option>
          <option value={365}>최근 1년</option>
        </select>
      </div>

      {mine.isFetching && <div className="flex justify-center py-10"><Spinner /></div>}
      {mine.error && <Card className="text-sm text-red-600">{(mine.error as Error).message}</Card>}

      {mine.data && (
        <>
          <Card>
            <div className="flex items-center gap-3">
              {mine.data.channel.thumbnail && (
                <img src={mine.data.channel.thumbnail} alt="" className="h-14 w-14 rounded-full" />
              )}
              <div>
                <p className="text-lg font-semibold">{mine.data.channel.title}</p>
                <p className="text-sm text-slate-500">
                  구독자 {fmtCount(mine.data.channel.subscriberCount)} · 영상 {mine.data.channel.videoCount}개
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="조회수" value={fmtCount(mine.data.summary.views)} />
              <Stat label="시청 시간" value={`${fmtCount(Math.round(mine.data.summary.estimatedMinutesWatched))}분`} />
              <Stat label="평균 시청 지속" value={`${Math.round(mine.data.summary.averageViewDuration)}초`} />
              <Stat label="평균 시청률" value={`${mine.data.summary.averageViewPercentage.toFixed(1)}%`} />
              <Stat
                label="구독자 증감"
                value={`+${mine.data.summary.subscribersGained} / -${mine.data.summary.subscribersLost}`}
              />
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 font-semibold">트래픽 소스</h3>
            {mine.data.traffic.length === 0 ? (
              <p className="text-sm text-slate-400">데이터가 없습니다.</p>
            ) : (
              <ul className="space-y-1.5">
                {mine.data.traffic.slice(0, 8).map((t) => {
                  const max = mine.data!.traffic[0].views || 1;
                  return (
                    <li key={t.source} className="flex items-center gap-2 text-sm">
                      <span className="w-24 shrink-0 text-slate-600">{t.source}</span>
                      <div className="h-2 flex-1 rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-brand-500"
                          style={{ width: `${Math.max(2, (t.views / max) * 100)}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-slate-500">{fmtCount(t.views)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 font-semibold">영상별 성과 TOP 10</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-400">
                    <th className="pb-1.5 pr-2">영상</th>
                    <th className="pb-1.5 pr-2">조회수</th>
                    <th className="pb-1.5 pr-2">시청(분)</th>
                    <th className="pb-1.5 pr-2">평균 지속</th>
                    <th className="pb-1.5">시청률</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.data.topVideos.map((v) => (
                    <tr key={v.videoId} className="border-b border-slate-100">
                      <td className="max-w-[280px] truncate py-2 pr-2" title={v.title}>
                        <a href={v.url} target="_blank" rel="noreferrer" className="hover:underline">{v.title}</a>
                      </td>
                      <td className="py-2 pr-2">{fmtCount(v.viewCount)}</td>
                      <td className="py-2 pr-2">{fmtCount(Math.round(v.watchMinutes))}</td>
                      <td className="py-2 pr-2">{Math.round(v.avgViewDuration)}초</td>
                      <td className="py-2">{v.avgViewPercentage.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
