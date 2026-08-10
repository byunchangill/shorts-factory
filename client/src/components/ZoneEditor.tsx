import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';

export interface ZoneDraft {
  id: string;
  kind: 'subtitle' | 'logo' | 'emoji';
  x: number; y: number; w: number; h: number;
  t0?: number; t1?: number;
  method: 'crop' | 'delogo' | 'boxblur' | 'inpaint';
}

const KIND_LABEL = { subtitle: '자막', logo: '워터마크', emoji: '이모지' } as const;
const METHOD_LABEL = { crop: '크롭(가장자리)', delogo: '보간 제거', boxblur: '블러', inpaint: 'AI 인페인팅' } as const;
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
  videoWidth,
  videoHeight,
  zones,
  onChange,
}: {
  frameUrl: string;
  videoWidth: number;
  videoHeight: number;
  zones: ZoneDraft[];
  onChange: (zones: ZoneDraft[]) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const scale = () => {
    const img = imgRef.current;
    if (!img) return 1;
    return videoWidth / img.clientWidth;
  };

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
        <img ref={imgRef} src={frameUrl} alt="frame" className="max-h-[420px] rounded-lg" draggable={false} />
        {zones.map((z) => (
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
              <span className="ml-auto" />
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
