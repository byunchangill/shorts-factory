import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

/**
 * 키보드 포커스 표시. 마우스 클릭에는 뜨지 않고 Tab으로 옮겨왔을 때만 보인다
 * (`focus`가 아니라 `focus-visible`). 이게 없으면 키보드로 지금 어디에 있는지 알 수 없다
 */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        focusRing,
        variant === 'primary' && 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50',
        variant === 'danger' && 'bg-red-600 text-white shadow-sm hover:bg-red-700',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        className,
      )}
      {...props}
    />
  );
}

/**
 * 아이콘만 있는 보조 동작 버튼 (삭제 등).
 *
 * 마우스를 올려야 나타나는 방식은 쓰지 않는다 — 있는 줄 모르면 없는 기능이고,
 * 터치 화면에서는 hover 자체가 없다. 늘 보이되 색을 낮춰 주 동작을 가리지 않는다.
 */
export function IconButton({
  tone = 'default',
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'danger'; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        // 아이콘은 작아도 누를 수 있는 면적은 확보한다 (데스크톱 전용이라 44px 대신 36px)
        'inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors duration-200',
        focusRing,
        tone === 'default' && 'hover:bg-slate-100 hover:text-slate-900',
        tone === 'danger' && 'hover:bg-red-50 hover:text-red-600',
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    // 그림자 없이 테두리만. 카드가 카드 안에 들어가는 화면이 많아 그림자가 겹치면 지저분해진다
    <div className={clsx('rounded-xl border border-slate-200 bg-white p-4', className)}>
      {children}
    </div>
  );
}

export function Badge({
  color = 'slate',
  children,
}: {
  // 초록·노랑·빨강은 상태(성공·주의·오류) 전용이다. 분류 표시에는 slate나 brand를 쓴다
  color?: 'slate' | 'brand' | 'green' | 'amber' | 'red';
  children: ReactNode;
}) {
  const colors = {
    slate: 'bg-slate-100 text-slate-700',
    brand: 'bg-brand-50 text-brand-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        colors[color],
        // 흰 카드 위에서 배지 경계가 뭉개지지 않게 같은 계열의 옅은 테두리를 준다
        color === 'slate' && 'ring-slate-200',
        color === 'brand' && 'ring-brand-200',
        color === 'green' && 'ring-green-200',
        color === 'amber' && 'ring-amber-200',
        color === 'red' && 'ring-red-200',
      )}
    >
      {children}
    </span>
  );
}

const fieldBase =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(fieldBase, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(fieldBase, 'font-mono', className)} {...props} />;
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  // Esc로 닫기 — 배경을 정확히 클릭해야만 닫히면 좁은 화면에서 빠져나갈 길이 없다
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold tracking-tight">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/**
 * 되돌리기 어려운 동작(삭제) 확인창.
 *
 * `confirmWord`를 주면 그 말을 그대로 타이핑해야 버튼이 열린다 —
 * 카테고리 하나에 영상 작업이 통째로 딸려가므로, 눌러서 지워지는 거리를 벌린다.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '삭제',
  confirmWord,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  confirmWord?: string;
  pending?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  // 창을 닫았다 다시 열면 입력은 비어 있어야 한다 (앞서 친 이름이 남아 바로 눌리면 안 된다)
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const ready = !confirmWord || typed.trim() === confirmWord;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3 text-sm text-slate-600">
        {description}
        {confirmWord && (
          <div>
            <label className="mb-1 block text-xs text-slate-500">
              확인을 위해 <b className="text-slate-700">{confirmWord}</b> 를 입력하세요
            </label>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button variant="danger" onClick={onConfirm} disabled={!ready || pending}>
            {pending ? '삭제 중…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function Spinner() {
  return (
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
  );
}

/**
 * 화면 맨 위 제목줄. 뒤로가기·현재 위치·제목·동작 버튼이 모든 화면에서 같은 자리에 온다.
 *
 * 뒤로가기는 히스토리를 되감지 않고 상위 화면을 직접 가리킨다 — 대시보드에서 바로 들어오거나
 * URL을 새로 열었을 때도 갈 곳이 있어야 한다. 제목 왼쪽의 네모 버튼이라 눈에 걸리고,
 * 어느 화면에서든 같은 위치라 찾을 필요가 없다.
 */
/**
 * 계층 위치 표시. 메뉴 > 카테고리 > 영상 작업으로 3단이라 현재 위치를 글로도 보여준다.
 * 마지막 칸은 현재 화면이므로 링크하지 않는다
 */
export function Breadcrumb({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="현재 위치" className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-500" aria-hidden>/</span>}
          {it.to ? (
            <Link
              to={it.to}
              className={clsx('rounded break-keep hover:text-brand-700 hover:underline', focusRing)}
            >
              {it.label}
            </Link>
          ) : (
            <span className="break-keep">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({
  backTo,
  backLabel,
  eyebrow,
  title,
  actions,
}: {
  backTo?: string;
  backLabel?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {backTo && (
          <Link
            to={backTo}
            aria-label={backLabel ?? '뒤로'}
            title={backLabel ?? '뒤로'}
            className={clsx(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300',
              'bg-white text-slate-600 shadow-sm transition-colors duration-200',
              'hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900',
              focusRing,
            )}
          >
            <ArrowLeft size={18} />
          </Link>
        )}
        <div className="min-w-0">
          {/*
            `eyebrow`는 아무 노드나 올 수 있다 — 실제로 Breadcrumb의 <nav>가 온다.
            <p> 안에는 문장 요소만 들어갈 수 있어서, 브라우저가 <p>를 먼저 닫아버리고
            React는 하이드레이션 오류를 낸다. 감싸는 것은 <div>여야 한다.
          */}
          {eyebrow && <div className="text-xs font-medium text-slate-500">{eyebrow}</div>}
          <h2 className="truncate text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-14">
      <p className="max-w-md break-keep text-center text-sm text-slate-600">{message}</p>
      {action}
    </div>
  );
}
