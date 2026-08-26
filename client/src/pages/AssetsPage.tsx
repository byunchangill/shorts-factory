import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  Upload, RefreshCw, Trash2, Undo2, Search, Play, Pause, FileText, TriangleAlert,
} from 'lucide-react';
import { api } from '@/api/client';
import {
  ASSET_KINDS, ASSET_KIND_LABELS, ASSET_EXTS, type AssetKind,
} from '@shared/constants';
import type { Asset } from '@shared/types';
import {
  classifySource, sourceVerdictMessage, assetPolicyProblems, defaultLicense, sourceLabel,
  SELF_MADE,
} from '@shared/assetPolicy';
import {
  Badge, Button, Card, EmptyState, IconButton, Input, Modal, PageHeader, Spinner, ConfirmDialog,
} from '@/components/ui';

interface SyncStatus {
  configured: boolean;
  repoUrl: string;
  hasToken: boolean;
  cloned: boolean;
  syncedAt?: string;
}

/**
 * 편집 재료 자료실 — 짤방·효과음.
 *
 * 두 겹이라는 것을 화면이 숨기지 않는다. 「공용」 배지가 붙은 것은 모든 PC에 있는
 * 자료이고 지우면 **이 PC에서만 숨겨진다** — 그 차이를 안 보여주면 "지웠는데 왜
 * 친구 화면엔 그대로냐"를 아무도 못 짚는다.
 */
