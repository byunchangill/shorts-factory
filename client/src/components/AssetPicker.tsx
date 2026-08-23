import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Images, Play, Pause, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { ASSET_KINDS, ASSET_KIND_LABELS, type AssetKind } from '@shared/constants';
import type { Asset } from '@shared/types';
import { Badge, Input, Modal, Button } from '@/components/ui';

/**
 * 이 편에 쓸 편집 재료 고르기.
 *
 * 고른 것은 **캡컷 재료 묶음**의 `04_짤방/`·`05_효과음/`으로 들어간다.
 * 웹 자동 조립에는 안 들어간다 — 짤방을 어느 자리에 몇 초 얹을지는 사람이 정하는 일이고,
 * 그걸 자동으로 꽂으면 대본과 무관한 그림이 튀어나온다.
 */
export function AssetPicker({
  jobId,
  picked,
  onChange,
}: {
  jobId: string;
  picked: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<Asset[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void api.get<{ items: Asset[] }>('/assets').then((r) => setAll(r.items)).catch(() => setAll([]));
  }, [open]);

  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const chosen = useMemo(() => all.filter((a) => pickedSet.has(a.id)), [all, pickedSet]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((a) => {
      if (kind !== 'all' && a.kind !== kind) return false;
      if (!needle) return true;
      return [a.title, ...a.tags].join(' ').toLowerCase().includes(needle);
    });
  }, [all, q, kind]);

  async function toggle(asset: Asset) {
    const next = pickedSet.has(asset.id)
      ? picked.filter((id) => id !== asset.id)
      : [...picked, asset.id];
    setSaving(true);
    try {
      await api.put(`/jobs/${jobId}/assets`, { assets: next });
      onChange(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">이 편에 담은 짤방·효과음</p>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Images size={15} /> 자료실에서 고르기
        </Button>
      </div>
      {picked.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          아직 없습니다. 담아두면 캡컷 재료 묶음에 <code>04_짤방</code>·<code>05_효과음</code> 폴더로 같이 들어갑니다.
        </p>
      ) : (
        <p className="mt-1 text-xs text-slate-500">
          {picked.length}개 담김 — 캡컷 묶음에 같이 들어갑니다
          {chosen.length > 0 && chosen.length < picked.length
            && ' (자료실에서 지워진 것은 묶을 때 빠집니다)'}
        </p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="편집 재료 고르기">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
              {(['all', ...ASSET_KINDS] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={clsx(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    kind === k ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
                  )}
                >
                  {k === 'all' ? '전체' : ASSET_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <div className="relative min-w-[180px] flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder="제목·태그 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          {all.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              자료실이 비어 있습니다.{' '}
              <Link to="/assets" className="font-medium text-brand-700 underline">
                편집 재료
              </Link>{' '}
              화면에서 올리거나 공용 자료를 받아오세요.
            </p>
          ) : (
            <div className="grid max-h-[50vh] grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 overflow-y-auto">
              {shown.map((a) => (
                <PickCard
                  key={a.id}
                  asset={a}
                  picked={pickedSet.has(a.id)}
                  disabled={saving}
                  onToggle={() => void toggle(a)}
                />
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function PickCard({
  asset, picked, disabled, onToggle,
}: {
  asset: Asset;
  picked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={clsx(
        'rounded-lg border p-1.5 transition-colors',
        picked ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex h-20 w-full items-center justify-center overflow-hidden rounded bg-slate-100"
        aria-pressed={picked}
        aria-label={`${asset.title} ${picked ? '빼기' : '담기'}`}
      >
        {asset.kind === 'meme' ? (
          /\.(mp4|webm)$/i.test(asset.file)
            ? <video src={asset.url} muted className="h-full w-full object-contain" />
            : <img src={asset.url} alt="" loading="lazy" className="h-full w-full object-contain" />
        ) : (
          <SfxDot url={asset.url} />
        )}
      </button>
      <p className="mt-1 truncate text-xs text-slate-700" title={asset.title}>{asset.title}</p>
      <div className="mt-0.5 flex items-center gap-1">
        {picked && <Badge color="brand">담김</Badge>}
        {asset.origin === 'shared' && !picked && <Badge color="slate">공용</Badge>}
      </div>
    </div>
  );
}

/** 고르기 창의 효과음 미리듣기 — 카드를 누르면 담기고, 이 버튼만 소리를 낸다 */
function SfxDot({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <>
      <audio ref={ref} src={url} preload="none" onEnded={() => setPlaying(false)} />
      <span
        role="button"
        tabIndex={0}
        aria-label={playing ? '멈추기' : '들어보기'}
        onClick={(e) => {
          e.stopPropagation();
          const el = ref.current;
          if (!el) return;
          if (playing) { el.pause(); setPlaying(false); return; }
          for (const other of document.querySelectorAll('audio')) if (other !== el) other.pause();
          el.currentTime = 0;
          void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-brand-700 shadow-sm"
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </span>
    </>
  );
}
