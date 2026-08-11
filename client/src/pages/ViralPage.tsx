import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { TrendingUp, Play, Bookmark, BookmarkX, ExternalLink, Search, Flame, Radio, Plus, X } from 'lucide-react';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Input, Spinner } from '@/components/ui';

interface YtVideo {
  videoId: string; title: string; channelId: string; channelTitle: string;
  publishedAt: string; thumbnail: string; viewCount: number; likeCount: number;
  commentCount: number; durationSec: number; url: string;
}
interface ViralItem {
  video: YtVideo;
  source: 'youtube' | 'tiktok' | 'instagram';
  keywords: string[];
  subscriberCount: number;
  viewsPerDay: number;
  outlierRatio: number;
  ageDays: number;
  discoveredAt: string;
  note: string;
}
interface DiscoverResult {
  items: ViralItem[];
  quota: { used: number; total: number; remaining: number };
}

type Sort = 'outlier' | 'viewsPerDay' | 'views' | 'newest';
type Mode = 'channels' | 'category' | 'keyword';

interface TrackedChannel {
  channelId: string; title: string; thumbnail: string; subscriberCount: number; addedAt: string;
}

/**
 * 수집 방식별 쿼터 비용. 검색만 100유닛이고 나머지는 1~2유닛이라
 * 하루에 쓸 수 있는 횟수가 두 자릿수씩 차이 난다 — 화면에서 그 차이가 보여야
 * 사용자가 검색을 남발하지 않는다.
 */
const MODES: Array<[Mode, string, typeof Search, string]> = [
  ['channels', '채널 추적', Radio, '채널당 2유닛 · 제품군 적중률 높음'],
  ['category', '카테고리', Flame, '2유닛 · 유튜브 전체 급상승'],
  ['keyword', '키워드 검색', Search, '키워드당 100유닛 · 아껴 쓰세요'],
];

const SORTS: Array<[Sort, string]> = [
  ['outlier', '구독자 대비'],
  ['viewsPerDay', '일일 조회수'],
  ['views', '총 조회수'],
  ['newest', '최신순'],
];

/** 자주 쓰는 출발점 — 매번 타이핑하지 않게 */
const PRESETS: Array<[string, string[]]> = [
  ['주방·수납', ['주방 수납', '틈새 수납', '주방템']],
  ['생활·청소', ['청소템', '생활꿀템', '살림템']],
  ['가전·IT', ['가성비 가전', '자취 가전', '충전기 추천']],
];

const fmt = (n: number) => (n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString());

