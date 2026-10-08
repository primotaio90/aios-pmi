'use client';

import type { Toast as ToastT } from '../lib/types';

export function ToastStack({
    toasts,
    onDismiss,
    onResolveApproval,
}: {
    toasts: ToastT[];
    onDismiss: (id: string) => void;
    /** Risolvi un'approvazione dal toast (Fase A): (toastId, approvalId, approved). */
    onResolveApproval?: (toastId: string, approvalId: string, approved: boolean) => void;
}) {
    return (
        <div className="toast-stack">
            {toasts.map((t) =>
                t.approval && onResolveApproval ? (
                    <div key={t.id} className={`toast toast-${t.level} toast-approval`}>
                        <span className="toast-msg">{t.message}</span>
                        <span className="toast-approval-actions">
                            <button
                                type="button"
                                className="toast-action toast-approve"
                                onClick={() => onResolveApproval(t.id, t.approval!.id, true)}
                            >
                                Approva
                            </button>
                            <button
                                type="button"
                                className="toast-action toast-deny"
                                onClick={() => onResolveApproval(t.id, t.approval!.id, false)}
                            >
                                Nega
                            </button>
                        </span>
                    </div>
                ) : (
                    <button key={t.id} type="button" className={`toast toast-${t.level}`} onClick={() => onDismiss(t.id)}>
                        <span className="toast-msg">{t.message}</span>
                    </button>
                )
            )}
        </div>
    );
}