export default function AssetsPage() {
  const [items, setItems] = useState<Asset[]>([]);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<Asset | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      if (kind !== 'all') params.set('kind', kind);
      if (q.trim()) params.set('q', q.trim());
      if (showHidden) params.set('includeHidden', '1');
      const r = await api.get<{ items: Asset[]; sync: SyncStatus }>(`/assets?${params}`);
      setItems(r.items);
      setSync(r.sync);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, q, showHidden]);

  // 검색어는 타이핑마다 부르지 않는다 — 목록이 파일시스템 훑기라 매 글자에 돌 이유가 없다
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function doSync() {
    setBusy('sync');
    setError('');
    try {
      const r = await api.post<{ how: string; items: Asset[]; status: SyncStatus }>('/assets-sync');
      setItems(r.items);
      setSync(r.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function doRemove(asset: Asset) {
    setBusy(asset.id);
    try {
      await api.del(`/assets/${encodeURIComponent(asset.id)}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
      setConfirmTarget(null);
    }
  }

  async function doUnhide(asset: Asset) {
    setBusy(asset.id);
    try {
      await api.post(`/assets/${encodeURIComponent(asset.id)}/unhide`);
      await load();
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="편집 재료"
        eyebrow="짤방 · 효과음"
        actions={
          <>
            <UploadButton onDone={load} onError={setError} />
            <Button variant="secondary" onClick={doSync} disabled={busy === 'sync'}>
              <RefreshCw size={15} className={clsx(busy === 'sync' && 'animate-spin')} />
              공용 자료 받기
            </Button>
          </>
        }
      />

      <SyncBar sync={sync} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

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
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="제목·태그·파일명 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          숨긴 것도 보기
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState
          message={
            sync?.configured
              ? '아직 자료가 없습니다. 「공용 자료 받기」로 저장소에서 받아오거나, 직접 올려주세요.'
              : '아직 자료가 없습니다. 파일을 올리면 이 PC의 자료실에 쌓입니다. '
                + '여러 PC가 같이 쓰려면 설정에서 공용 자료 저장소 주소를 넣어주세요.'
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {items.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              busy={busy === a.id}
              hidden={a.hidden}
              onRemove={() => setConfirmTarget(a)}
              onUnhide={() => doUnhide(a)}
              onChanged={load}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={confirmTarget ? `${confirmTarget.title} 지우기` : ''}
        description={
          confirmTarget?.origin === 'shared'
            ? '공용 자료라 파일은 지우지 않고 이 PC에서만 숨깁니다. '
              + '「숨긴 것도 보기」에서 되돌릴 수 있습니다.'
            : '이 PC의 자료입니다. 휴지통(workspace/.trash/assets)으로 옮깁니다.'
        }
        confirmLabel="지우기"
        pending={Boolean(confirmTarget) && busy === confirmTarget?.id}
        onConfirm={() => { if (confirmTarget) void doRemove(confirmTarget); }}
        onClose={() => setConfirmTarget(null)}
      />
    </div>
  );
}

function SyncBar({ sync }: { sync: SyncStatus | null }) {
  if (!sync) return null;
  if (!sync.configured) {
    return (
      <Card className="border-amber-200 bg-amber-50/60">
        <p className="text-sm text-slate-700">
          공용 자료 저장소가 설정되지 않았습니다. 지금은 <strong>이 PC의 자료만</strong> 보입니다.
          여러 PC가 같은 짤방·효과음을 쓰려면 설정에서 저장소 주소를 넣으세요.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
        <span className="font-medium text-slate-800">공용 자료 저장소</span>
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{sync.repoUrl}</code>
        {sync.hasToken && <Badge color="slate">토큰 등록됨</Badge>}
        {sync.cloned
          ? <span>마지막 받기 {sync.syncedAt ? new Date(sync.syncedAt).toLocaleString('ko-KR') : '기록 없음'}</span>
          : <Badge color="amber">아직 안 받음</Badge>}
      </div>
    </Card>
  );
}

// ── 출처 기록 ─────────────────────────────────────────────────────

/** 화면이 다루는 출처 입력값. `hasFace`는 **셋째 상태(미표시)가 있어야 한다** */
interface SourceDraft {
  sourceUrl: string;
  license: string;
  downloadedAt: string;
  hasFace: 'yes' | 'no' | '';
  transformNote: string;
}

const EMPTY_DRAFT: SourceDraft = {
  sourceUrl: '', license: '', downloadedAt: '', hasFace: '', transformNote: '',
};

function draftOf(a: Asset): SourceDraft {
  return {
    sourceUrl: a.sourceUrl ?? '',
    license: a.license ?? '',
    downloadedAt: (a.downloadedAt ?? '').slice(0, 10),
    hasFace: a.hasFace === undefined ? '' : (a.hasFace ? 'yes' : 'no'),
    transformNote: a.transformNote ?? '',
  };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/**
 * 출처 URL 판정을 타이핑하는 동안 보여준다.
 *
 * 서버가 어차피 막지만, 다 올린 뒤에 400을 보는 것과 적는 동안 아는 것은 다르다.
 * 판정은 `shared/assetPolicy.ts`에서 온다 — 화면이 목록을 따로 들고 있지 않는다.
 */
function SourceVerdictLine({ url }: { url: string }) {
  if (!url.trim()) {
    return (
      <span className="block text-xs text-slate-500">
        받아온 페이지 주소를 그대로 붙여넣으세요. 직접 만든 것이면 「{SELF_MADE}」이라고 적습니다.
      </span>
    );
  }
  const v = classifySource(url);
  // 사유 문구는 서버 400과 **같은 함수**에서 온다 — 화면에 따로 적으면 곧바로 어긋난다
  const why = sourceVerdictMessage(v);
  if (why) {
    // 빨강·노랑은 상태 전용이다: 못 쓰는 출처(오류) / 라이선스를 더 적어야 하는 출처(주의)
    const blocking = v.kind === 'blocked' || v.kind === 'invalid';
    return (
      <span className={clsx('block text-xs', blocking ? 'text-red-700' : 'text-amber-700')}>
        {why}
      </span>
    );
  }
  return (
    <span className="block text-xs text-slate-500">
      {sourceLabel(url)} · 라이선스 {defaultLicense(url)}
    </span>
  );
}

/** 올리기·고치기가 같이 쓰는 출처 입력 묶음 */
function SourceFields({
  value, onChange,
}: {
  value: SourceDraft;
  onChange: (next: SourceDraft) => void;
}) {
  const set = (patch: Partial<SourceDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <Field label="출처 URL (필수)">
        <Input
          value={value.sourceUrl}
          placeholder="https://pixabay.com/..."
          onChange={(e) => set({ sourceUrl: e.target.value })}
        />
        <SourceVerdictLine url={value.sourceUrl} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="라이선스" hint="비우면 사이트 기본값이 들어갑니다">
          <Input
            value={value.license}
            placeholder={defaultLicense(value.sourceUrl) || '예: CC0'}
            onChange={(e) => set({ license: e.target.value })}
          />
        </Field>
        <Field label="받은 날짜" hint="비우면 오늘">
          <Input
            type="date"
            value={value.downloadedAt}
            onChange={(e) => set({ downloadedAt: e.target.value })}
          />
        </Field>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-slate-700">식별 가능한 인물</legend>
        <div className="flex gap-3">
          {([['no', '인물 없음'], ['yes', '인물 있음']] as const).map(([v, label]) => (
            <label key={v} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="radio"
                name="hasFace"
                checked={value.hasFace === v}
                onChange={() => set({ hasFace: v })}
                className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              {label}
            </label>
          ))}
        </div>
        <span className="block text-xs text-slate-500">
          직접 보고 고릅니다 — 앱이 얼굴을 찾아주지 않습니다. 고르지 않으면 제품정보리뷰 조립에서 막힙니다.
        </span>
      </fieldset>

      <Field
        label="메모"
        hint="검색 정렬·상위 제외처럼 앱이 확인할 수 없는 것은 여기 적습니다 (대장에 「사람이 적은 메모」로 나갑니다)"
      >
        <Input
          value={value.transformNote}
          placeholder="예: 최신순 정렬 · 인기 상위 20개 제외"
          onChange={(e) => set({ transformNote: e.target.value })}
        />
      </Field>
    </div>
  );
}

/**
 * 자료 올리기 — 🔴 **출처 URL 없이는 못 올린다** (서버도 400으로 막는다).
 *
 * 파일 고르기부터 시키고 출처를 나중에 묻지 않는다. 나중에 채우게 두면 안 채우고,
 * 출처가 없으면 화이트리스트가 아무것도 못 거른다.
 */
function UploadButton({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AssetKind>('meme');
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const verdict = classifySource(draft.sourceUrl);
  const ready = files.length > 0
    && draft.hasFace !== ''
    && (verdict.kind === 'allowed' || verdict.kind === 'self' || verdict.kind === 'unknown');

  function close() {
    setOpen(false);
    setFiles([]);
    setDraft(EMPTY_DRAFT);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function send() {
    if (!ready) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      fd.append('sourceUrl', draft.sourceUrl.trim());
      if (draft.license.trim()) fd.append('license', draft.license.trim());
      if (draft.downloadedAt) fd.append('downloadedAt', new Date(draft.downloadedAt).toISOString());
      fd.append('hasFace', draft.hasFace === 'yes' ? 'true' : 'false');
      if (draft.transformNote.trim()) fd.append('note', draft.transformNote.trim());
      // kind는 쿼리로 보낸다 — multipart 본문 필드는 파일보다 늦게 도착할 수 있다
      await api.upload(`/assets?kind=${kind}`, fd);
      close();
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload size={15} />
        올리기
      </Button>

      <Modal open={open} onClose={close} title="자료 올리기">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="종류">
              <select
                value={kind}
                onChange={(e) => { setKind(e.target.value as AssetKind); setFiles([]); }}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700"
              >
                {ASSET_KINDS.map((k) => (
                  <option key={k} value={k}>{ASSET_KIND_LABELS[k]}</option>
                ))}
              </select>
            </Field>
            <Field label="파일" hint={ASSET_EXTS[kind].join(' ')}>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ASSET_EXTS[kind].join(',')}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                className="w-full text-sm text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-sm file:text-slate-700"
              />
            </Field>
          </div>

          <p className="text-xs text-slate-500">
            한 번에 올리는 파일은 <strong>같은 출처</strong>로 기록됩니다. 출처가 다르면 나눠서 올리세요.
          </p>

          <SourceFields value={draft} onChange={setDraft} />

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={close}>취소</Button>
            <Button onClick={() => void send()} disabled={!ready || busy}>
              {busy ? '올리는 중' : (files.length ? `${files.length}개 올리기` : '올리기')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function AssetCard({
  asset, busy, hidden, onRemove, onUnhide, onChanged,
}: {
  asset: Asset;
  busy: boolean;
  hidden: boolean;
  onRemove: () => void;
  onUnhide: () => void;
  onChanged: () => void;
}) {
  const [tags, setTags] = useState(asset.tags.join(', '));
  const [editing, setEditing] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>(() => draftOf(asset));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const problems = assetPolicyProblems(asset);

  /*
    서버도 출처를 판정한다(블랙리스트·주소 형태) — 400이 오면 창을 닫지 않고 그 자리에
    사유를 띄운다. 조용히 닫히면 「저장했는데 안 바뀐다」가 된다.
  */
  async function saveSource() {
    setSaving(true);
    setSaveError('');
    try {
      await api.patch(`/assets/${encodeURIComponent(asset.id)}`, {
        sourceUrl: draft.sourceUrl.trim(),
        license: draft.license.trim(),
        downloadedAt: draft.downloadedAt ? new Date(draft.downloadedAt).toISOString() : '',
        ...(draft.hasFace === '' ? {} : { hasFace: draft.hasFace === 'yes' }),
        transformNote: draft.transformNote.trim(),
      });
      setSourceOpen(false);
      onChanged();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveTags() {
    setEditing(false);
    const next = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (next.join(',') === asset.tags.join(',')) return;
    await api.patch(`/assets/${encodeURIComponent(asset.id)}`, { tags: next });
    onChanged();
  }

  return (
    <Card className={clsx('flex flex-col gap-2 p-2.5', busy && 'opacity-50')}>
      <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
        {asset.kind === 'meme'
          ? <MemePreview asset={asset} />
          : <SfxPreview asset={asset} />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-800" title={asset.title}>
          {asset.title}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <Badge color={asset.origin === 'shared' ? 'brand' : 'slate'}>
            {asset.origin === 'shared' ? '공용' : '이 PC'}
          </Badge>
          <span className="text-[11px] text-slate-400">
            {(asset.bytes / 1024).toFixed(0)}KB
          </span>
        </div>
      </div>
      {editing ? (
        <Input
          autoFocus
          value={tags}
          placeholder="태그를 쉼표로"
          onChange={(e) => setTags(e.target.value)}
          onBlur={saveTags}
          onKeyDown={(e) => { if (e.key === 'Enter') void saveTags(); }}
          className="text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-h-[26px] rounded-md px-1 py-0.5 text-left text-xs text-slate-500 hover:bg-slate-100"
        >
          {asset.tags.length ? asset.tags.join(' · ') : '태그 추가'}
        </button>
      )}
      {/*
        출처 상태를 카드마다 보여준다. 조립에서 막히고 나서야 아는 것과, 자료실에서
        미리 보이는 것은 다르다 — 막는 자리는 조립이지만 고치는 자리는 여기다.
      */}
      <button
        type="button"
        onClick={() => { setDraft(draftOf(asset)); setSaveError(''); setSourceOpen(true); }}
        className={clsx(
          'flex items-center gap-1 rounded-md px-1 py-0.5 text-left text-xs hover:bg-slate-100',
          problems.length ? 'text-amber-700' : 'text-slate-500',
        )}
      >
        {problems.length
          ? <><TriangleAlert size={12} /> 출처 확인 필요</>
          : <><FileText size={12} /> {sourceLabel(asset.sourceUrl)}</>}
      </button>

      <div className="flex justify-end gap-0.5">
        {hidden && (
          <IconButton label="다시 보이기" onClick={onUnhide}><Undo2 size={15} /></IconButton>
        )}
        <IconButton label="지우기" tone="danger" onClick={onRemove}><Trash2 size={15} /></IconButton>
      </div>

      <Modal open={sourceOpen} onClose={() => setSourceOpen(false)} title={`${asset.title} 출처`}>
        <div className="space-y-4">
          {problems.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {problems.map((p) => <li key={p}>· {p}</li>)}
            </ul>
          )}
          <SourceFields value={draft} onChange={setDraft} />
          {saveError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {saveError}
            </p>
          )}
          {asset.origin === 'shared' && (
            <p className="text-xs text-slate-500">
              공용 자료입니다 — 여기서 고친 값은 <strong>이 PC에만</strong> 남습니다
              (공용 목록은 관리자가 저장소에서 고칩니다).
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSourceOpen(false)}>닫기</Button>
            <Button onClick={() => void saveSource()} disabled={saving}>
              {saving ? '저장 중' : '저장'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function MemePreview({ asset }: { asset: Asset }) {
  const isVideo = /\.(mp4|webm)$/i.test(asset.file);
  if (isVideo) {
    return <video src={asset.url} muted loop className="h-full w-full object-contain" />;
  }
  return (
    <img
      src={asset.url}
      alt={asset.title}
      loading="lazy"
      className="h-full w-full object-contain"
    />
  );
}

/**
 * 효과음 미리듣기.
 *
 * `<audio controls>`를 카드마다 놓으면 브라우저 기본 UI가 화면을 뒤덮는다.
 * 재생 버튼 하나만 두고 소리는 한 번에 하나만 나게 한다 — 여러 개가 겹쳐 나면
 * 무엇을 듣고 있는지 알 수 없다.
 */
function SfxPreview({ asset }: { asset: Asset }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = () => setPlaying(false);
    el.addEventListener('ended', stop);
    el.addEventListener('pause', stop);
    return () => {
      el.removeEventListener('ended', stop);
      el.removeEventListener('pause', stop);
    };
  }, []);

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    for (const other of document.querySelectorAll('audio')) {
      if (other !== el) other.pause();
    }
    el.currentTime = 0;
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  return (
    <>
      <audio ref={ref} src={asset.url} preload="none" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? '멈추기' : '들어보기'}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-700 shadow-sm transition-colors hover:bg-brand-50"
      >
        {playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
      </button>
    </>
  );
}
