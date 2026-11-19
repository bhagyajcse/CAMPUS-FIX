import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend,
} from 'recharts';
import { jsPDF } from 'jspdf';
import { Download, FileSpreadsheet, AlertTriangle, QrCode, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { CampusLocation, PredictiveItem, WeeklyAnalytics } from '../types';

interface WeeklyReportViewProps {
  locations: CampusLocation[];
  onSimulateQrScan: (loc: CampusLocation) => void;
}

export function WeeklyReportView({ locations, onSimulateQrScan }: WeeklyReportViewProps) {
  const [analytics, setAnalytics] = useState<WeeklyAnalytics | null>(null);
  const [predictive, setPredictive] = useState<PredictiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [weeklyRes, predRes] = await Promise.all([
          apiFetch<WeeklyAnalytics>('/api/analytics/weekly'),
          apiFetch<{ recurring: PredictiveItem[] }>('/api/analytics/predictive'),
        ]);
        setAnalytics(weeklyRes);
        setPredictive(predRes.recurring);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load analytics.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function exportPdf() {
    if (!analytics) return;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('CampusFix — Weekly Campus Facility-Health Report', 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

    doc.setFontSize(12);
    doc.text('Executive Summary', 14, 40);
    doc.setFontSize(10);
    const s = analytics.summary;
    doc.text(`Total Complaints: ${s.total}`, 14, 48);
    doc.text(`Resolved / Closed: ${s.resolved} (${s.resolutionRate}% resolution rate)`, 14, 55);
    doc.text(`Pending Open: ${s.pending}`, 14, 62);
    doc.text(`Overdue / Escalated: ${s.overdue}`, 14, 69);
    doc.text(`Average Resolution Time: ${s.avgResolutionHours} hours`, 14, 76);

    let y = 90;
    doc.setFontSize(12);
    doc.text('Block-Wise Complaint Statistics', 14, y);
    y += 8;
    doc.setFontSize(10);
    for (const b of analytics.byBlock) {
      doc.text(`${b.block}: ${b.total} total (${b.resolved} resolved, ${b.open} open)`, 14, y);
      y += 7;
    }

    y += 6;
    doc.setFontSize(12);
    doc.text('Maintenance Team Performance', 14, y);
    y += 8;
    doc.setFontSize(10);
    for (const t of analytics.teamPerformance) {
      doc.text(
        `${t.team}: ${t.assigned} assigned, ${t.resolved} resolved, avg ${t.avg_hours ?? '—'}h, rating ${t.avg_rating ?? '—'}/5`,
        14,
        y
      );
      y += 7;
    }

    if (predictive.length > 0) {
      y += 6;
      doc.setFontSize(12);
      doc.text('Predictive Maintenance Alerts', 14, y);
      y += 8;
      doc.setFontSize(9);
      for (const p of predictive.slice(0, 6)) {
        doc.text(`- ${p.block} ${p.room} (${p.category}, ${p.occurrences}x): ${p.riskLevel} risk`, 14, y);
        y += 6;
      }
    }

    doc.save('CampusFix-Weekly-Facility-Report.pdf');
  }

  function exportCsv() {
    if (!analytics) return;
    const rows = [
      ['Metric', 'Value'],
      ['Total Complaints', String(analytics.summary.total)],
      ['Resolved Complaints', String(analytics.summary.resolved)],
      ['Pending Complaints', String(analytics.summary.pending)],
      ['Overdue Complaints', String(analytics.summary.overdue)],
      ['Resolution Rate (%)', String(analytics.summary.resolutionRate)],
      ['Avg Resolution Hours', String(analytics.summary.avgResolutionHours)],
      [],
      ['Block', 'Total', 'Resolved', 'Open'],
      ...analytics.byBlock.map((b) => [b.block, String(b.total), String(b.resolved), String(b.open)]),
      [],
      ['Team', 'Assigned', 'Resolved', 'Avg Hours', 'Avg Rating'],
      ...analytics.teamPerformance.map((t) => [
        t.team,
        String(t.assigned),
        String(t.resolved),
        String(t.avg_hours ?? ''),
        String(t.avg_rating ?? ''),
      ]),
    ];

    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CampusFix-Weekly-Report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 flex items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
        Compiling weekly facility health metrics...
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
        {error || 'Unable to load weekly report.'}
      </div>
    );
  }

  const s = analytics.summary;

  return (
    <div className="space-y-6">
      {/* Header & Exports */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Weekly Campus Facility-Health Report</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Live SQLite operational telemetry across blocks, categories, SLA compliance, and predictive maintenance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={exportPdf}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            Export PDF Report
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Complaints</p>
          <p className="text-2xl font-mono font-semibold tabular-nums text-slate-900 mt-1">{s.total}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Resolved / Closed</p>
          <p className="text-2xl font-mono font-semibold tabular-nums text-emerald-700 mt-1">{s.resolved}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Pending Open</p>
          <p className="text-2xl font-mono font-semibold tabular-nums text-amber-700 mt-1">{s.pending}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Overdue SLA</p>
          <p className="text-2xl font-mono font-semibold tabular-nums text-red-700 mt-1">{s.overdue}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Resolution Rate</p>
          <p className="text-2xl font-mono font-semibold tabular-nums text-slate-900 mt-1">{s.resolutionRate}%</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Avg Resolution</p>
          <p className="text-2xl font-mono font-semibold tabular-nums text-slate-900 mt-1">{s.avgResolutionHours}h</p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Most Frequently Reported Issues</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.byCategory} layout="vertical" margin={{ left: 20, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis type="category" dataKey="name" width={135} tick={{ fontSize: 11, fill: '#0f172a' }} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]} name="Complaints" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Block-Wise Facility Heatmap</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.byBlock}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="block" tick={{ fontSize: 11, fill: '#0f172a' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="resolved" stackId="a" fill="#16a34a" name="Resolved" />
                <Bar dataKey="open" stackId="a" fill="#d97706" name="Open" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Daily Trend */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Daily Intake vs. Resolution Trend</h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={analytics.dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="submitted" stroke="#2563eb" fill="#dbeafe" name="Submitted" />
              <Area type="monotone" dataKey="resolved" stroke="#16a34a" fill="#dcfce7" name="Resolved" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Team Performance + Predictive Maintenance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">Maintenance Team Performance</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Team</th>
                  <th className="py-2.5 px-4 font-medium text-right">Assigned</th>
                  <th className="py-2.5 px-4 font-medium text-right">Resolved</th>
                  <th className="py-2.5 px-4 font-medium text-right">Avg Time</th>
                  <th className="py-2.5 px-4 font-medium text-right">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {analytics.teamPerformance.map((t) => (
                  <tr key={t.team} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium text-slate-900">{t.team}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{t.assigned}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">{t.resolved}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {t.avg_hours != null ? `${t.avg_hours}h` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {t.avg_rating != null ? `${t.avg_rating}/5` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Predictive Maintenance Alerts</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Facilities with recurring breakdowns flagged for replacement instead of spot repair.
            </p>
          </div>
          {predictive.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No recurring facility failures detected.</p>
          ) : (
            <div className="space-y-3">
              {predictive.map((item, i) => (
                <div key={i} className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/50 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      {item.block}, {item.room} — {item.category}
                    </span>
                    <span className="font-mono font-semibold text-amber-800">{item.occurrences}x</span>
                  </div>
                  <p className="text-slate-700 leading-relaxed">{item.recommendation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Campus Room QR Registry */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Classroom & Facility QR Code Registry</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Post these QR codes inside classrooms and washrooms for one-tap location identification.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {locations.map((loc) => (
            <div
              key={loc.location_id}
              className="p-3.5 rounded-lg border border-slate-200 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {loc.block} · {loc.floor} · {loc.room}
                </p>
                <p className="text-[11px] font-mono text-slate-500 mt-0.5">{loc.qr_code_slug}</p>
              </div>
              <button
                type="button"
                onClick={() => onSimulateQrScan(loc)}
                className="px-2.5 py-1.5 rounded-md bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-xs font-medium text-slate-700 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <QrCode className="w-3.5 h-3.5" />
                Simulate Scan
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
