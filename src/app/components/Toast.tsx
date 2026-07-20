'use client';

import type { Toast as ToastT } from '../lib/types';

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
                <button key={t.id} type="button" className={`toast toast-${t.level}`} onClick={() => onDismiss(t.id)}>
                    <span className="toast-msg">{t.message}</span>
                </button>
            ))}
        </div>
    );
}
