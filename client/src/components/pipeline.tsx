import { useState } from 'react';
import { clsx } from 'clsx';
import { Check, ChevronRight, CircleDot, Flag } from 'lucide-react';
import {
  MENU_A_STATES, MENU_B_STATES, STATE_GUIDE, STATE_LABELS, type Menu,
} from '@shared/constants';
import { focusRing } from '@/components/ui';

/**
 * 현재 단계 안내 배너 — 이 앱을 처음 쓰는 사람이 가이드 문서 없이 진행할 수 있게 하는 장치.
 *
 * 단계 이름만으로는 무엇을 해야 할지 알 수 없어서, 늘 세 가지를 같이 보여준다:
 * 이 단계가 무엇인지 · 지금 할 일 · 무엇을 채우면 다음으로 넘어가는지.
 */
export function StepGuide({
  pipeline,
  state,
  viewing,
}: {
  pipeline: string[];
  state: string;
  /** 레일에서 지난 단계를 눌러 들여다보는 중이면 그 단계 (현재 진행 단계와 다름) */
  viewing?: string;
}) {
  const shown = viewing ?? state;
  const guide = STATE_GUIDE[shown];
  if (!guide) return null;

  const step = pipeline.indexOf(shown);
  const isCurrent = shown === state;

  return (
    <section
      className={clsx(
        'rounded-xl border p-4',
        isCurrent ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white',
      )}
    >
      <div className="flex items-start gap-2.5">
        <CircleDot size={18} className={clsx('mt-0.5 shrink-0', isCurrent ? 'text-brand-600' : 'text-slate-500')} />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold break-keep text-slate-900">
            {step >= 0 && (
              <span className={isCurrent ? 'text-brand-700' : 'text-slate-500'}>
                {step + 1}단계 ·{' '}
              </span>
            )}
            {STATE_LABELS[shown] ?? shown}
            {!isCurrent && <span className="ml-2 text-xs font-normal text-slate-500">(지나간 단계를 보는 중)</span>}
          </p>
          <p className="break-keep text-sm text-slate-700">{guide.what}</p>
          <p className="break-keep text-sm">
            <span className="font-medium text-slate-900">지금 할 일 · </span>
            <span className="text-slate-700">{guide.todo}</span>
          </p>
          {guide.next && (
            <p className="flex items-start gap-1.5 break-keep text-xs text-slate-600">
              <Flag size={13} className="mt-0.5 shrink-0" />
              {guide.next}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * 이 메뉴가 영상 한 편을 만드는 전체 순서. 카테고리 화면 맨 위에 둔다.
 *
 * 시작하기 전에 앞으로 무엇을 하게 되는지 한 번은 보여줘야, 3단계쯤에서
 * "이게 언제 끝나지" 하고 멈추지 않는다.
 */
export function FlowOverview({ menu }: { menu: Menu }) {
  const states = menu === 'menu-a' ? MENU_A_STATES : MENU_B_STATES;
  // 처음 쓰는 사람에게 보이는 것이 목적이라 기본은 펼침. 접었다면 그 선택은 기억한다
  const key = `flow-overview-collapsed:${menu}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== '1');

  return (
    <details
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        localStorage.setItem(key, next ? '0' : '1');
      }}
      className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <summary
        className={clsx(
          'flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-slate-900',
          focusRing,
        )}
      >
        <ChevronRight size={15} className="shrink-0 transition-transform group-open:rotate-90" />
        영상 한 편이 만들어지는 순서 ({states.length}단계)
      </summary>
      <ol className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
        {states.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={13} className="shrink-0 text-slate-400" aria-hidden />}
            <span
              title={STATE_GUIDE[s]?.what}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs break-keep text-slate-700"
            >
              {/* 칩 배경(slate-100) 위라 slate-500은 4.34:1로 모자란다 */}
              <span className="text-slate-600">{i + 1}.</span> {STATE_LABELS[s] ?? s}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 break-keep text-xs text-slate-600">
        각 단계 화면 위에 무엇을 하는 단계인지·지금 할 일·언제 다음으로 넘어가는지가 적혀 있습니다.
        단계 이름에 마우스를 올리면 설명이 나옵니다.
      </p>
    </details>
  );
}

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
              // 아직 안 온 단계도 무엇을 하는 단계인지는 알 수 있어야 한다 (누르지는 못해도)
              title={STATE_GUIDE[s]?.what ?? STATE_LABELS[s] ?? s}
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
