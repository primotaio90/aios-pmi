'use client';

import type { Toast as ToastT } from '../lib/types';

const ICON: Record<ToastT['level'], string> = {
    info: 'ℹ️',
    warn: '⚠️',
    error: '⛔',
    success: '✅',
};

export function ToastStack({
    toasts,
    onDismiss,
}: {
    toasts: ToastT[];
    onDismiss: (id: string) => void;
}) {
    return (
        <div className="toast-stack">
            {toasts.map((t) => (
                <div key={t.id} className={`toast toast-${t.level}`} onClick={() => onDismiss(t.id)}>
                    <span className="toast-icon">{ICON[t.level]}</span>
                    <span className="toast-msg">{t.message}</span>
                </div>
            ))}
        </div>
    );
}