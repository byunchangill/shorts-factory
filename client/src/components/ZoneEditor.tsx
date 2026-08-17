import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui';

export interface ZoneDraft {
  id: string;
  kind: 'subtitle' | 'logo' | 'emoji';
  x: number; y: number; w: number; h: number;
  t0?: number; t1?: number;
  method: 'crop' | 'delogo' | 'boxblur' | 'inpaint';
}

const KIND_LABEL = { subtitle: '자막', logo: '워터마크', emoji: '이모지' } as const;
/**
 * 블러에 「비권장」을 붙여 둔다. 회색 판때기는 지운 것이 아니라 **가린 것**이라
 * 검열 자국처럼 보이고, 완성본 검수에서 그 이유로 반려된 적이 있다.
 * 지우는 순서는 크롭 → 보간 → 인페인팅이고, 블러는 그 셋이 다 안 될 때의 마지막 수단이다.
 */
const METHOD_LABEL = {
  crop: '크롭(가장자리)', delogo: '보간 제거', inpaint: 'AI 인페인팅', boxblur: '블러(비권장)',
} as const;
const METHOD_COLOR = {
  crop: 'border-amber-400 bg-amber-400/20',
  delogo: 'border-blue-400 bg-blue-400/20',
  boxblur: 'border-violet-400 bg-violet-400/20',
  inpaint: 'border-green-400 bg-green-400/20',
} as const;

/**
 * 프레임 이미지 위에 드래그로 제거 영역(존)을 그리는 편집기.
 * 표시 좌표 → 원본 픽셀 좌표 변환은 naturalWidth/clientWidth 비율로 처리.
 */
