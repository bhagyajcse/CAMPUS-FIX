import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'campusfix.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student', 'faculty', 'technician', 'admin')),
      department TEXT DEFAULT 'General',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS locations (
      location_id INTEGER PRIMARY KEY AUTOINCREMENT,
      block TEXT NOT NULL,
      floor TEXT NOT NULL,
      room TEXT NOT NULL,
      qr_code_slug TEXT NOT NULL UNIQUE,
      facility_type TEXT NOT NULL DEFAULT 'Classroom',
      UNIQUE(block, floor, room)
    );

    CREATE TABLE IF NOT EXISTS maintenance_teams (
      team_id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_name TEXT NOT NULL UNIQUE,
      specialization TEXT NOT NULL,
      contact_email TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS technicians (
      technician_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES maintenance_teams(team_id) ON DELETE CASCADE,
      availability TEXT NOT NULL DEFAULT 'Available' CHECK (availability IN ('Available', 'Busy', 'Off Duty')),
      active_load INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS complaints (
      complaint_id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_code TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(user_id),
      location_id INTEGER NOT NULL REFERENCES locations(location_id),
      image_path TEXT,
      after_image_path TEXT,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      ai_fault_description TEXT,
      ai_confidence REAL DEFAULT 0,
      ai_severity TEXT,
      ai_safety_warning TEXT,
      priority TEXT NOT NULL CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
      status TEXT NOT NULL CHECK (status IN ('Submitted', 'Assigned', 'In Progress', 'Resolved', 'Closed', 'Reopened')),
      report_count INTEGER NOT NULL DEFAULT 1,
      is_electrical_hazard INTEGER NOT NULL DEFAULT 0,
      before_after_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS complaint_reporters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(user_id),
      note TEXT,
      reported_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(complaint_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS assignments (
      assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES maintenance_teams(team_id),
      technician_id INTEGER REFERENCES technicians(technician_id),
      assigned_by TEXT NOT NULL DEFAULT 'AI Agent',
      assignment_status TEXT NOT NULL DEFAULT 'Pending' CHECK (assignment_status IN ('Pending', 'Accepted', 'Rejected')),
      rejection_reason TEXT,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS complaint_updates (
      update_id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
      actor_user_id INTEGER REFERENCES users(user_id),
      actor_name TEXT NOT NULL,
      status TEXT NOT NULL,
      remarks TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deadlines (
      deadline_id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL UNIQUE REFERENCES complaints(complaint_id) ON DELETE CASCADE,
      due_date TEXT NOT NULL,
      escalation_status TEXT NOT NULL DEFAULT 'On Track' CHECK (escalation_status IN ('On Track', 'Approaching', 'Overdue', 'Escalated')),
      escalated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback (
      feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL REFERENCES complaints(complaint_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(user_id),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comments TEXT,
      confirmed_fixed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      complaint_id INTEGER REFERENCES complaints(complaint_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'urgent', 'resolution_check', 'duplicate', 'escalation')),
      read_status INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount === 0) {
    seedDatabase();
  }
}

function hoursOffsetIso(hoursOffset: number): string {
  return new Date(Date.now() + hoursOffset * 3600 * 1000).toISOString();
}

function seedDatabase(): void {
  const passStudent = bcrypt.hashSync('Campus@123', 10);
  const passAdmin = bcrypt.hashSync('Admin@123', 10);

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, department) VALUES (?, ?, ?, ?, ?)'
  );

  const student1 = Number(insertUser.run('Aarav Sharma', 'aarav.sharma@campus.edu', passStudent, 'student', 'B.Tech CSE').lastInsertRowid);
  const student2 = Number(insertUser.run('Priya Menon', 'priya.menon@campus.edu', passStudent, 'student', 'B.Tech ECE').lastInsertRowid);
  const faculty1 = Number(insertUser.run('Dr. Meera Nair', 'dr.meera@campus.edu', passStudent, 'faculty', 'Electronics & Comm.').lastInsertRowid);

  const techElecUser = Number(insertUser.run('Ravi Kumar', 'ravi.elec@campus.edu', passStudent, 'technician', 'Electrical Maintenance').lastInsertRowid);
  const techPlumbUser = Number(insertUser.run('Suresh Patel', 'suresh.plumb@campus.edu', passStudent, 'technician', 'Plumbing & Water').lastInsertRowid);
  const techAvUser = Number(insertUser.run('Ananya Verma', 'ananya.av@campus.edu', passStudent, 'technician', 'IT & AV Support').lastInsertRowid);
  const techNetUser = Number(insertUser.run('Vikram Rao', 'vikram.net@campus.edu', passStudent, 'technician', 'Campus Network Ops').lastInsertRowid);
  const techCivilUser = Number(insertUser.run('Kiran Das', 'kiran.civil@campus.edu', passStudent, 'technician', 'Civil & Furniture').lastInsertRowid);

  const adminUser = Number(insertUser.run('Rajesh Kulkarni', 'admin@campus.edu', passAdmin, 'admin', 'Facility Operations').lastInsertRowid);

  const insertTeam = db.prepare(
    'INSERT INTO maintenance_teams (team_name, specialization, contact_email) VALUES (?, ?, ?)'
  );
  const teamElec = Number(insertTeam.run('Electrical team', 'Electrical / Fan issue, Electrical hazard', 'electrical@campus.edu').lastInsertRowid);
  const teamPlumb = Number(insertTeam.run('Plumbing team', 'Plumbing issue', 'plumbing@campus.edu').lastInsertRowid);
  const teamAv = Number(insertTeam.run('IT / AV support', 'Projector issue', 'av-support@campus.edu').lastInsertRowid);
  const teamNet = Number(insertTeam.run('Network team', 'Network issue', 'network@campus.edu').lastInsertRowid);
  const teamCivil = Number(insertTeam.run('Civil / Furniture team', 'Furniture issue, Other facility issue', 'civil@campus.edu').lastInsertRowid);

  const insertTech = db.prepare(
    'INSERT INTO technicians (user_id, team_id, availability, active_load) VALUES (?, ?, ?, ?)'
  );
  const techElec = Number(insertTech.run(techElecUser, teamElec, 'Available', 2).lastInsertRowid);
  const techPlumb = Number(insertTech.run(techPlumbUser, teamPlumb, 'Available', 1).lastInsertRowid);
  const techAv = Number(insertTech.run(techAvUser, teamAv, 'Available', 1).lastInsertRowid);
  const techNet = Number(insertTech.run(techNetUser, teamNet, 'Available', 1).lastInsertRowid);
  const techCivil = Number(insertTech.run(techCivilUser, teamCivil, 'Available', 0).lastInsertRowid);

  const insertLoc = db.prepare(
    'INSERT INTO locations (block, floor, room, qr_code_slug, facility_type) VALUES (?, ?, ?, ?, ?)'
  );
  const locA204 = Number(insertLoc.run('Block A', '2nd Floor', '204', 'CF-BLKA-2-204', 'Lecture Hall').lastInsertRowid);
  const locA102 = Number(insertLoc.run('Block A', '1st Floor', '102', 'CF-BLKA-1-102', 'Classroom').lastInsertRowid);
  const locA2WR = Number(insertLoc.run('Block A', '2nd Floor', 'Washroom East', 'CF-BLKA-2-WR', 'Restroom').lastInsertRowid);
  const locB105 = Number(insertLoc.run('Block B', '1st Floor', '105', 'CF-BLKB-1-105', 'Seminar Room').lastInsertRowid);
  const locB301 = Number(insertLoc.run('Block B', '3rd Floor', '301', 'CF-BLKB-3-301', 'Computer Lab').lastInsertRowid);
  const locC101 = Number(insertLoc.run('Block C', 'Ground Floor', '101', 'CF-BLKC-G-101', 'Auditorium').lastInsertRowid);
  const locLib2 = Number(insertLoc.run('Library', '2nd Floor', 'Reading Hall B', 'CF-LIB-2-RHB', 'Library Zone').lastInsertRowid);
  const locLab302 = Number(insertLoc.run('Lab Complex', '3rd Floor', '302', 'CF-LAB-3-302', 'Electronics Lab').lastInsertRowid);
  const locHostel = Number(insertLoc.run('Hostel North', '1st Floor', 'Corridor 1B', 'CF-HSTN-1-1B', 'Residential Corridor').lastInsertRowid);

  const insertComplaint = db.prepare(`
    INSERT INTO complaints (
      ticket_code, user_id, location_id, image_path, after_image_path, description,
      category, ai_fault_description, ai_confidence, ai_severity, ai_safety_warning,
      priority, status, report_count, is_electrical_hazard, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertReporter = db.prepare(
    'INSERT INTO complaint_reporters (complaint_id, user_id, note, reported_at) VALUES (?, ?, ?, ?)'
  );
  const insertAssign = db.prepare(
    'INSERT INTO assignments (complaint_id, team_id, technician_id, assigned_by, assignment_status, assigned_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertUpdate = db.prepare(
    'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertDeadline = db.prepare(
    'INSERT INTO deadlines (complaint_id, due_date, escalation_status, escalated_at) VALUES (?, ?, ?, ?)'
  );
  const insertFeedback = db.prepare(
    'INSERT INTO feedback (complaint_id, user_id, rating, comments, confirmed_fixed, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertNotif = db.prepare(
    'INSERT INTO notifications (user_id, complaint_id, title, message, type, read_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  // 1. Active Critical Electrical Hazard (Assigned, approaching/overdue demo)
  const c1 = Number(insertComplaint.run(
    'CF-2026-101', student2, locLab302, null, null,
    'Exposed copper wires protruding from cracked wall conduit next to Lab 302 main switchboard.',
    'Electrical hazard',
    'Exposed live wiring inside damaged PVC junction box near high-traffic laboratory entrance.',
    96, 'Critical', 'DANGER: Do not touch exposed conductors. Isolate Lab 302 MCB circuit before inspection.',
    'Critical', 'Assigned', 2, 1, hoursOffsetIso(-1.4), hoursOffsetIso(-1.2), null
  ).lastInsertRowid);
  insertReporter.run(c1, student2, 'Exposed copper wires protruding from cracked wall conduit next to Lab 302 main switchboard.', hoursOffsetIso(-1.4));
  insertReporter.run(c1, faculty1, 'Students noticed sparking smell near Lab 302 switch.', hoursOffsetIso(-1.1));
  insertAssign.run(c1, teamElec, techElec, 'AI Agent', 'Pending', hoursOffsetIso(-1.4));
  insertUpdate.run(c1, student2, 'Priya Menon', 'Submitted', 'Submitted complaint with photo evidence.', hoursOffsetIso(-1.4));
  insertUpdate.run(c1, null, 'CampusFix AI Agent', 'Assigned', 'Classified as Electrical hazard (96% confidence). Escalated to Critical SLA (1 hr) and routed to Electrical team.', hoursOffsetIso(-1.4));
  insertDeadline.run(c1, hoursOffsetIso(-0.4), 'Overdue', null);
  insertNotif.run(techElecUser, c1, 'CRITICAL: Electrical Hazard in Lab Complex 302', 'Immediate action required: exposed wiring detected. SLA overdue.', 'urgent', 0, hoursOffsetIso(-1.3));
  insertNotif.run(adminUser, c1, 'Overdue Critical Electrical Hazard (CF-2026-101)', 'Lab Complex, 3rd Floor, 302 has exceeded its 1-hour Critical SLA.', 'escalation', 0, hoursOffsetIso(-0.3));

  // 2. Active Resolved complaint awaiting Student confirmation!
  const c2 = Number(insertComplaint.run(
    'CF-2026-102', student1, locA204, null, null,
    'The ceiling projector in Block A Room 204 is not turning on and shows a blinking red lamp LED.',
    'Projector issue',
    'Classroom projector power/lamp fault indicated by red status LED and unresponsive HDMI feed.',
    93, 'Medium', '',
    'Medium', 'Resolved', 2, 0, hoursOffsetIso(-18), hoursOffsetIso(-2), hoursOffsetIso(-2)
  ).lastInsertRowid);
  insertReporter.run(c2, student1, 'Projector in Room 204 not turning on before CS lecture.', hoursOffsetIso(-18));
  insertReporter.run(c2, faculty1, 'Confirmed HDMI and projector power unresponsive in A-204.', hoursOffsetIso(-16));
  insertAssign.run(c2, teamAv, techAv, 'AI Agent', 'Accepted', hoursOffsetIso(-17.5));
  insertUpdate.run(c2, student1, 'Aarav Sharma', 'Submitted', 'Reported non-functional projector in Block A, Room 204.', hoursOffsetIso(-18));
  insertUpdate.run(c2, techAvUser, 'Ananya Verma', 'In Progress', 'Replaced faulty lamp ballast and tested HDMI wall plate.', hoursOffsetIso(-4));
  insertUpdate.run(c2, techAvUser, 'Ananya Verma', 'Resolved', 'Projector powers on cleanly and projects at full brightness. Awaiting reporter verification.', hoursOffsetIso(-2));
  insertDeadline.run(c2, hoursOffsetIso(6), 'On Track', null);
  insertNotif.run(student1, c2, 'Confirm Repair: Projector issue in Block A 204', 'Ananya Verma marked CF-2026-102 as Resolved. Please confirm if the projector works.', 'resolution_check', 0, hoursOffsetIso(-2));
  insertNotif.run(faculty1, c2, 'Confirm Repair: Projector issue in Block A 204', 'Ticket CF-2026-102 has been repaired. Please verify resolution.', 'resolution_check', 0, hoursOffsetIso(-2));

  // 3. Active In Progress Plumbing issue
  const c3 = Number(insertComplaint.run(
    'CF-2026-103', student2, locA2WR, null, null,
    'Water tap in Block A 2nd floor east washroom is leaking continuously even when closed tight.',
    'Plumbing issue',
    'Washbasin compression tap spindle leaking steady water stream onto floor.',
    91, 'High', '',
    'High', 'In Progress', 1, 0, hoursOffsetIso(-3.2), hoursOffsetIso(-1.5), null
  ).lastInsertRowid);
  insertReporter.run(c3, student2, 'Tap leaking continuously in 2nd floor washroom.', hoursOffsetIso(-3.2));
  insertAssign.run(c3, teamPlumb, techPlumb, 'AI Agent', 'Accepted', hoursOffsetIso(-3.0));
  insertUpdate.run(c3, student2, 'Priya Menon', 'Submitted', 'Reported leaking sink tap.', hoursOffsetIso(-3.2));
  insertUpdate.run(c3, techPlumbUser, 'Suresh Patel', 'In Progress', 'Shut off angle valve; replacing worn ceramic cartridge.', hoursOffsetIso(-1.5));
  insertDeadline.run(c3, hoursOffsetIso(0.8), 'Approaching', null);

  // 4. Open Fan issue in Block A Room 204 (great for Duplicate Detection test!)
  const c4 = Number(insertComplaint.run(
    'CF-2026-104', student1, locA204, null, null,
    'The front-right ceiling fan in Block A Room 204 is wobbling and not spinning at full speed.',
    'Electrical / Fan issue',
    'Classroom ceiling fan motor capacitor degradation causing slow speed and blade wobble.',
    89, 'Medium', '',
    'Medium', 'Assigned', 1, 0, hoursOffsetIso(-5), hoursOffsetIso(-4.8), null
  ).lastInsertRowid);
  insertReporter.run(c4, student1, 'Front-right fan wobbling in Room 204.', hoursOffsetIso(-5));
  insertAssign.run(c4, teamElec, techElec, 'AI Agent', 'Accepted', hoursOffsetIso(-4.8));
  insertUpdate.run(c4, student1, 'Aarav Sharma', 'Submitted', 'Reported wobbling ceiling fan in Block A Room 204.', hoursOffsetIso(-5));
  insertDeadline.run(c4, hoursOffsetIso(19), 'On Track', null);

  // 5. Open Network issue in Library
  const c5 = Number(insertComplaint.run(
    'CF-2026-105', faculty1, locLib2, null, null,
    'Campus Wi-Fi access point in Library 2nd floor Reading Hall B shows a red light and drops connections.',
    'Network issue',
    'Enterprise access point uplink fault or PoE switch port drop indicated by red fault LED.',
    94, 'High', '',
    'High', 'Assigned', 3, 0, hoursOffsetIso(-2.5), hoursOffsetIso(-2.5), null
  ).lastInsertRowid);
  insertReporter.run(c5, faculty1, 'Wi-Fi dropping in Reading Hall B.', hoursOffsetIso(-2.5));
  insertReporter.run(c5, student1, 'Cannot connect laptop to EduNet in Library 2nd floor.', hoursOffsetIso(-2.0));
  insertReporter.run(c5, student2, 'Same Wi-Fi outage in Reading Hall B.', hoursOffsetIso(-1.0));
  insertAssign.run(c5, teamNet, techNet, 'AI Agent', 'Pending', hoursOffsetIso(-2.5));
  insertUpdate.run(c5, faculty1, 'Dr. Meera Nair', 'Submitted', 'Reported red fault LED on Reading Hall B Wi-Fi AP.', hoursOffsetIso(-2.5));
  insertDeadline.run(c5, hoursOffsetIso(1.5), 'Approaching', null);

  // 6-10. Closed historical complaints across past 6 days (for Weekly Report & Predictive Maintenance)
  const historical = [
    {
      code: 'CF-2026-091', user: student1, loc: locA204,
      desc: 'Ceiling fan near podium in Block A Room 204 stopped spinning during afternoon class.',
      cat: 'Electrical / Fan issue', prio: 'Medium', team: teamElec, tech: techElec, techUser: techElecUser, techName: 'Ravi Kumar',
      createdH: -130, resolvedH: -122, rating: 5, comment: 'Capacitor replaced quickly.'
    },
    {
      code: 'CF-2026-092', user: faculty1, loc: locA204,
      desc: 'Ceiling fan regulator burning smell and tripping in Block A Room 204.',
      cat: 'Electrical / Fan issue', prio: 'High', team: teamElec, tech: techElec, techUser: techElecUser, techName: 'Ravi Kumar',
      createdH: -96, resolvedH: -93, rating: 5, comment: 'Fixed regulator before evening lecture.'
    },
    {
      code: 'CF-2026-093', user: student2, loc: locB105,
      desc: 'Two student desk hinges broken and chair backrest loose in Block B Room 105.',
      cat: 'Furniture issue', prio: 'Low', team: teamCivil, tech: techCivil, techUser: techCivilUser, techName: 'Kiran Das',
      createdH: -84, resolvedH: -64, rating: 4, comment: 'Sturdy replacement bolts fitted.'
    },
    {
      code: 'CF-2026-094', user: faculty1, loc: locC101,
      desc: 'Main auditorium projector color wheel flickering purple during seminar.',
      cat: 'Projector issue', prio: 'Medium', team: teamAv, tech: techAv, techUser: techAvUser, techName: 'Ananya Verma',
      createdH: -70, resolvedH: -61, rating: 5, comment: 'Cleaned optics and updated firmware.'
    },
    {
      code: 'CF-2026-095', user: student1, loc: locHostel,
      desc: 'Drinking water cooler outlet pipe leaking in Hostel North Corridor 1B.',
      cat: 'Plumbing issue', prio: 'High', team: teamPlumb, tech: techPlumb, techUser: techPlumbUser, techName: 'Suresh Patel',
      createdH: -50, resolvedH: -47, rating: 5, comment: 'Joint resealed cleanly.'
    },
    {
      code: 'CF-2026-096', user: student2, loc: locB301,
      desc: 'Ethernet wall jack row 4 disconnected in Block B Lab 301.',
      cat: 'Network issue', prio: 'Medium', team: teamNet, tech: techNet, techUser: techNetUser, techName: 'Vikram Rao',
      createdH: -36, resolvedH: -30, rating: 4, comment: 'Keystone jack re-terminated.'
    },
    {
      code: 'CF-2026-097', user: student1, loc: locA102,
      desc: 'Broken bench plank in Block A Room 102.',
      cat: 'Furniture issue', prio: 'Low', team: teamCivil, tech: techCivil, techUser: techCivilUser, techName: 'Kiran Das',
      createdH: -28, resolvedH: -15, rating: 5, comment: 'Replaced wooden plank.'
    }
  ];

  for (const h of historical) {
    const cid = Number(insertComplaint.run(
      h.code, h.user, h.loc, null, null, h.desc,
      h.cat, h.desc, 92, h.prio, '',
      h.prio, 'Closed', 1, 0, hoursOffsetIso(h.createdH), hoursOffsetIso(h.resolvedH), hoursOffsetIso(h.resolvedH)
    ).lastInsertRowid);
    insertReporter.run(cid, h.user, h.desc, hoursOffsetIso(h.createdH));
    insertAssign.run(cid, h.team, h.tech, 'AI Agent', 'Accepted', hoursOffsetIso(h.createdH + 0.2));
    insertUpdate.run(cid, h.user, 'Campus Reporter', 'Submitted', 'Complaint submitted.', hoursOffsetIso(h.createdH));
    insertUpdate.run(cid, h.techUser, h.techName, 'Resolved', 'Repair completed and tested.', hoursOffsetIso(h.resolvedH));
    insertUpdate.run(cid, h.user, 'Campus Reporter', 'Closed', `Verified resolution: ${h.comment}`, hoursOffsetIso(h.resolvedH + 0.5));
    insertDeadline.run(cid, hoursOffsetIso(h.createdH + 24), 'On Track', null);
    insertFeedback.run(cid, h.user, h.rating, h.comment, 1, hoursOffsetIso(h.resolvedH + 0.5));
  }
}

export function refreshOverdueDeadlines(): void {
  const nowIso = new Date().toISOString();
  // Mark open complaints whose due_date < now as Overdue (unless already Escalated)
  db.prepare(`
    UPDATE deadlines
    SET escalation_status = 'Overdue'
    WHERE escalation_status IN ('On Track', 'Approaching')
      AND due_date < ?
      AND complaint_id IN (
        SELECT complaint_id FROM complaints WHERE status NOT IN ('Resolved', 'Closed')
      )
  `).run(nowIso);

  // Mark Approaching if within 25% or 1 hour of deadline
  const oneHourFromNow = new Date(Date.now() + 3600 * 1000).toISOString();
  db.prepare(`
    UPDATE deadlines
    SET escalation_status = 'Approaching'
    WHERE escalation_status = 'On Track'
      AND due_date >= ?
      AND due_date <= ?
      AND complaint_id IN (
        SELECT complaint_id FROM complaints WHERE status NOT IN ('Resolved', 'Closed')
      )
  `).run(nowIso, oneHourFromNow);
}