export default function ViralPage() {
  const qc = useQueryClient();
  const [keywords, setKeywords] = useState('');
  const [withinDays, setWithinDays] = useState(7);
  const [sort, setSort] = useState<Sort>('outlier');
  const [playing, setPlaying] = useState<string | null>(null);
  const [result, setResult] = useState<DiscoverResult | null>(null);

  const [mode, setMode] = useState<Mode>('channels');
  const [channelInput, setChannelInput] = useState('');

  const board = useQuery({ queryKey: ['viral-board'], queryFn: () => api.get<ViralItem[]>('/viral/board') });
  const channels = useQuery({
    queryKey: ['viral-channels'],
    queryFn: () => api.get<TrackedChannel[]>('/viral/channels'),
  });

  const discover = useMutation({
    mutationFn: (list: string[]) =>
      api.post<DiscoverResult>('/viral/discover', { keywords: list, withinDays, sort }),
    onSuccess: (r) => setResult(r),
  });
  const scanChannels = useMutation({
    mutationFn: () => api.post<DiscoverResult>('/viral/channels/scan', { withinDays, sort }),
    onSuccess: (r) => setResult(r),
  });
  const scanCategory = useMutation({
    mutationFn: () => api.post<DiscoverResult>('/viral/category', { sort }),
    onSuccess: (r) => setResult(r),
  });
  const addChannel = useMutation({
    mutationFn: (input: string) => api.post<TrackedChannel[]>('/viral/channels', { input }),
    onSuccess: () => {
      setChannelInput('');
      void qc.invalidateQueries({ queryKey: ['viral-channels'] });
    },
  });
  const dropChannel = useMutation({
    mutationFn: (id: string) => api.del(`/viral/channels/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['viral-channels'] }),
  });
  const save = useMutation({
    mutationFn: (item: ViralItem) => api.post('/viral/board', item),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['viral-board'] }),
  });
  const unsave = useMutation({
    mutationFn: (videoId: string) => api.del(`/viral/board/${videoId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['viral-board'] }),
  });

  const parsed = keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
  const saved = new Set((board.data ?? []).map((b) => b.video.videoId));
  const shown = result ? [...result.items].sort(bySort(sort)) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <TrendingUp size={19} /> 바이럴 제품
        </h2>
        {result && (
          <span className="text-xs text-slate-500">
            쿼터 {result.quota.used.toLocaleString()} / {result.quota.total.toLocaleString()}
          </span>
        )}
      </div>

      <Card>
        <p className="mb-3 text-sm text-slate-500">
          <span className="font-medium text-slate-700">구독자 수에 비해 조회수가 튄 영상</span>을 찾습니다.
          조회수만 보면 큰 채널이 목록을 덮어써서, 소재가 터진 영상이 묻힙니다.
        </p>

        <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {MODES.map(([k, label, Icon, hint]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              title={hint}
              className={clsx(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5',
                mode === k ? 'bg-white font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <p className="mb-3 text-xs text-slate-400">{MODES.find(([k]) => k === mode)?.[3]}</p>

        {mode === 'channels' && (
          <>
            <div className="mb-2 flex gap-2">
              <Input
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && channelInput.trim()) addChannel.mutate(channelInput); }}
                placeholder="채널 주소 붙여넣기 (예: https://www.youtube.com/@채널핸들)"
              />
              <Button
                variant="secondary"
                className="shrink-0 whitespace-nowrap"
                onClick={() => addChannel.mutate(channelInput)}
                disabled={!channelInput.trim() || addChannel.isPending}
              >
                <Plus size={15} /> 추가
              </Button>
            </div>
            {addChannel.error && <p className="mb-2 text-sm text-red-600">{addChannel.error.message}</p>}
            {(channels.data ?? []).length > 0 ? (
              <ul className="mb-3 flex flex-wrap gap-1.5">
                {channels.data!.map((c) => (
                  <li key={c.channelId} className="flex items-center gap-1.5 rounded-full border border-slate-200 py-1 pl-1 pr-2 text-xs">
                    {c.thumbnail && <img src={c.thumbnail} alt="" className="h-5 w-5 rounded-full" />}
                    <span>{c.title}</span>
                    <span className="text-slate-400">{fmt(c.subscriberCount)}</span>
                    <button className="text-slate-400 hover:text-red-500" onClick={() => dropChannel.mutate(c.channelId)}>
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-xs text-slate-400">
                쇼핑 쇼츠 채널을 등록해두면, 검색 1회(100유닛) 값으로 채널 50개를 훑습니다.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => scanChannels.mutate()} disabled={scanChannels.isPending || !(channels.data ?? []).length}>
                {scanChannels.isPending ? <>훑는 중… <Spinner /></> : <><Radio size={15} /> 최신 영상 훑기</>}
              </Button>
              <DaysSelect value={withinDays} onChange={setWithinDays} />
              <span className="text-xs text-slate-400">
                채널 {(channels.data ?? []).length}개 · 약 {((channels.data ?? []).length * 2 + 2).toLocaleString()}유닛
              </span>
            </div>
            {scanChannels.error && <p className="mt-2 text-sm text-red-600">{scanChannels.error.message}</p>}
          </>
        )}

        {mode === 'category' && (
          <>
            <p className="mb-2 text-xs text-slate-400">
              유튜브 전체 인기 급상승입니다. 카테고리가 제품군이 아니라서(유튜브에는 "주방용품" 같은 분류가 없습니다)
              넓게 훑는 용도로만 쓰세요.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => scanCategory.mutate()} disabled={scanCategory.isPending}>
                {scanCategory.isPending ? <>불러오는 중… <Spinner /></> : <><Flame size={15} /> 급상승 쇼츠 보기</>}
              </Button>
              <span className="text-xs text-slate-400">약 2유닛 · 하루 수천 번 가능</span>
            </div>
            {scanCategory.error && <p className="mt-2 text-sm text-red-600">{scanCategory.error.message}</p>}
          </>
        )}

        {mode === 'keyword' && (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PRESETS.map(([label, list]) => (
                <button
                  key={label}
                  onClick={() => setKeywords(list.join(', '))}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-600"
                >
                  {label}
                </button>
              ))}
            </div>
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="키워드를 쉼표로 구분 (예: 주방 수납, 틈새 수납)"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                onClick={() => discover.mutate(parsed)}
                disabled={!parsed.length || parsed.length > 10 || discover.isPending}
              >
                {discover.isPending ? <>찾는 중… <Spinner /></> : <><Search size={15} /> 발굴하기</>}
              </Button>
              <DaysSelect value={withinDays} onChange={setWithinDays} />
              <span className={clsx('text-xs', parsed.length > 3 ? 'text-amber-600' : 'text-slate-400')}>
                키워드 {parsed.length}개 · 약 {(parsed.length * 100 + 2).toLocaleString()}유닛
                {parsed.length > 10 && ' · 최대 10개'}
              </span>
            </div>
            {discover.error && <p className="mt-2 text-sm text-red-600">{discover.error.message}</p>}
          </>
        )}
      </Card>

      {result && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">{shown.length}편</span>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs">
            {SORTS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={clsx('rounded-md px-2 py-1', sort === k ? 'bg-white font-medium shadow-sm' : 'text-slate-500')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {result && shown.length === 0 && (
        <EmptyState message="조건에 맞는 영상이 없습니다. 기간을 늘리거나 키워드를 바꿔보세요." />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((it) => (
          <VideoCard
            key={it.video.videoId}
            item={it}
            playing={playing === it.video.videoId}
            onPlay={() => setPlaying(playing === it.video.videoId ? null : it.video.videoId)}
            saved={saved.has(it.video.videoId)}
            onSave={() => save.mutate(it)}
            onUnsave={() => unsave.mutate(it.video.videoId)}
          />
        ))}
      </div>

      {(board.data ?? []).length > 0 && (
        <>
          <h3 className="pt-2 text-sm font-semibold text-slate-700">보관함 ({board.data!.length})</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {board.data!.map((it) => (
              <VideoCard
                key={it.video.videoId}
                item={it}
                playing={playing === it.video.videoId}
                onPlay={() => setPlaying(playing === it.video.videoId ? null : it.video.videoId)}
                saved
                onSave={() => {}}
                onUnsave={() => unsave.mutate(it.video.videoId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DaysSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      <option value={3}>최근 3일</option>
      <option value={7}>최근 7일</option>
      <option value={14}>최근 14일</option>
      <option value={30}>최근 30일</option>
    </select>
  );
}

function bySort(sort: Sort) {
  return (a: ViralItem, b: ViralItem) => {
    if (sort === 'viewsPerDay') return b.viewsPerDay - a.viewsPerDay;
    if (sort === 'views') return b.video.viewCount - a.video.viewCount;
    if (sort === 'newest') return b.video.publishedAt.localeCompare(a.video.publishedAt);
    return b.outlierRatio - a.outlierRatio;
  };
}

function VideoCard({
  item, playing, onPlay, saved, onSave, onUnsave,
}: {
  item: ViralItem; playing: boolean; onPlay: () => void;
  saved: boolean; onSave: () => void; onUnsave: () => void;
}) {
  const v = item.video;
  // 배수가 클수록 "채널 힘이 아니라 소재가 터졌다"는 뜻 — 색으로 바로 보이게
  const hot = item.outlierRatio >= 10;

  return (
    <Card className="p-0">
      <div className="relative aspect-video w-full overflow-hidden rounded-t-xl bg-black">
        {playing ? (
          <iframe
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${v.videoId}?autoplay=1`}
            title={v.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button onClick={onPlay} className="group h-full w-full">
            <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-black/60 p-3 text-white group-hover:bg-black/80">
                <Play size={20} fill="currentColor" />
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="space-y-1.5 p-3">
        <div className="flex items-center gap-1.5">
          <Badge color={hot ? 'red' : 'slate'}>구독자 대비 {item.outlierRatio.toLocaleString()}배</Badge>
          <span className="text-xs text-slate-500">
            조회 {fmt(v.viewCount)} · {item.ageDays < 1 ? '오늘' : `${Math.round(item.ageDays)}일 전`}
          </span>
        </div>
        <p className="line-clamp-2 text-sm font-medium" title={v.title}>{v.title}</p>
        <p className="truncate text-xs text-slate-500">
          {v.channelTitle} · 구독자 {fmt(item.subscriberCount)}
        </p>
        {item.keywords.length > 0 && (
          <p className="truncate text-xs text-slate-400">{item.keywords.join(' · ')}</p>
        )}
        <div className="flex items-center gap-1 pt-1">
          {saved ? (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onUnsave}>
              <BookmarkX size={13} /> 보관 해제
            </Button>
          ) : (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onSave}>
              <Bookmark size={13} /> 보관
            </Button>
          )}
          <a
            href={v.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-brand-600"
          >
            <ExternalLink size={13} /> 유튜브
          </a>
        </div>
      </div>
    </Card>
  );
}
