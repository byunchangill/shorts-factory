import { useRef, useState } from 'react';
import { Scissors, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';

export interface SegmentDraft {
  id: string;
  in: number;
  out: number;
  note: string;
  used: boolean;
}

/** 비디오 플레이어 + in/out 마킹으로 사용할 구간을 고르는 컷 선택기 */
export function SegmentPicker({
  videoUrl,
  segments,
  onChange,
}: {
  videoUrl: string;
  segments: SegmentDraft[];
  onChange: (segments: SegmentDraft[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inPoint, setInPoint] = useState<number | null>(null);

  const now = () => videoRef.current?.currentTime ?? 0;

  const markIn = () => setInPoint(Number(now().toFixed(2)));
  const markOut = () => {
    const out = Number(now().toFixed(2));
    if (inPoint === null || out <= inPoint) return;
    onChange([
      ...segments,
      { id: `g${Date.now().toString(36)}`, in: inPoint, out, note: '', used: true },
    ]);
    setInPoint(null);
  };

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  return (
    <div className="space-y-3">
      <video ref={videoRef} src={videoUrl} controls className="max-h-[420px] w-full rounded-lg bg-black" />
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={markIn}>
          <Scissors size={14} /> 시작점 {inPoint !== null && `(${inPoint}s)`}
        </Button>
        <Button variant="secondary" onClick={markOut} disabled={inPoint === null}>
          끝점 마킹
        </Button>
        {inPoint !== null && (
          <span className="text-xs text-amber-600">시작 {inPoint}s — 재생 후 끝점을 마킹하세요</span>
        )}
      </div>
      {segments.length > 0 && (
        <ul className="space-y-1.5">
          {segments.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
              <input
                type="checkbox"
                checked={s.used}
                onChange={(e) => onChange(segments.map((x) => (x.id === s.id ? { ...x, used: e.target.checked } : x)))}
              />
              <button className="font-mono text-brand-600 hover:underline" onClick={() => seek(s.in)}>
                {s.in.toFixed(1)}s → {s.out.toFixed(1)}s
              </button>
              <span className="text-xs text-slate-400">({(s.out - s.in).toFixed(1)}초)</span>
              <input
                className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs"
                placeholder={`메모 (예: 씬 ${i + 1}용)`}
                value={s.note}
                onChange={(e) => onChange(segments.map((x) => (x.id === s.id ? { ...x, note: e.target.value } : x)))}
              />
              <Button variant="ghost" className="px-1.5 py-1" onClick={() => onChange(segments.filter((x) => x.id !== s.id))}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
