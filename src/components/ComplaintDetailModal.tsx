import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import {
  X,
  AlertTriangle,
  Clock,
  MapPin,
  Users,
  CheckCircle2,
  RotateCcw,
  Star,
  Upload,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { apiFetch, formatDeadlineCountdown, formatShortDate } from '../lib/api';
import { renderSampleFacilityPng } from '../lib/sampleImages';
import { FacilityImage } from './FacilityImage';
import type {
  Complaint,
  ComplaintFeedback,
  ComplaintReporter,
  ComplaintUpdate,
  MaintenanceTeam,
  TechnicianRow,
  User,
} from '../types';

interface ComplaintDetailModalProps {
  complaintId: number;
  currentUser: User;
  teams: MaintenanceTeam[];
  technicians: TechnicianRow[];
  onClose: () => void;
  onUpdated: () => void;
}

export function ComplaintDetailModal({
  complaintId,
  currentUser,
  teams,
  technicians,
  onClose,
  onUpdated,
}: ComplaintDetailModalProps) {
  const [loading, setLoading] = useState(true);
  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [updates, setUpdates] = useState<ComplaintUpdate[]>([]);
  const [reporters, setReporters] = useState<ComplaintReporter[]>([]);
  const [feedback, setFeedback] = useState<ComplaintFeedback[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Technician states
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [progressNote, setProgressNote] = useState('');
  const [repairNotes, setRepairNotes] = useState('');
  const [afterImageDataUrl, setAfterImageDataUrl] = useState('');
  const afterInputRef = useRef<HTMLInputElement | null>(null);

  // Reporter confirmation states
  const [rating, setRating] = useState(5);
  const [confirmComment, setConfirmComment] = useState('');

  // Admin states
  const [reassignTeamId, setReassignTeamId] = useState<number>(0);
  const [reassignTechId, setReassignTechId] = useState<number>(0);
  const [reassignNote, setReassignNote] = useState('');

  async function loadDetail() {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{
        complaint: Complaint;
        updates: ComplaintUpdate[];
        reporters: ComplaintReporter[];
        feedback: ComplaintFeedback[];
      }>(`/api/complaints/${complaintId}`);
      setComplaint(res.complaint);
      setUpdates(res.updates);
      setReporters(res.reporters);
      setFeedback(res.feedback);
      if (res.complaint.team_id) setReassignTeamId(res.complaint.team_id);
      if (res.complaint.technician_id) setReassignTechId(res.complaint.technician_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load complaint details.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [complaintId]);

  function handleAfterPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAfterImageDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  async function performAction(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await loadDetail();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  const isReporterOrLinked =
    complaint &&
    (complaint.user_id === currentUser.user_id ||
      reporters.some((r) => r.user_id === currentUser.user_id) ||
      currentUser.role === 'admin');

  const deadlineInfo = complaint
    ? formatDeadlineCountdown(complaint.due_date, complaint.status)
    : { label: '', isOverdue: false, isUrgent: false };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-semibold text-slate-900">
                {complaint?.ticket_code || `#${complaintId}`}
              </span>
              <span aria-hidden="true">·</span>
              <span>{complaint?.category || 'Loading...'}</span>
              {complaint && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-semibold ${
                      complaint.priority === 'Critical'
                        ? 'text-red-700'
                        : complaint.priority === 'High'
                        ? 'text-amber-700'
                        : 'text-slate-700'
                    }`}
                  >
                    {complaint.priority} Priority
                  </span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-slate-900 truncate mt-0.5">
              {complaint ? `${complaint.block} · ${complaint.floor} · ${complaint.room}` : 'Complaint Details'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="py-16 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Loading ticket record...
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          {!loading && complaint && (
            <>
              {Boolean(complaint.is_electrical_hazard) && complaint.status !== 'Closed' && (
                <div className="p-4 rounded-lg bg-red-50 border border-red-300 text-red-900 text-xs flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-sm text-red-800">Emergency Electrical Hazard Warning</p>
                    <p className="mt-0.5">
                      {complaint.ai_safety_warning ||
                        'Exposed or sparking electrical components reported. Keep area clear until Electrical Team isolates power.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Summary + Photos */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                <div className="md:col-span-5 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1.5">Before Repair Photo</p>
                    <FacilityImage
                      src={complaint.image_path}
                      alt={`${complaint.category} at ${complaint.block}`}
                      category={complaint.category}
                      className="w-full h-44"
                    />
                  </div>
                  {complaint.after_image_path && (
                    <div>
                      <p className="text-xs font-medium text-emerald-700 mb-1.5">After Repair Photo</p>
                      <FacilityImage
                        src={complaint.after_image_path}
                        alt="After repair verification"
                        category={complaint.category}
                        className="w-full h-40"
                      />
                    </div>
                  )}
                </div>

                <div className="md:col-span-7 space-y-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1">Reported Description</p>
                    <p className="text-sm text-slate-900 leading-relaxed">{complaint.description}</p>
                  </div>

                  {complaint.ai_fault_description && (
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                      <p className="font-semibold text-slate-800">
                        AI Vision Diagnosis ({complaint.ai_confidence}% confidence)
                      </p>
                      <p className="text-slate-600">{complaint.ai_fault_description}</p>
                    </div>
                  )}

                  {complaint.before_after_summary && (
                    <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
                      <p className="font-semibold">Before & After Image Verification</p>
                      <p>{complaint.before_after_summary}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-xs border-t border-slate-200 pt-3">
                    <div>
                      <span className="text-slate-500 block">Status</span>
                      <span className="font-semibold text-slate-900">{complaint.status}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Location</span>
                      <span className="font-medium text-slate-900">
                        {complaint.block} · {complaint.floor} · {complaint.room}
                      </span>
                    </div>
                    {currentUser.role !== 'student' && (
                      <>
                        <div>
                          <span className="text-slate-500 block flex items-center gap-1">
                            <Clock className="w-3 h-3" /> SLA Deadline
                          </span>
                          <span
                            className={`font-mono font-semibold tabular-nums ${
                              deadlineInfo.isOverdue ? 'text-red-700' : 'text-slate-900'
                            }`}
                          >
                            {deadlineInfo.label}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block flex items-center gap-1">
                            <Users className="w-3 h-3" /> Assigned Team
                          </span>
                          <span className="font-medium text-slate-900">
                            {complaint.team_name || 'Unassigned'}
                            {complaint.technician_name ? ` · ${complaint.technician_name}` : ''}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> Reporters Linked
                          </span>
                          <span className="font-mono font-medium tabular-nums text-slate-900">
                            {complaint.report_count} {complaint.report_count === 1 ? 'reporter' : 'reporters'}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* REPORTER RESOLUTION CONFIRMATION */}
              {complaint.status === 'Resolved' && isReporterOrLinked && (
                <div className="p-5 rounded-xl bg-blue-50 border border-blue-200 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-blue-950">
                      {currentUser.role === 'student' ? 'Verify Issue Fixed' : 'Resolution Confirmation Required'}
                    </h3>
                    <p className="text-xs text-blue-800 mt-0.5">
                      {currentUser.role === 'student'
                        ? 'This issue was marked as Resolved. Let us know if the problem is fixed.'
                        : 'The maintenance team marked this issue as Resolved. Please verify whether the problem is actually fixed before this ticket is closed.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-700">Service Rating:</span>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        aria-label={`Rate ${star} stars`}
                        className="p-1"
                      >
                        <Star
                          className={`w-4 h-4 ${
                            star <= rating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'
                          }`}
                        />
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    value={confirmComment}
                    onChange={(e) => setConfirmComment(e.target.value)}
                    placeholder="Optional feedback or reason if issue still persists..."
                    className="w-full px-3.5 py-2 text-sm bg-white rounded-lg border border-blue-200 focus:outline-none focus:border-blue-600"
                  />

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        performAction(async () => {
                          await apiFetch(`/api/complaints/${complaint.complaint_id}/confirm`, {
                            method: 'POST',
                            body: JSON.stringify({ confirmed: true, rating, comments: confirmComment }),
                          });
                        })
                      }
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Confirm Fixed & Close Ticket
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        performAction(async () => {
                          await apiFetch(`/api/complaints/${complaint.complaint_id}/confirm`, {
                            method: 'POST',
                            body: JSON.stringify({
                              confirmed: false,
                              rating: 1,
                              comments: confirmComment || 'Issue still not resolved after inspection.',
                            }),
                          });
                        })
                      }
                      className="px-4 py-2 bg-white hover:bg-red-50 text-red-700 border border-red-300 text-xs font-medium rounded-lg inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Not Fixed — Reopen Ticket
                    </button>
                  </div>
                </div>
              )}

              {/* TECHNICIAN WORKFLOW CONTROLS */}
              {(currentUser.role === 'technician' || currentUser.role === 'admin') &&
                complaint.status !== 'Closed' &&
                complaint.status !== 'Resolved' && (
                  <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-900">Technician Repair Workspace</h3>
                      {complaint.assignment_status === 'Pending' && currentUser.role === 'technician' && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              performAction(async () => {
                                await apiFetch(`/api/complaints/${complaint.complaint_id}/accept`, {
                                  method: 'POST',
                                });
                              })
                            }
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg"
                          >
                            Accept Assignment
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectMode(!rejectMode)}
                            className="px-3.5 py-1.5 bg-white border border-slate-300 text-slate-700 hover:text-red-700 text-xs font-medium rounded-lg"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>

                    {rejectMode && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Reason for rejecting assignment (required)..."
                          className="flex-1 px-3 py-2 text-xs bg-white rounded-lg border border-slate-300"
                        />
                        <button
                          type="button"
                          disabled={busy || !rejectReason.trim()}
                          onClick={() =>
                            performAction(async () => {
                              await apiFetch(`/api/complaints/${complaint.complaint_id}/reject`, {
                                method: 'POST',
                                body: JSON.stringify({ reason: rejectReason }),
                              });
                              setRejectMode(false);
                              setRejectReason('');
                            })
                          }
                          className="px-3.5 py-2 bg-red-600 text-white text-xs font-medium rounded-lg"
                        >
                          Submit Rejection
                        </button>
                      </div>
                    )}

                    {/* Progress Note */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={progressNote}
                        onChange={(e) => setProgressNote(e.target.value)}
                        placeholder="Add repair progress update (e.g. 'Ordered replacement capacitor')..."
                        className="flex-1 px-3 py-2 text-xs bg-white rounded-lg border border-slate-200"
                      />
                      <button
                        type="button"
                        disabled={busy || !progressNote.trim()}
                        onClick={() =>
                          performAction(async () => {
                            await apiFetch(`/api/complaints/${complaint.complaint_id}/progress`, {
                              method: 'POST',
                              body: JSON.stringify({ remarks: progressNote }),
                            });
                            setProgressNote('');
                          })
                        }
                        className="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-medium rounded-lg whitespace-nowrap"
                      >
                        Log Progress
                      </button>
                    </div>

                    {/* Mark Resolved with After-Repair Photo */}
                    <div className="pt-3 border-t border-slate-200 space-y-3">
                      <p className="text-xs font-semibold text-slate-800">
                        Complete Repair & Upload After-Repair Evidence
                      </p>
                      <input
                        ref={afterInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAfterPhotoChange}
                        className="hidden"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => afterInputRef.current?.click()}
                          className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          Upload After-Repair Photo
                        </button>
                        <button
                          type="button"
                          onClick={() => setAfterImageDataUrl(renderSampleFacilityPng('repaired'))}
                          className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                        >
                          Use Sample Verified Repair Photo
                        </button>
                        {afterImageDataUrl && (
                          <span className="text-xs font-medium text-emerald-700">Photo ready for AI verification</span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={repairNotes}
                          onChange={(e) => setRepairNotes(e.target.value)}
                          placeholder="Final repair summary (e.g. 'Replaced damaged wire insulation and tested MCB')..."
                          className="flex-1 px-3 py-2 text-xs bg-white rounded-lg border border-slate-200"
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            performAction(async () => {
                              await apiFetch(`/api/complaints/${complaint.complaint_id}/resolve`, {
                                method: 'POST',
                                body: JSON.stringify({
                                  afterImageDataUrl: afterImageDataUrl || undefined,
                                  repairNotes: repairNotes || 'Repair completed and tested.',
                                }),
                              });
                              setRepairNotes('');
                              setAfterImageDataUrl('');
                            })
                          }
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg whitespace-nowrap inline-flex items-center gap-1.5"
                        >
                          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          Mark Resolved
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              {/* ADMIN REASSIGNMENT & ESCALATION */}
              {currentUser.role === 'admin' && complaint.status !== 'Closed' && (
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">Admin Reassignment & Escalation</h3>
                    {complaint.escalation_status !== 'Escalated' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          performAction(async () => {
                            await apiFetch(`/api/complaints/${complaint.complaint_id}/escalate`, {
                              method: 'POST',
                              body: JSON.stringify({ reason: 'Escalated from Admin Console' }),
                            });
                          })
                        }
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Escalate to Critical
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={reassignTeamId}
                      onChange={(e) => {
                        const tid = Number(e.target.value);
                        setReassignTeamId(tid);
                        const firstTech = technicians.find((t) => t.team_id === tid);
                        setReassignTechId(firstTech ? firstTech.technician_id : 0);
                      }}
                      className="px-3 py-2 text-xs bg-white rounded-lg border border-slate-200"
                    >
                      <option value={0}>Select Team...</option>
                      {teams.map((t) => (
                        <option key={t.team_id} value={t.team_id}>
                          {t.team_name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={reassignTechId}
                      onChange={(e) => setReassignTechId(Number(e.target.value))}
                      className="px-3 py-2 text-xs bg-white rounded-lg border border-slate-200"
                    >
                      <option value={0}>Auto-pick Technician</option>
                      {technicians
                        .filter((t) => !reassignTeamId || t.team_id === reassignTeamId)
                        .map((t) => (
                          <option key={t.technician_id} value={t.technician_id}>
                            {t.name} ({t.availability}, load {t.active_load})
                          </option>
                        ))}
                    </select>

                    <button
                      type="button"
                      disabled={busy || !reassignTeamId}
                      onClick={() =>
                        performAction(async () => {
                          await apiFetch(`/api/complaints/${complaint.complaint_id}/reassign`, {
                            method: 'POST',
                            body: JSON.stringify({
                              teamId: reassignTeamId,
                              technicianId: reassignTechId || null,
                              remarks: reassignNote,
                            }),
                          });
                          setReassignNote('');
                        })
                      }
                      className="px-3 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
                    >
                      Reassign Request
                    </button>
                  </div>
                </div>
              )}

              {/* LINKED REPORTERS */}
              {reporters.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-2">
                    Linked Reporters ({reporters.length})
                  </h3>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
                    {reporters.map((rep) => (
                      <div key={rep.id} className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs">
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900">{rep.name}</span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="text-slate-500 capitalize">{rep.role}</span>
                          {rep.note && <p className="text-slate-600 truncate mt-0.5">{rep.note}</p>}
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 shrink-0">
                          {formatShortDate(rep.reported_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AUDIT LOG TIMELINE */}
              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-2">
                  Activity & Audit Log ({updates.length})
                </h3>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
                  {updates.map((u) => (
                    <div key={u.update_id} className="px-4 py-3 flex items-start justify-between gap-4 text-xs">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{u.actor_name}</span>
                          <span className="text-slate-400">·</span>
                          <span className="font-medium text-blue-700">{u.status}</span>
                        </div>
                        <p className="text-slate-600 leading-relaxed">{u.remarks}</p>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                        {formatShortDate(u.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* FEEDBACK HISTORY */}
              {feedback.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-2">Reporter Verification & Rating</h3>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
                    {feedback.map((f) => (
                      <div key={f.feedback_id} className="px-4 py-3 text-xs flex items-center justify-between gap-4">
                        <div>
                          <span className="font-semibold text-slate-900">{f.name}</span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className={f.confirmed_fixed ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
                            {f.confirmed_fixed ? `Confirmed Fixed (${f.rating}/5)` : 'Marked Unresolved'}
                          </span>
                          {f.comments && <p className="text-slate-600 mt-0.5">{f.comments}</p>}
                        </div>
                        <span className="font-mono text-[11px] text-slate-500">{formatShortDate(f.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
