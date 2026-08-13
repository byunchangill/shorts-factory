import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { STATE_LABELS } from '@shared/constants';
import { focusRing } from '@/components/ui';

/** 가로 점 인디케이터 — 대시보드 잡 카드용 */
export function StepIndicator({ pipeline, state }: { pipeline: string[]; state: string }) {
  const idx = pipeline.indexOf(state);
  const label = STATE_LABELS[state] ?? state;
  return (
    // 진행도를 색으로만 알리지 않는다 — 화면 낭독기에는 막대가 보이지 않는다
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={idx < 0 ? `진행 멈춤: ${label}` : `${pipeline.length}단계 중 ${idx + 1}단계 · ${label}`}
    >
      {pipeline.map((s, i) => (
        <div
          key={s}
          title={STATE_LABELS[s] ?? s}
          className={clsx(
            'h-1.5 flex-1 rounded-full',
            idx < 0 ? 'bg-red-300' : i < idx ? 'bg-brand-500' : i === idx ? 'bg-brand-600 ring-2 ring-brand-100' : 'bg-slate-200',
          )}
        />
      ))}
    </div>
  );
}

/** 세로 체크리스트 — 잡 화면 좌측 고정 레일 */
export function ProgressRail({
  pipeline,
  state,
  onNavigate,
}: {
  pipeline: string[];
  state: string;
  onNavigate?: (state: string) => void;
}) {
  const idx = pipeline.indexOf(state);
  return (
    <ol className="space-y-0.5">
      {pipeline.map((s, i) => {
        const status = idx < 0 ? 'blocked' : i < idx ? 'done' : i === idx ? 'current' : 'todo';
        return (
          <li key={s}>
            <button
              onClick={() => onNavigate?.(s)}
              disabled={status === 'todo'}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                'break-keep', // 좁은 레일에서 "자막/워터마크 제/거"처럼 낱글자로 끊기지 않게
                focusRing,
                status === 'current' && 'bg-brand-50 font-semibold text-brand-700',
                status === 'done' && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                status === 'todo' && 'cursor-default text-slate-500',
                status === 'blocked' && 'font-medium text-red-600',
              )}
            >
              <span
                className={clsx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  status === 'done' && 'bg-brand-500 text-white',
                  status === 'current' && 'bg-brand-600 text-white',
                  // 회색 원 위의 회색 숫자는 10px이라 더 진해야 읽힌다 (slate-500이면 3.9:1)
                  (status === 'todo' || status === 'blocked') && 'bg-slate-200 text-slate-700',
                )}
              >
                {status === 'done' ? <Check size={12} /> : i + 1}
              </span>
              {STATE_LABELS[s] ?? s}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
