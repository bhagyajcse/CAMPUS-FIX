import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import {
  Upload,
  Mic,
  MicOff,
  QrCode,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Clock,
  Users,
  CopyCheck,
  Loader2,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { SAMPLE_PHOTO_PRESETS, renderSampleFacilityPng } from '../lib/sampleImages';
import type { CampusLocation, DuplicateMatch, UserRole, VisionAnalysis } from '../types';

interface SubmitComplaintPanelProps {
  userRole: UserRole;
  locations: CampusLocation[];
  initialPrefill?: {
    block?: string;
    floor?: string;
    room?: string;
    description?: string;
    category?: string;
  } | null;
  onSubmitted: () => void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

export function SubmitComplaintPanel({ userRole, locations, initialPrefill, onSubmitted }: SubmitComplaintPanelProps) {
  const isStudent = userRole === 'student';
  const [imageDataUrl, setImageDataUrl] = useState<string>('');
  const [description, setDescription] = useState('');
  const [block, setBlock] = useState('');
  const [floor, setFloor] = useState('');
  const [room, setRoom] = useState('');
  const [selectedQr, setSelectedQr] = useState('');

  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');

  const [analysis, setAnalysis] = useState<VisionAnalysis | null>(null);
  const [missingLocationFields, setMissingLocationFields] = useState<string[]>([]);
  const [locationPrompt, setLocationPrompt] = useState('');
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateMatch | null>(null);
  const [submitResult, setSubmitResult] = useState<{
    duplicateDetected: boolean;
    message: string;
    ticketCode?: string;
    assignedTeam?: string;
    assignedTechnician?: string;
    isElectricalHazard?: boolean;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    if (initialPrefill) {
      if (initialPrefill.block) setBlock(initialPrefill.block);
      if (initialPrefill.floor) setFloor(initialPrefill.floor);
      if (initialPrefill.room) setRoom(initialPrefill.room);
      if (initialPrefill.description) setDescription(initialPrefill.description);
      setAnalysis(null);
      setDuplicateMatch(null);
      setSubmitResult(null);
    }
  }, [initialPrefill]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageDataUrl(reader.result);
        setAnalysis(null);
        setDuplicateMatch(null);
        setError('');
      }
    };
    reader.readAsDataURL(file);
  }

  function handleSelectSample(presetId: string) {
    const preset = SAMPLE_PHOTO_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const pngUrl = renderSampleFacilityPng(preset.id);
    setImageDataUrl(pngUrl);
    if (!description.trim()) {
      setDescription(preset.suggestedDescription);
    }
    setAnalysis(null);
    setDuplicateMatch(null);
    setError('');
  }

  function handleQrSelect(slug: string) {
    setSelectedQr(slug);
    const match = locations.find((l) => l.qr_code_slug === slug);
    if (match) {
      setBlock(match.block);
      setFloor(match.floor);
      setRoom(match.room);
      setMissingLocationFields([]);
      setLocationPrompt('');
    }
  }

  function toggleVoiceInput() {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setError('Voice recognition is not supported in this browser. Please type your description.');
      return;
    }

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const spoken = event.results[0]?.[0]?.transcript || '';
      if (spoken) {
        setDescription((prev) => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken));
      }
    };
    rec.onerror = () => {
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
    };

    recognitionRef.current = rec;
    setListening(true);
    setError('');
    rec.start();
  }

  async function runAgentTriage() {
    setError('');
    setSubmitResult(null);
    if (!imageDataUrl && !description.trim()) {
      setError('Upload a facility photograph or describe the issue to run AI triage.');
      return;
    }

    setAnalyzing(true);
    try {
      const res = await apiFetch<{
        analysis: VisionAnalysis;
        missingLocationFields: string[];
        locationPrompt: string;
        duplicateMatch: DuplicateMatch | null;
      }>('/api/agent/analyze', {
        method: 'POST',
        body: JSON.stringify({
          imageDataUrl: imageDataUrl || undefined,
          description,
          block,
          floor,
          room,
        }),
      });

      setAnalysis(res.analysis);
      if (res.analysis.extractedBlock && !block.trim()) setBlock(res.analysis.extractedBlock);
      if (res.analysis.extractedFloor && !floor.trim()) setFloor(res.analysis.extractedFloor);
      if (res.analysis.extractedRoom && !room.trim()) setRoom(res.analysis.extractedRoom);
      setMissingLocationFields(res.missingLocationFields);
      setLocationPrompt(res.locationPrompt);
      setDuplicateMatch(res.duplicateMatch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFinalSubmit() {
    setError('');
    if (!block.trim() || !floor.trim() || !room.trim()) {
      setLocationPrompt('Could you please specify the block, floor, and room number where the issue occurred?');
      setMissingLocationFields(['block', 'floor', 'room'].filter((k) => {
        if (k === 'block') return !block.trim();
        if (k === 'floor') return !floor.trim();
        return !room.trim();
      }));
      return;
    }

    if (analysis && !analysis.imageClear) {
      setError(analysis.clarificationNeeded || 'Please upload a clearer photograph before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{
        duplicateDetected: boolean;
        message?: string;
        linkedComplaint?: DuplicateMatch;
        ticket_code?: string;
        assignedTeam?: string;
        assignedTechnician?: string;
        isElectricalHazard?: boolean;
      }>('/api/complaints/submit', {
        method: 'POST',
        body: JSON.stringify({
          imageDataUrl: imageDataUrl || undefined,
          description: description.trim() || analysis?.faultDescription,
          block,
          floor,
          room,
          category: analysis?.faultCategory || initialPrefill?.category || 'Other facility issue',
          aiFaultDescription: analysis?.faultDescription,
          aiConfidence: analysis?.confidence,
          aiSeverity: analysis?.severity,
          aiSafetyWarning: analysis?.safetyWarning,
          priority: analysis?.priority,
          slaHours: analysis?.slaHours,
          isElectricalHazard: analysis?.isElectricalHazard,
        }),
      });

      if (res.duplicateDetected) {
        setSubmitResult({
          duplicateDetected: true,
          message: res.message || `Linked to existing ticket ${res.linkedComplaint?.ticket_code}.`,
          ticketCode: res.linkedComplaint?.ticket_code,
          assignedTeam: res.linkedComplaint?.team_name || undefined,
        });
      } else {
        setSubmitResult({
          duplicateDetected: false,
          message: `Ticket ${res.ticket_code} created and dispatched to ${res.assignedTeam}.`,
          ticketCode: res.ticket_code,
          assignedTeam: res.assignedTeam,
          assignedTechnician: res.assignedTechnician,
          isElectricalHazard: res.isElectricalHazard,
        });
      }
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit complaint.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setImageDataUrl('');
    setDescription('');
    setBlock('');
    setFloor('');
    setRoom('');
    setSelectedQr('');
    setAnalysis(null);
    setMissingLocationFields([]);
    setLocationPrompt('');
    setDuplicateMatch(null);
    setSubmitResult(null);
    setError('');
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Intake Form */}
      <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Report Campus Facility Issue</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload a photo and describe the fault. The AI agent will classify urgency, extract location, check duplicates, and route to the right team.
            </p>
          </div>
          {(imageDataUrl || description || analysis) && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap shrink-0"
            >
              Reset Form
            </button>
          )}
        </div>

        {/* Photo Upload & Quick Test Presets */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">1. Facility Photograph (Vision AI Input)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {!imageDataUrl ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-slate-300 hover:border-blue-600 rounded-lg p-6 text-center cursor-pointer bg-slate-50/70 transition-colors"
            >
              <Upload className="w-6 h-6 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-800">Click to upload photo of the issue</p>
              <p className="text-xs text-slate-500 mt-1">Supports PNG, JPG, WEBP from phone or computer</p>
            </div>
          ) : (
            <div className="relative">
              <img
                src={imageDataUrl}
                alt="Uploaded facility fault"
                className="w-full h-56 object-contain bg-slate-100 rounded-lg border border-slate-200"
              />
              <button
                type="button"
                onClick={() => {
                  setImageDataUrl('');
                  setAnalysis(null);
                }}
                aria-label="Remove uploaded image"
                className="absolute top-2 right-2 p-1.5 bg-white border border-slate-200 rounded-md text-slate-700 hover:text-red-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="mt-3">
            <p className="text-[11px] font-medium text-slate-500 mb-1.5">Or load a sample campus issue image to test AI Vision:</p>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_PHOTO_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectSample(preset.id)}
                  className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-colors whitespace-nowrap"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Description + Voice Input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-700">2. Issue Description (Text or Voice)</label>
            <button
              type="button"
              onClick={toggleVoiceInput}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                listening
                  ? 'bg-red-50 border-red-300 text-red-700'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              {listening ? 'Stop Recording' : 'Voice Input'}
            </button>
          </div>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setAnalysis(null);
            }}
            placeholder='e.g. "The projector in Block A, 2nd Floor, Room 204 is not turning on and shows a red error light."'
            className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          />
        </div>

        {/* Location + QR Scan Preset */}
        <div className="pt-2 border-t border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <label className="text-xs font-semibold text-slate-700">3. Campus Location Details</label>
            <div className="flex items-center gap-2">
              <QrCode className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={selectedQr}
                onChange={(e) => handleQrSelect(e.target.value)}
                className="text-xs px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 text-slate-700 focus:outline-none focus:border-blue-600"
              >
                <option value="">Simulate Room QR Scan...</option>
                {locations.map((loc) => (
                  <option key={loc.location_id} value={loc.qr_code_slug}>
                    {loc.qr_code_slug} — {loc.block}, {loc.floor}, {loc.room}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {locationPrompt && (
            <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs font-medium text-amber-900 flex items-start gap-2">
              <MapPin className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{locationPrompt}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Block Name</label>
              <input
                type="text"
                value={block}
                onChange={(e) => {
                  setBlock(e.target.value);
                  setMissingLocationFields((prev) => prev.filter((f) => f !== 'block'));
                }}
                placeholder="e.g. Block A"
                className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${
                  missingLocationFields.includes('block') ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200'
                }`}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Floor Number</label>
              <input
                type="text"
                value={floor}
                onChange={(e) => {
                  setFloor(e.target.value);
                  setMissingLocationFields((prev) => prev.filter((f) => f !== 'floor'));
                }}
                placeholder="e.g. 2nd Floor"
                className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${
                  missingLocationFields.includes('floor') ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200'
                }`}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Room Number</label>
              <input
                type="text"
                value={room}
                onChange={(e) => {
                  setRoom(e.target.value);
                  setMissingLocationFields((prev) => prev.filter((f) => f !== 'room'));
                }}
                placeholder="e.g. 204"
                className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${
                  missingLocationFields.includes('room') ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200'
                }`}
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            disabled={analyzing || submitting}
            onClick={runAgentTriage}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            {analyzing && <Loader2 className="w-4 h-4 animate-spin" />}
            {analyzing ? 'Analyzing Issue...' : analysis ? 'Re-run AI Analysis' : 'Analyze with AI Agent'}
          </button>

          {analysis && analysis.imageClear && (
            <button
              type="button"
              disabled={submitting || !block.trim() || !floor.trim() || !room.trim()}
              onClick={handleFinalSubmit}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {duplicateMatch
                ? 'Link to Existing Ticket'
                : isStudent
                ? 'Submit Issue'
                : 'Confirm & Dispatch Request'}
            </button>
          )}
        </div>
      </div>

      {/* Right AI Agent Triage Result Panel */}
      <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="border-b border-slate-200 pb-4">
          <h3 className="text-base font-semibold text-slate-900">
            {isStudent ? 'AI Issue Assessment' : 'AI Agent Triage & Routing'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {isStudent
              ? 'Real-time Vision fault classification, location extraction, safety check, and duplicate detection.'
              : 'Real-time Vision classification, location extraction, duplicate check, and SLA routing.'}
          </p>
        </div>

        {submitResult && (
          <div
            className={`p-4 rounded-lg border ${
              submitResult.isElectricalHazard
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-sm">
                  {submitResult.duplicateDetected
                    ? 'Duplicate Report Linked'
                    : isStudent
                    ? 'Issue Submitted'
                    : 'Maintenance Request Dispatched'}
                </p>
                <p>
                  {isStudent && !submitResult.duplicateDetected
                    ? `Your report (${submitResult.ticketCode}) has been logged and queued for campus facility maintenance.`
                    : submitResult.message}
                </p>
                {submitResult.ticketCode && (
                  <p className="font-mono font-semibold pt-1">
                    Ticket: {submitResult.ticketCode}
                    {!isStudent && submitResult.assignedTechnician ? ` · Assigned: ${submitResult.assignedTechnician}` : ''}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {!analysis && !analyzing && (
          <div className="py-12 text-center text-slate-500 space-y-2">
            <p className="text-sm font-medium text-slate-700">Awaiting Issue Details</p>
            <p className="text-xs max-w-xs mx-auto">
              Upload a photo (or select a sample preset) and click &ldquo;Analyze with AI Agent&rdquo; to verify the fault, location, and any existing open reports.
            </p>
          </div>
        )}

        {analyzing && (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-600">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            <p className="text-xs font-medium">Running Gemini Vision recognition & SQLite duplicate scan...</p>
          </div>
        )}

        {analysis && !analyzing && (
          <div className="space-y-4">
            {/* Unclear Image Check */}
            {!analysis.imageClear && (
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                <p className="font-semibold text-sm flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Clarification Needed
                </p>
                <p>{analysis.clarificationNeeded}</p>
              </div>
            )}

            {/* Immediate Electrical Hazard Warning */}
            {analysis.isElectricalHazard && (
              <div className="p-4 rounded-lg bg-red-50 border border-red-300 text-red-900 text-xs space-y-1.5">
                <p className="font-semibold text-sm flex items-center gap-1.5 text-red-800">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  Emergency Electrical Hazard Detected
                </p>
                <p>{analysis.safetyWarning}</p>
                <p className="font-medium text-red-800">Immediate safety escalation triggered. Keep clear of the area.</p>
              </div>
            )}

            {/* Duplicate Complaint Detection Alert */}
            {duplicateMatch && (
              <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-950 text-xs space-y-1.5">
                <p className="font-semibold text-sm flex items-center gap-1.5 text-blue-800">
                  <CopyCheck className="w-4 h-4 text-blue-600 shrink-0" />
                  Duplicate Complaint Detected in SQLite
                </p>
                <p>
                  An open <strong>{duplicateMatch.category}</strong> request already exists at{' '}
                  <strong>
                    {duplicateMatch.block}, {duplicateMatch.floor}, {duplicateMatch.room}
                  </strong>
                  .
                </p>
                <p className="font-mono text-[11px] text-blue-800">
                  Existing Ticket: {duplicateMatch.ticket_code} · Status: {duplicateMatch.status} · Reports: {duplicateMatch.report_count}
                </p>
                <p className="text-blue-800">
                  Submitting will link your account to {duplicateMatch.ticket_code} and notify you on resolution without creating a duplicate task.
                </p>
              </div>
            )}

            {/* Structured Diagnosis Output */}
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
              <div className="p-3.5 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-500">Fault Category</span>
                <span className="text-xs font-semibold text-slate-900">{analysis.faultCategory}</span>
              </div>
              <div className="p-3.5 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-500">Vision Confidence</span>
                <span className="text-xs font-mono font-semibold tabular-nums text-slate-900">
                  {analysis.confidence}%
                </span>
              </div>
              <div className="p-3.5 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-500">Severity & Priority</span>
                <span
                  className={`text-xs font-semibold ${
                    analysis.priority === 'Critical'
                      ? 'text-red-700'
                      : analysis.priority === 'High'
                      ? 'text-amber-700'
                      : 'text-slate-900'
                  }`}
                >
                  {analysis.priority} ({analysis.slaHours}h SLA)
                </span>
              </div>
              <div className="p-3.5 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-500 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> Extracted Location
                </span>
                <span className="text-xs font-medium text-slate-900 text-right">
                  {block && floor && room
                    ? `${block} · ${floor} · ${room}`
                    : 'Incomplete — specify Block, Floor & Room'}
                </span>
              </div>
              {!isStudent && (
                <div className="p-3.5 flex items-center justify-between gap-4">
                  <span className="text-xs text-slate-500 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> Assigned Team
                  </span>
                  <span className="text-xs font-semibold text-blue-700">{analysis.recommendedTeam}</span>
                </div>
              )}
              <div className="p-3.5 flex items-center justify-between gap-4">
                <span className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Resolution Target
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-900">{analysis.slaHours} hours</span>
              </div>
              <div className="p-3.5 space-y-1">
                <span className="text-xs text-slate-500 block">AI Fault Summary</span>
                <p className="text-xs text-slate-800 leading-relaxed">{analysis.faultDescription}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
