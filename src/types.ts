export type UserRole = 'student' | 'faculty' | 'technician' | 'admin';

export interface User {
  user_id: number;
  name: string;
  email: string;
  role: UserRole;
  department: string;
}

export interface TechnicianInfo {
  technician_id: number;
  team_id: number;
  availability: 'Available' | 'Busy' | 'Off Duty';
  active_load: number;
  team_name: string;
}

export interface CampusLocation {
  location_id: number;
  block: string;
  floor: string;
  room: string;
  qr_code_slug: string;
  facility_type: string;
}

export interface Complaint {
  complaint_id: number;
  ticket_code: string;
  user_id: number;
  location_id: number;
  image_path: string | null;
  after_image_path: string | null;
  description: string;
  category: string;
  ai_fault_description: string;
  ai_confidence: number;
  ai_severity: string;
  ai_safety_warning: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'Submitted' | 'Assigned' | 'In Progress' | 'Resolved' | 'Closed' | 'Reopened';
  report_count: number;
  is_electrical_hazard: number;
  before_after_summary: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  block: string;
  floor: string;
  room: string;
  qr_code_slug: string;
  facility_type: string;
  reporter_name: string;
  reporter_email: string;
  reporter_role: string;
  assignment_id: number | null;
  team_id: number | null;
  technician_id: number | null;
  assignment_status: 'Pending' | 'Accepted' | 'Rejected' | null;
  rejection_reason: string | null;
  assigned_by: string | null;
  team_name: string | null;
  technician_name: string | null;
  due_date: string | null;
  escalation_status: 'On Track' | 'Approaching' | 'Overdue' | 'Escalated' | null;
  escalated_at: string | null;
  feedback_rating: number | null;
}

export interface ComplaintUpdate {
  update_id: number;
  complaint_id: number;
  actor_user_id: number | null;
  actor_name: string;
  status: string;
  remarks: string;
  timestamp: string;
}

export interface ComplaintReporter {
  id: number;
  complaint_id: number;
  user_id: number;
  name: string;
  email: string;
  role: string;
  note: string;
  reported_at: string;
}

export interface ComplaintFeedback {
  feedback_id: number;
  complaint_id: number;
  user_id: number;
  name: string;
  rating: number;
  comments: string;
  confirmed_fixed: number;
  created_at: string;
}

export interface VisionAnalysis {
  imageClear: boolean;
  clarificationNeeded: string;
  faultCategory: string;
  faultDescription: string;
  confidence: number;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  isElectricalHazard: boolean;
  safetyWarning: string;
  extractedBlock: string;
  extractedFloor: string;
  extractedRoom: string;
  recommendedTeam: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  slaHours: number;
}

export interface DuplicateMatch {
  complaint_id: number;
  ticket_code: string;
  category: string;
  status: string;
  priority: string;
  report_count: number;
  description: string;
  block: string;
  floor: string;
  room: string;
  team_name: string | null;
}

export interface NotificationItem {
  notification_id: number;
  user_id: number;
  complaint_id: number | null;
  title: string;
  message: string;
  type: 'info' | 'urgent' | 'resolution_check' | 'duplicate' | 'escalation';
  read_status: number;
  created_at: string;
}

export interface MaintenanceTeam {
  team_id: number;
  team_name: string;
  specialization: string;
  contact_email: string;
}

export interface TechnicianRow {
  technician_id: number;
  user_id: number;
  team_id: number;
  availability: 'Available' | 'Busy' | 'Off Duty';
  active_load: number;
  name: string;
  email: string;
  department: string;
  team_name: string;
}

export interface WeeklyAnalytics {
  summary: {
    total: number;
    resolved: number;
    pending: number;
    overdue: number;
    activeHazards: number;
    avgResolutionHours: number;
    resolutionRate: number;
  };
  byCategory: Array<{ name: string; count: number }>;
  byBlock: Array<{ block: string; total: number; resolved: number; open: number }>;
  teamPerformance: Array<{
    team: string;
    assigned: number;
    resolved: number;
    avg_hours: number | null;
    avg_rating: number | null;
  }>;
  dailyTrend: Array<{ date: string; submitted: number; resolved: number }>;
}

export interface PredictiveItem {
  block: string;
  floor: string;
  room: string;
  category: string;
  occurrences: number;
  last_reported: string;
  riskLevel: 'High' | 'Moderate';
  recommendation: string;
}
