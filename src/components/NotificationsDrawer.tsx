import { X, Bell, CheckCheck, AlertTriangle, CheckCircle2, CopyCheck } from 'lucide-react';
import { formatShortDate } from '../lib/api';
import type { NotificationItem } from '../types';

interface NotificationsDrawerProps {
  open: boolean;
  notifications: NotificationItem[];
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  onOpenComplaint: (complaintId: number) => void;
}

export function NotificationsDrawer({
  open,
  notifications,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onOpenComplaint,
}: NotificationsDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
      <div className="w-full max-w-md bg-white h-full border-l border-slate-200 flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
          </div>
          <div className="flex items-center gap-2">
            {notifications.some((n) => !n.read_status) && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
          {notifications.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No notifications yet. Complaint assignments, hazard alerts, and resolution confirmation prompts appear here.
            </div>
          ) : (
            notifications.map((n) => {
              const Icon =
                n.type === 'urgent' || n.type === 'escalation'
                  ? AlertTriangle
                  : n.type === 'resolution_check'
                  ? CheckCircle2
                  : n.type === 'duplicate'
                  ? CopyCheck
                  : Bell;

              return (
                <div
                  key={n.notification_id}
                  onClick={() => {
                    if (!n.read_status) onMarkRead(n.notification_id);
                    if (n.complaint_id) {
                      onOpenComplaint(n.complaint_id);
                      onClose();
                    }
                  }}
                  className={`p-4 cursor-pointer transition-colors hover:bg-slate-50 ${
                    n.read_status ? 'bg-white' : 'bg-blue-50/40'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        n.type === 'urgent' || n.type === 'escalation'
                          ? 'text-red-600'
                          : n.type === 'resolution_check'
                          ? 'text-emerald-600'
                          : 'text-blue-600'
                      }`}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-xs ${n.read_status ? 'font-medium text-slate-800' : 'font-semibold text-slate-900'}`}>
                          {n.title}
                        </p>
                        {!n.read_status && (
                          <span className="text-[10px] font-semibold text-blue-700 shrink-0">New</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                      <p className="text-[11px] font-mono text-slate-400">{formatShortDate(n.created_at)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
