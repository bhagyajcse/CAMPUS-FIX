import { useState, useEffect, useCallback } from 'react';
import {
  Wrench,
  LayoutDashboard,
  PlusCircle,
  MessageSquare,
  BarChart3,
  Users,
  Bell,
  LogOut,
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';
import { apiFetch, formatDeadlineCountdown, formatShortDate, getStoredToken, setStoredToken } from './lib/api';
import { AuthView } from './components/AuthView';
import { SubmitComplaintPanel } from './components/SubmitComplaintPanel';
import { ComplaintDetailModal } from './components/ComplaintDetailModal';
import { CampusAssistantPanel } from './components/CampusAssistantPanel';
import { WeeklyReportView } from './components/WeeklyReportView';
import { AdminDirectoryView } from './components/AdminDirectoryView';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import type {
  CampusLocation,
  Complaint,
  MaintenanceTeam,
  NotificationItem,
  TechnicianInfo,
  TechnicianRow,
  User,
} from './types';

type ActiveTab = 'dashboard' | 'submit' | 'assistant' | 'reports' | 'directory';

const STATUS_FILTERS = ['All', 'Assigned', 'In Progress', 'Resolved', 'Reopened', 'Closed'] as const;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [techInfo, setTechInfo] = useState<TechnicianInfo | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [locations, setLocations] = useState<CampusLocation[]>([]);
  const [teams, setTeams] = useState<MaintenanceTeam[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [loadingData, setLoadingData] = useState(false);
  const [selectedComplaintId, setSelectedComplaintId] = useState<number | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [priorityFilter, setPriorityFilter] = useState<string>('All');
  const [blockFilter, setBlockFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Prefill from AI Assistant or QR Scan
  const [submitPrefill, setSubmitPrefill] = useState<{
    block?: string;
    floor?: string;
    room?: string;
    description?: string;
    category?: string;
  } | null>(null);

  const loadWorkspaceData = useCallback(async (roleOverride?: User['role']) => {
    const activeRole = roleOverride || user?.role;
    setLoadingData(true);
    try {
      const canViewTeams = activeRole === 'admin' || activeRole === 'technician';
      const [cmpRes, locRes, teamRes, notifRes] = await Promise.all([
        apiFetch<{ complaints: Complaint[] }>('/api/complaints'),
        apiFetch<{ locations: CampusLocation[] }>('/api/locations'),
        canViewTeams
          ? apiFetch<{ teams: MaintenanceTeam[]; technicians: TechnicianRow[] }>('/api/teams')
          : Promise.resolve({ teams: [], technicians: [] }),
        apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>('/api/notifications'),
      ]);
      setComplaints(cmpRes.complaints);
      setLocations(locRes.locations);
      setTeams(teamRes.teams);
      setTechnicians(teamRes.technicians);
      setNotifications(notifRes.notifications);
      setUnreadCount(notifRes.unreadCount);
    } catch (err) {
      console.error('Workspace load error:', err);
    } finally {
      setLoadingData(false);
    }
  }, [user?.role]);

  useEffect(() => {
    async function restoreSession() {
      const token = getStoredToken();
      if (!token) {
        setBootstrapping(false);
        return;
      }
      try {
        const res = await apiFetch<{ user: User; technicianInfo: TechnicianInfo | null }>('/api/auth/me');
        setUser(res.user);
        setTechInfo(res.technicianInfo);
        if (res.user.role === 'student') {
          setActiveTab('submit');
        }
      } catch {
        setStoredToken(null);
      } finally {
        setBootstrapping(false);
      }
    }
    restoreSession();
  }, []);

  useEffect(() => {
    if (user) {
      loadWorkspaceData(user.role);
      // Check URL ?qr=... parameter for automatic QR location prefill
      const params = new URLSearchParams(window.location.search);
      const qrSlug = params.get('qr');
      if (qrSlug) {
        apiFetch<{ location: CampusLocation }>(`/api/locations/qr/${encodeURIComponent(qrSlug)}`)
          .then((res) => {
            setSubmitPrefill({
              block: res.location.block,
              floor: res.location.floor,
              room: res.location.room,
            });
            setActiveTab('submit');
          })
          .catch(() => {});
      }
    }
  }, [user, loadWorkspaceData]);

  function handleLogout() {
    setStoredToken(null);
    setUser(null);
    setTechInfo(null);
    setComplaints([]);
    setActiveTab('dashboard');
  }

  async function handleTechAvailabilityChange(availability: 'Available' | 'Busy' | 'Off Duty') {
    await apiFetch('/api/technicians/availability', {
      method: 'PATCH',
      body: JSON.stringify({ availability }),
    });
    setTechInfo((prev) => (prev ? { ...prev, availability } : prev));
    loadWorkspaceData();
  }

  async function handleMarkNotificationRead(id: number) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    loadWorkspaceData();
  }

  async function handleMarkAllRead() {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    loadWorkspaceData();
  }

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Loading CampusFix workspace...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthView
        onAuthenticated={(loggedInUser) => {
          setUser(loggedInUser);
          setActiveTab(loggedInUser.role === 'student' ? 'submit' : 'dashboard');
        }}
      />
    );
  }

  const uniqueBlocks = Array.from(new Set(complaints.map((c) => c.block))).sort();

  const filteredComplaints = complaints.filter((c) => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false;
    if (priorityFilter !== 'All' && c.priority !== priorityFilter) return false;
    if (blockFilter !== 'All' && c.block !== blockFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${c.ticket_code} ${c.category} ${c.description} ${c.block} ${c.room} ${c.team_name || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const openCount = complaints.filter((c) => c.status !== 'Closed' && c.status !== 'Resolved').length;
  const awaitingConfirmCount = complaints.filter((c) => c.status === 'Resolved').length;
  const criticalHazards = complaints.filter(
    (c) => Boolean(c.is_electrical_hazard) && c.status !== 'Closed' && c.status !== 'Resolved'
  );
  const overdueComplaints = complaints.filter(
    (c) =>
      (c.escalation_status === 'Overdue' || c.escalation_status === 'Escalated') &&
      c.status !== 'Closed' &&
      c.status !== 'Resolved'
  );

  const isStudent = user.role === 'student';

  const navItems: Array<{ id: ActiveTab; label: string; icon: typeof LayoutDashboard; show: boolean }> = isStudent
    ? [
        {
          id: 'submit',
          label: 'Report Issue',
          icon: PlusCircle,
          show: true,
        },
        {
          id: 'dashboard',
          label: 'My Reported Issues',
          icon: LayoutDashboard,
          show: true,
        },
        {
          id: 'assistant',
          label: 'AI Assistant',
          icon: MessageSquare,
          show: true,
        },
      ]
    : [
        {
          id: 'dashboard',
          label:
            user.role === 'technician'
              ? 'Assigned Queue'
              : user.role === 'admin'
              ? 'Operations Console'
              : 'My Requests',
          icon: LayoutDashboard,
          show: true,
        },
        {
          id: 'submit',
          label: 'Report Issue',
          icon: PlusCircle,
          show: user.role === 'faculty' || user.role === 'admin',
        },
        {
          id: 'assistant',
          label: 'AI Assistant',
          icon: MessageSquare,
          show: user.role === 'faculty' || user.role === 'admin',
        },
        {
          id: 'reports',
          label: 'Weekly Report',
          icon: BarChart3,
          show: user.role === 'admin' || user.role === 'faculty',
        },
        {
          id: 'directory',
          label: 'Teams & Users',
          icon: Users,
          show: user.role === 'admin',
        },
      ];

  const currentNavLabel = navItems.find((n) => n.id === activeTab)?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar (256px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col justify-between transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                <Wrench className="w-4 h-4" />
              </div>
              <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
                CampusFix
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 text-slate-500"
              aria-label="Close sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="p-4 space-y-1">
            {navItems
              .filter((item) => item.show)
              .map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
          </nav>

          {user.role === 'technician' && techInfo && (
            <div className="mx-4 mt-4 p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
              <p className="text-[11px] font-semibold text-slate-500">Technician Availability</p>
              <select
                value={techInfo.availability}
                onChange={(e) =>
                  handleTechAvailabilityChange(e.target.value as 'Available' | 'Busy' | 'Off Duty')
                }
                className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-200 bg-white text-slate-900 font-medium"
              >
                <option value="Available">Available</option>
                <option value="Busy">Busy</option>
                <option value="Off Duty">Off Duty</option>
              </select>
              <p className="text-[11px] text-slate-500">{techInfo.team_name}</p>
            </div>
          )}
        </div>

        {/* Account Footer */}
        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="px-2">
            <p className="text-xs font-semibold text-slate-900 truncate">{user.name}</p>
            <p className="text-[11px] text-slate-500 capitalize">
              {user.role} · {user.department}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-red-700 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-600"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
              <span className="font-medium text-slate-700">CampusFix</span>
              <span aria-hidden="true">/</span>
              <span className="capitalize">{user.role}</span>
              <span aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 truncate">{currentNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              className="relative px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Bell className="w-4 h-4 text-slate-600" />
              <span>Alerts</span>
              {unreadCount > 0 && (
                <span className="font-mono text-[11px] font-semibold text-red-700 tabular-nums">
                  ({unreadCount})
                </span>
              )}
            </button>

            {user.role !== 'technician' && activeTab !== 'submit' && (
              <button
                type="button"
                onClick={() => setActiveTab('submit')}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <PlusCircle className="w-4 h-4" />
                Report Issue
              </button>
            )}
          </div>
        </header>

        {/* Viewport Content */}
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
          {activeTab === 'dashboard' && (
            <>
              {/* Urgent Electrical Hazard Banner */}
              {criticalHazards.length > 0 && (user.role === 'technician' || user.role === 'admin') && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-300 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-red-900">
                      <p className="font-semibold text-sm text-red-800">
                        Active Critical Electrical Hazard ({criticalHazards[0].ticket_code})
                      </p>
                      <p className="mt-0.5">
                        {criticalHazards[0].block}, {criticalHazards[0].floor}, {criticalHazards[0].room} —{' '}
                        {criticalHazards[0].description}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedComplaintId(criticalHazards[0].complaint_id)}
                    className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
                  >
                    Inspect Hazard
                  </button>
                </div>
              )}

              {/* Reporter Resolution Confirmation Prompt (Faculty) */}
              {awaitingConfirmCount > 0 && user.role === 'faculty' && (
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-blue-950">
                      <p className="font-semibold text-sm">
                        {awaitingConfirmCount} Repaired Request{awaitingConfirmCount > 1 ? 's' : ''} Awaiting Your Confirmation
                      </p>
                      <p className="text-blue-800 mt-0.5">
                        The maintenance team marked an issue as Resolved. Confirm whether it is fixed to close the ticket or reopen it.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const target = complaints.find((c) => c.status === 'Resolved');
                      if (target) setSelectedComplaintId(target.complaint_id);
                    }}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
                  >
                    Review & Confirm
                  </button>
                </div>
              )}

              {/* KPI Summary Strip */}
              <div className={`grid grid-cols-2 ${isStudent ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-4`}>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-500">
                    {user.role === 'technician' ? 'Assigned Tickets' : isStudent ? 'My Submitted Issues' : 'Total Tracked'}
                  </p>
                  <p className="text-2xl font-mono font-semibold tabular-nums text-slate-900 mt-1">
                    {complaints.length}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-500">Active Open</p>
                  <p className="text-2xl font-mono font-semibold tabular-nums text-amber-700 mt-1">
                    {openCount}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <p className="text-xs text-slate-500">
                    {isStudent ? 'Resolved / Fixed' : 'Awaiting Confirmation'}
                  </p>
                  <p className="text-2xl font-mono font-semibold tabular-nums text-blue-700 mt-1">
                    {awaitingConfirmCount}
                  </p>
                </div>
                {!isStudent && (
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <p className="text-xs text-slate-500">Overdue / Escalated</p>
                    <p className="text-2xl font-mono font-semibold tabular-nums text-red-700 mt-1">
                      {overdueComplaints.length}
                    </p>
                  </div>
                )}
              </div>

              {/* Filter Toolbar + High-Density Data Grid */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                    {STATUS_FILTERS.map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setStatusFilter(st)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          statusFilter === st
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search ticket, room, fault..."
                        className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 w-52 focus:outline-none focus:border-blue-600"
                      />
                    </div>

                    <select
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value)}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-700"
                    >
                      <option value="All">All Priorities</option>
                      <option value="Critical">Critical</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>

                    <select
                      value={blockFilter}
                      onChange={(e) => setBlockFilter(e.target.value)}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-700"
                    >
                      <option value="All">All Blocks</option>
                      {uniqueBlocks.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {loadingData && complaints.length === 0 ? (
                  <div className="p-6 space-y-3">
                    {[1, 2, 3, 4].map((row) => (
                      <div key={row} className="h-10 bg-slate-100 rounded animate-pulse" />
                    ))}
                  </div>
                ) : filteredComplaints.length === 0 ? (
                  <div className="p-12 text-center space-y-3">
                    <p className="text-sm font-medium text-slate-800">No complaints match your filters</p>
                    <p className="text-xs text-slate-500">
                      Try clearing filters or submit a new campus facility maintenance request.
                    </p>
                    {user.role !== 'technician' && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('submit')}
                        className="px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg"
                      >
                        Report First Issue
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-3 px-4 font-medium">Ticket</th>
                          <th className="py-3 px-4 font-medium">Fault & Description</th>
                          <th className="py-3 px-4 font-medium">Location</th>
                          <th className="py-3 px-4 font-medium">Priority</th>
                          {!isStudent && <th className="py-3 px-4 font-medium">Assigned Team</th>}
                          {!isStudent && <th className="py-3 px-4 font-medium">SLA Target</th>}
                          <th className="py-3 px-4 font-medium">Status</th>
                          {!isStudent && <th className="py-3 px-4 font-medium text-right">Reports</th>}
                          <th className="py-3 px-4 font-medium text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {filteredComplaints.map((c) => {
                          const sla = formatDeadlineCountdown(c.due_date, c.status);
                          return (
                            <tr
                              key={c.complaint_id}
                              onClick={() => setSelectedComplaintId(c.complaint_id)}
                              className="hover:bg-slate-50 cursor-pointer transition-colors"
                            >
                              <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                                {c.ticket_code}
                              </td>
                              <td className="py-3 px-4 max-w-xs">
                                <p className="font-semibold text-slate-900 truncate">{c.category}</p>
                                <p className="text-slate-500 truncate mt-0.5">{c.description}</p>
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                                {c.block} · {c.floor} · {c.room}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`font-semibold inline-flex items-center gap-1 ${
                                    c.priority === 'Critical'
                                      ? 'text-red-700'
                                      : c.priority === 'High'
                                      ? 'text-amber-700'
                                      : c.priority === 'Medium'
                                      ? 'text-slate-800'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {c.priority === 'Critical' && <AlertTriangle className="w-3.5 h-3.5" />}
                                  {c.priority}
                                </span>
                              </td>
                              {!isStudent && (
                                <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                                  <p>{c.team_name || 'Unassigned'}</p>
                                  {c.technician_name && (
                                    <p className="text-[11px] text-slate-500">{c.technician_name}</p>
                                  )}
                                </td>
                              )}
                              {!isStudent && (
                                <td className="py-3 px-4 whitespace-nowrap">
                                  <span
                                    className={`font-mono tabular-nums inline-flex items-center gap-1 ${
                                      sla.isOverdue
                                        ? 'text-red-700 font-semibold'
                                        : sla.isUrgent
                                        ? 'text-amber-700 font-medium'
                                        : 'text-slate-600'
                                    }`}
                                  >
                                    <Clock className="w-3 h-3" />
                                    {sla.label}
                                  </span>
                                </td>
                              )}
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`font-medium ${
                                    c.status === 'Closed'
                                      ? 'text-emerald-700'
                                      : c.status === 'Resolved'
                                      ? 'text-blue-700 font-semibold'
                                      : c.status === 'Reopened'
                                      ? 'text-red-700 font-semibold'
                                      : 'text-slate-800'
                                  }`}
                                >
                                  {c.status}
                                </span>
                                <p className="text-[11px] text-slate-400 font-mono">
                                  {formatShortDate(c.created_at)}
                                </p>
                              </td>
                              {!isStudent && (
                                <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                                  {c.report_count}
                                </td>
                              )}
                              <td className="py-3 px-4 text-right">
                                <span className="inline-flex items-center gap-1 text-blue-600 font-medium whitespace-nowrap">
                                  {isStudent
                                    ? 'View Status'
                                    : c.status === 'Resolved' && user.role === 'faculty'
                                    ? 'Confirm'
                                    : 'Inspect'}
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'submit' && (
            <SubmitComplaintPanel
              userRole={user.role}
              locations={locations}
              initialPrefill={submitPrefill}
              onSubmitted={() => {
                loadWorkspaceData(user.role);
              }}
            />
          )}

          {activeTab === 'assistant' && (
            <CampusAssistantPanel
              onApplyPrefill={(prefill) => {
                setSubmitPrefill(prefill);
                setActiveTab('submit');
              }}
            />
          )}

          {activeTab === 'reports' && (
            <WeeklyReportView
              locations={locations}
              onSimulateQrScan={(loc) => {
                setSubmitPrefill({
                  block: loc.block,
                  floor: loc.floor,
                  room: loc.room,
                });
                setActiveTab('submit');
              }}
            />
          )}

          {activeTab === 'directory' && user.role === 'admin' && (
            <AdminDirectoryView
              teams={teams}
              technicians={technicians}
              onRefresh={loadWorkspaceData}
            />
          )}
        </main>
      </div>

      {/* Complaint Inspector Modal */}
      {selectedComplaintId !== null && (
        <ComplaintDetailModal
          complaintId={selectedComplaintId}
          currentUser={user}
          teams={teams}
          technicians={technicians}
          onClose={() => setSelectedComplaintId(null)}
          onUpdated={loadWorkspaceData}
        />
      )}

      {/* Notifications Slide-Over */}
      <NotificationsDrawer
        open={notificationsOpen}
        notifications={notifications}
        onClose={() => setNotificationsOpen(false)}
        onMarkRead={handleMarkNotificationRead}
        onMarkAllRead={handleMarkAllRead}
        onOpenComplaint={(cid) => setSelectedComplaintId(cid)}
      />
    </div>
  );
}
