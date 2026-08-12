import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={clsx('rounded-xl border border-slate-200 bg-white p-4 shadow-sm', className)}>
      {children}
    </div>
  );
}

export function Badge({
  color = 'slate',
  children,
}: {
  color?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet';
  children: ReactNode;
}) {
  const colors = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
    violet: 'bg-violet-100 text-violet-700',
  };
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', colors[color])}>
      {children}
    </span>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
        className,
      )}
      {...props}
    />
  );
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
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

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 py-14 text-slate-500">
      <p>{message}</p>
      {action}
    </div>
  );
}
