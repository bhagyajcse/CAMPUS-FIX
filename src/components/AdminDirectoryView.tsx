import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { MaintenanceTeam, TechnicianRow, User } from '../types';

interface AdminDirectoryViewProps {
  teams: MaintenanceTeam[];
  technicians: TechnicianRow[];
  onRefresh: () => void;
}

export function AdminDirectoryView({ teams, technicians, onRefresh }: AdminDirectoryViewProps) {
  const [users, setUsers] = useState<Array<User & { created_at: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await apiFetch<{ users: Array<User & { created_at: string }> }>('/api/users');
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function updateAvailability(technicianId: number, availability: 'Available' | 'Busy' | 'Off Duty') {
    await apiFetch('/api/technicians/availability', {
      method: 'PATCH',
      body: JSON.stringify({ technicianId, availability }),
    });
    onRefresh();
  }

  async function updateRole(userId: number, role: User['role']) {
    await apiFetch(`/api/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    loadUsers();
  }

  return (
    <div className="space-y-6">
      {/* Maintenance Teams */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Maintenance Teams & Technician Workload</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            AI auto-routing assigns complaints based on team specialization, availability, and active load.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6 border-b border-slate-200">
          {teams.map((team) => (
            <div key={team.team_id} className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1">
              <p className="text-sm font-semibold text-slate-900">{team.team_name}</p>
              <p className="text-xs text-slate-600">{team.specialization}</p>
              <p className="text-[11px] font-mono text-slate-500">{team.contact_email}</p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4 font-medium">Technician</th>
                <th className="py-2.5 px-4 font-medium">Team</th>
                <th className="py-2.5 px-4 font-medium text-right">Active Jobs</th>
                <th className="py-2.5 px-4 font-medium text-right">Availability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {technicians.map((tech) => (
                <tr key={tech.technician_id} className="hover:bg-slate-50">
                  <td className="py-3 px-4">
                    <p className="font-medium text-slate-900">{tech.name}</p>
                    <p className="text-[11px] text-slate-500">{tech.email}</p>
                  </td>
                  <td className="py-3 px-4 text-slate-700">{tech.team_name}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-medium">{tech.active_load}</td>
                  <td className="py-3 px-4 text-right">
                    <select
                      value={tech.availability}
                      onChange={(e) =>
                        updateAvailability(
                          tech.technician_id,
                          e.target.value as 'Available' | 'Busy' | 'Off Duty'
                        )
                      }
                      className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs text-slate-800"
                    >
                      <option value="Available">Available</option>
                      <option value="Busy">Busy</option>
                      <option value="Off Duty">Off Duty</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Campus Users Directory */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Campus Users & Role Access</h3>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            Loading campus users...
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-red-700">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Name</th>
                  <th className="py-2.5 px-4 font-medium">Email</th>
                  <th className="py-2.5 px-4 font-medium">Department</th>
                  <th className="py-2.5 px-4 font-medium text-right">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((u) => (
                  <tr key={u.user_id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium text-slate-900">{u.name}</td>
                    <td className="py-3 px-4 font-mono text-slate-600">{u.email}</td>
                    <td className="py-3 px-4 text-slate-600">{u.department}</td>
                    <td className="py-3 px-4 text-right">
                      <select
                        value={u.role}
                        onChange={(e) => updateRole(u.user_id, e.target.value as User['role'])}
                        className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs text-slate-800 capitalize"
                      >
                        <option value="student">student</option>
                        <option value="faculty">faculty</option>
                        <option value="technician">technician</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