export function ZoneEditor({
  frameUrl,
  frameTime,
  frameTimes,
  duration,
  videoWidth,
  videoHeight,
  zones,
  onChange,
  onDetect,
  detecting,
}: {
  frameUrl: string;
  /** 지금 보고 있는 프레임의 시각(초) — 구간 지정의 기준점 */
  frameTime: number;
  /** 뽑아둔 프레임들의 시각(초, 오름차순) — 구간은 이 중에서 고른다 */
  frameTimes: number[];
  /** 클립 전체 길이(초) */
  duration: number;
  videoWidth: number;
  videoHeight: number;
  zones: ZoneDraft[];
  onChange: (zones: ZoneDraft[]) => void;
  /** 존이 나타나는 구간을 영상에서 직접 찾아준다 (없으면 버튼을 감춘다) */
  onDetect?: (zone: ZoneDraft) => Promise<void>;
  /** 지금 자동 찾기 중인 존 id */
  detecting?: string | null;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  /**
   * 화면에 그려진 이미지의 실제 너비(px). 존 좌표(원본 픽셀)를 화면 좌표로 바꾸는 기준이다.
   *
   * ref에서 매번 읽으면 안 된다 — 첫 렌더에는 ref가 비어 있고 이미지도 아직 안 실려서
   * 비율이 1로 잡히고, 저장된 존이 원본 픽셀 크기 그대로 이미지 밖까지 그려진다.
   * 그 뒤 리렌더가 있어야 제자리를 찾으므로, 화면에 들어오자마자 본 사람에게는
   * "지정한 적 없는 영역이 잡혀 있는" 것처럼 보인다 (실제 신고된 증상).
   * 그래서 로드·리사이즈 시점에 재서 상태로 들고 있는다.
   */
  const [imgW, setImgW] = useState(0);
  const measure = () => setImgW(imgRef.current?.clientWidth ?? 0);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // 클립·프레임을 바꾸면 이미지가 새로 실린다 — 그때 다시 잰다
  useEffect(() => { measure(); }, [frameUrl]);

  const scale = () => (imgW > 0 ? videoWidth / imgW : 1);

  const toLocal = (e: React.MouseEvent) => {
    const rect = imgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!imgRef.current) return;
    const { x, y } = toLocal(e);
    setDrag({ x0: x, y0: y, x1: x, y1: y });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const { x, y } = toLocal(e);
    setDrag({ ...drag, x1: x, y1: y });
  };
  const onMouseUp = () => {
    if (!drag) return;
    const s = scale();
    const x = Math.min(drag.x0, drag.x1) * s;
    const y = Math.min(drag.y0, drag.y1) * s;
    const w = Math.abs(drag.x1 - drag.x0) * s;
    const h = Math.abs(drag.y1 - drag.y0) * s;
    setDrag(null);
    if (w < 8 || h < 8) return; // 클릭 무시
    const id = `z${Date.now().toString(36)}`;
    onChange([
      ...zones,
      {
        id,
        kind: 'subtitle',
        x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
        method: 'delogo',
      },
    ]);
    setSelected(id);
  };

  const inv = 1 / scale();

  return (
    <div className="space-y-3">
      <div
        className="relative inline-block cursor-crosshair select-none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => setDrag(null)}
      >
        <img
          ref={imgRef}
          src={frameUrl}
          alt="frame"
          className="max-h-[420px] rounded-lg"
          draggable={false}
          onLoad={measure}
        />
        {/* 크기를 재기 전에는 그리지 않는다 — 엉뚱한 자리에 한 번 번쩍이는 것을 막는다 */}
        {imgW > 0 && zones.map((z) => (
          <div
            key={z.id}
            onClick={(e) => { e.stopPropagation(); setSelected(z.id); }}
            className={clsx(
              'absolute border-2',
              METHOD_COLOR[z.method],
              selected === z.id && 'ring-2 ring-white',
            )}
            style={{ left: z.x * inv, top: z.y * inv, width: z.w * inv, height: z.h * inv }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-black/70 px-1 text-[10px] text-white">
              {KIND_LABEL[z.kind]} · {METHOD_LABEL[z.method]}
            </span>
          </div>
        ))}
        {drag && (
          <div
            className="absolute border-2 border-dashed border-white bg-white/20"
            style={{
              left: Math.min(drag.x0, drag.x1),
              top: Math.min(drag.y0, drag.y1),
              width: Math.abs(drag.x1 - drag.x0),
              height: Math.abs(drag.y1 - drag.y0),
            }}
          />
        )}
      </div>
      <p className="text-xs text-slate-500">
        원본 해상도 {videoWidth}×{videoHeight} · 드래그로 제거할 영역을 지정하세요
      </p>

      {zones.length > 0 && (
        <ul className="space-y-1.5">
          {zones.map((z) => (
            <li
              key={z.id}
              className={clsx(
                'flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm',
                selected === z.id ? 'border-brand-400 bg-brand-50' : 'border-slate-200',
              )}
              onClick={() => setSelected(z.id)}
            >
              <select
                className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                value={z.kind}
                onChange={(e) =>
                  onChange(zones.map((x) => (x.id === z.id ? { ...x, kind: e.target.value as ZoneDraft['kind'] } : x)))
                }
              >
                {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select
                className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                value={z.method}
                onChange={(e) =>
                  onChange(zones.map((x) => (x.id === z.id ? { ...x, method: e.target.value as ZoneDraft['method'] } : x)))
                }
              >
                {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span className="text-xs text-slate-500">
                ({z.x}, {z.y}) {z.w}×{z.h}
              </span>
              {z.method === 'boxblur' && (
                <span className="text-xs text-amber-600">가린 자국이 남습니다</span>
              )}
              <TimeRange
                zone={z}
                frameTime={frameTime}
                frameTimes={frameTimes}
                duration={duration}
                onChange={(patch) =>
                  onChange(zones.map((x) => (x.id === z.id ? { ...x, ...patch } : x)))
                }
              />
              <span className="ml-auto" />
              {onDetect && z.method !== 'crop' && (
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  title="이 영역에 글자가 있는 프레임을 찾아 구간을 채웁니다. 글자처럼 획이 빽빽한 곳을 찾는 방식이라, 물건이 많은 화면을 글자로 볼 수도 있습니다 — 결과는 눈으로 확인하세요"
                  disabled={!!detecting}
                  onClick={(e) => { e.stopPropagation(); void onDetect(z); }}
                >
                  <Wand2 size={13} /> {detecting === z.id ? '찾는 중…' : '구간 자동 찾기'}
                </Button>
              )}
              <Button
                variant="ghost"
                className="px-1.5 py-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(zones.filter((x) => x.id !== z.id));
                }}
              >
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 존을 클립 전체에 걸지, 어느 프레임 구간에만 걸지 정한다.
 *
 * 자막·워터마크가 영상 내내 떠 있는 경우는 드물어서, 전체에 걸면 멀쩡한 화면까지 뭉갠다.
 * 구간은 **뽑아둔 프레임 중에서 고른다** — 초를 손으로 입력하게 하면 사용자가
 * 이미 눈으로 보고 있는 프레임과 숫자를 머릿속에서 맞춰야 한다.
 *
 * 끝 프레임은 "그 프레임까지 포함"으로 해석해 다음 프레임 직전까지를 구간으로 잡는다.
 * 9.0초 프레임을 끝으로 골랐는데 t1=9.0으로 자르면 그 프레임이 통째로 빠진다.
 *
 * 크롭은 화면 크기를 바꾸는 방식이라 시간대별로 다르게 적용할 수 없다 — 전체 고정이다.
 */
function TimeRange({
  zone,
  frameTime,
  frameTimes,
  duration,
  onChange,
}: {
  zone: ZoneDraft;
  frameTime: number;
  frameTimes: number[];
  duration: number;
  onChange: (patch: Partial<ZoneDraft>) => void;
}) {
  const limited = zone.t0 !== undefined && zone.t1 !== undefined;
  const times = frameTimes.length ? frameTimes : [0];

  /** 프레임 간격 — 마지막 프레임의 끝을 잡을 때 쓴다 */
  const step = times.length > 1 ? times[1] - times[0] : 1;
  /** 끝 프레임 시각 → 구간 끝(초). 그 프레임이 통째로 들어가게 다음 프레임 직전까지 */
  const endOf = (t: number) => Math.min(duration, Math.round((t + step) * 10) / 10);
  /** 구간 끝(초) → 지금 선택된 끝 프레임 */
  const endFrame = (t1: number) => {
    const inRange = times.filter((t) => t < t1);
    return inRange.length ? inRange[inRange.length - 1] : times[0];
  };
  /** 시작(초) → 가장 가까운 프레임 (예전에 초로 저장된 값도 자연스럽게 맞춰진다) */
  const startFrame = (t0: number) =>
    times.reduce((best, t) => (Math.abs(t - t0) < Math.abs(best - t0) ? t : best), times[0]);

  if (zone.method === 'crop') {
    return <span className="text-xs text-slate-500">전체 구간 (크롭은 구간 지정 불가)</span>;
  }

  const frameSelect = (value: number, onPick: (t: number) => void, label: string) => (
    <select
      aria-label={label}
      className="rounded border border-slate-300 px-1.5 py-1 text-xs"
      value={value}
      onChange={(e) => onPick(Number(e.target.value))}
    >
      {times.map((t) => <option key={t} value={t}>{t.toFixed(1)}초</option>)}
    </select>
  );

  return (
    <span className="flex flex-wrap items-center gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
      <select
        className="rounded border border-slate-300 px-1.5 py-1 text-xs"
        value={limited ? 'range' : 'all'}
        onChange={(e) =>
          onChange(e.target.value === 'all'
            ? { t0: undefined, t1: undefined }
            // 지금 보고 있는 프레임부터 끝까지 — 자막을 발견한 지점이 곧 시작이다
            : { t0: startFrame(frameTime), t1: endOf(times[times.length - 1]) })
        }
      >
        <option value="all">전체 구간</option>
        <option value="range">프레임 구간</option>
      </select>
      {limited && (
        <>
          {frameSelect(startFrame(zone.t0!), (t) => onChange({ t0: t, t1: Math.max(zone.t1!, endOf(t)) }), '시작 프레임')}
          <span className="text-slate-500">~</span>
          {frameSelect(endFrame(zone.t1!), (t) => onChange({ t1: endOf(t) }), '끝 프레임')}
          <span className="text-slate-500">프레임</span>
          <button
            className="rounded border border-slate-300 px-1.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
            title="지금 보고 있는 프레임을 끝으로 잡습니다"
            onClick={() => onChange({ t1: endOf(startFrame(frameTime)) })}
          >
            여기까지
          </button>
        </>
      )}
    </span>
  );
}
