import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { db, initDatabase, refreshOverdueDeadlines } from './server/db.ts';
import { signToken, requireAuth, requireRole, type AuthenticatedRequest } from './server/auth.ts';
import {
  analyzeFacilityComplaint,
  verifyBeforeAfterRepair,
  runCampusAssistant,
  mapCategoryToTeam,
} from './server/gemini.ts';

initDatabase();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(uploadsDir));

function normalizeFloor(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const low = s.toLowerCase();
  if (low === 'g' || low === '0' || low.includes('ground')) return 'Ground Floor';
  if (low === '1' || low === '1st' || low === 'first') return '1st Floor';
  if (low === '2' || low === '2nd' || low === 'second') return '2nd Floor';
  if (low === '3' || low === '3rd' || low === 'third') return '3rd Floor';
  if (/^\d+$/.test(low)) return `${low}th Floor`;
  return s;
}

function normalizeBlock(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^[a-z]$/i.test(s)) return `Block ${s.toUpperCase()}`;
  return s;
}

function saveDataUrlToDisk(dataUrl: string, prefix: string): string | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const fullPath = path.join(uploadsDir, filename);
  fs.writeFileSync(fullPath, Buffer.from(base64, 'base64'));
  return `/uploads/${filename}`;
}

function extractBase64FromDataUrl(dataUrl: string): { base64: string; mimeType: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function findOrCreateLocation(blockRaw: string, floorRaw: string, roomRaw: string): number {
  const block = normalizeBlock(blockRaw);
  const floor = normalizeFloor(floorRaw);
  const room = roomRaw.trim();

  const existing = db
    .prepare(
      `SELECT location_id FROM locations
       WHERE LOWER(TRIM(block)) = LOWER(?)
         AND LOWER(TRIM(floor)) = LOWER(?)
         AND LOWER(TRIM(room)) = LOWER(?)`
    )
    .get(block, floor, room) as { location_id: number } | undefined;

  if (existing) return existing.location_id;

  const slug = `CF-${block.replace(/[^A-Z0-9]/gi, '').slice(0, 5).toUpperCase()}-${floor
    .replace(/[^A-Z0-9]/gi, '')
    .slice(0, 2)
    .toUpperCase()}-${room.replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase()}-${Math.floor(10 + Math.random() * 89)}`;

  const res = db
    .prepare('INSERT INTO locations (block, floor, room, qr_code_slug, facility_type) VALUES (?, ?, ?, ?, ?)')
    .run(block, floor, room, slug, 'Campus Facility');
  return Number(res.lastInsertRowid);
}

function findOpenDuplicate(blockRaw: string, floorRaw: string, roomRaw: string, category: string) {
  const block = normalizeBlock(blockRaw);
  const floor = normalizeFloor(floorRaw);
  const room = roomRaw.trim();

  if (!block || !floor || !room) return null;

  return db
    .prepare(
      `SELECT c.complaint_id, c.ticket_code, c.category, c.status, c.priority, c.report_count, c.description,
              l.block, l.floor, l.room, mt.team_name
       FROM complaints c
       JOIN locations l ON c.location_id = l.location_id
       LEFT JOIN assignments a ON c.complaint_id = a.complaint_id
       LEFT JOIN maintenance_teams mt ON a.team_id = mt.team_id
       WHERE LOWER(TRIM(l.block)) = LOWER(?)
         AND LOWER(TRIM(l.floor)) = LOWER(?)
         AND LOWER(TRIM(l.room)) = LOWER(?)
         AND c.category = ?
         AND c.status NOT IN ('Closed')
       ORDER BY c.created_at DESC
       LIMIT 1`
    )
    .get(block, floor, room, category) as
    | {
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
    | undefined;
}

// ---------- AUTH ROUTES ----------
app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, password, role, department, teamId } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
      department?: string;
      teamId?: number;
    };

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required.' });
      return;
    }

    const allowedRole =
      role === 'faculty' || role === 'technician' || role === 'admin' || role === 'student'
        ? role
        : 'student';

    const existing = db.prepare('SELECT user_id FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim());
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    const insertRes = db
      .prepare('INSERT INTO users (name, email, password_hash, role, department) VALUES (?, ?, ?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), hash, allowedRole, (department || 'General').trim());

    const userId = Number(insertRes.lastInsertRowid);

    if (allowedRole === 'technician') {
      const fallbackTeam = db.prepare('SELECT team_id FROM maintenance_teams ORDER BY team_id LIMIT 1').get() as {
        team_id: number;
      };
      const assignedTeam = teamId || fallbackTeam.team_id;
      db.prepare('INSERT INTO technicians (user_id, team_id, availability, active_load) VALUES (?, ?, ?, ?)').run(
        userId,
        assignedTeam,
        'Available',
        0
      );
    }

    const authUser = {
      user_id: userId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: allowedRole as 'student' | 'faculty' | 'technician' | 'admin',
      department: (department || 'General').trim(),
    };
    const token = signToken(authUser);
    res.status(201).json({ token, user: authUser });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const row = db
      .prepare('SELECT user_id, name, email, password_hash, role, department FROM users WHERE LOWER(email) = LOWER(?)')
      .get(email.trim()) as
      | {
          user_id: number;
          name: string;
          email: string;
          password_hash: string;
          role: 'student' | 'faculty' | 'technician' | 'admin';
          department: string;
        }
      | undefined;

    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const authUser = {
      user_id: row.user_id,
      name: row.name,
      email: row.email,
      role: row.role,
      department: row.department,
    };
    const token = signToken(authUser);
    res.json({ token, user: authUser });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Login failed' });
  }
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  let technicianInfo = null;
  if (user.role === 'technician') {
    technicianInfo = db
      .prepare(
        `SELECT t.technician_id, t.team_id, t.availability, t.active_load, mt.team_name
         FROM technicians t
         JOIN maintenance_teams mt ON t.team_id = mt.team_id
         WHERE t.user_id = ?`
      )
      .get(user.user_id);
  }
  res.json({ user, technicianInfo });
});

app.get('/api/auth/teams', (_req, res) => {
  const teams = db.prepare('SELECT team_id, team_name, specialization FROM maintenance_teams ORDER BY team_id').all();
  res.json({ teams });
});

// ---------- LOCATIONS & QR ----------
app.get('/api/locations', requireAuth, (_req, res) => {
  const locations = db.prepare('SELECT * FROM locations ORDER BY block, floor, room').all();
  res.json({ locations });
});

app.get('/api/locations/qr/:slug', requireAuth, (req, res) => {
  const loc = db.prepare('SELECT * FROM locations WHERE qr_code_slug = ?').get(req.params.slug);
  if (!loc) {
    res.status(404).json({ error: 'QR location code not recognized.' });
    return;
  }
  res.json({ location: loc });
});

// ---------- AI AGENT ROUTES ----------
app.post('/api/agent/analyze', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { imageDataUrl, description, block, floor, room } = req.body as {
      imageDataUrl?: string;
      description?: string;
      block?: string;
      floor?: string;
      room?: string;
    };

    if (!imageDataUrl && !description?.trim()) {
      res.status(400).json({ error: 'Please upload an image or enter a fault description for AI analysis.' });
      return;
    }

    let imageBase64: string | undefined;
    let mimeType: string | undefined;
    if (imageDataUrl) {
      const parsed = extractBase64FromDataUrl(imageDataUrl);
      if (parsed) {
        imageBase64 = parsed.base64;
        mimeType = parsed.mimeType;
      }
    }

    const analysis = await analyzeFacilityComplaint({
      imageBase64,
      mimeType,
      description: description || '',
      block,
      floor,
      room,
    });

    const resolvedBlock = analysis.extractedBlock || (block ? normalizeBlock(block) : '');
    const resolvedFloor = analysis.extractedFloor || (floor ? normalizeFloor(floor) : '');
    const resolvedRoom = analysis.extractedRoom || (room ? room.trim() : '');

    const missingLocationFields: string[] = [];
    if (!resolvedBlock) missingLocationFields.push('block');
    if (!resolvedFloor) missingLocationFields.push('floor');
    if (!resolvedRoom) missingLocationFields.push('room');

    const locationPrompt =
      missingLocationFields.length > 0
        ? 'Could you please specify the block, floor, and room number where the issue occurred?'
        : '';

    const duplicateMatch =
      missingLocationFields.length === 0
        ? findOpenDuplicate(resolvedBlock, resolvedFloor, resolvedRoom, analysis.faultCategory)
        : null;

    res.json({
      analysis: {
        ...analysis,
        extractedBlock: resolvedBlock,
        extractedFloor: resolvedFloor,
        extractedRoom: resolvedRoom,
      },
      missingLocationFields,
      locationPrompt,
      duplicateMatch: duplicateMatch || null,
    });
  } catch (err) {
    console.error('AI analyze error:', err);
    res.status(502).json({
      error: err instanceof Error ? err.message : 'AI vision analysis failed. Verify GEMINI_API_KEY in Settings > Secrets.',
    });
  }
});

app.post('/api/agent/assistant', requireAuth, async (req, res) => {
  try {
    const { history } = req.body as {
      history?: Array<{ role: 'user' | 'assistant'; text: string }>;
    };
    if (!history || history.length === 0) {
      res.status(400).json({ error: 'Message history is required.' });
      return;
    }
    const knownLocations = db.prepare('SELECT block, floor, room FROM locations').all() as Array<{
      block: string;
      floor: string;
      room: string;
    }>;
    const result = await runCampusAssistant({ history, knownLocations });
    res.json(result);
  } catch (err) {
    console.error('Assistant error:', err);
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Campus Assistant unavailable.',
    });
  }
});

// ---------- COMPLAINTS ROUTES ----------
app.get('/api/complaints', requireAuth, (req: AuthenticatedRequest, res) => {
  refreshOverdueDeadlines();

  const user = req.user!;
  const { scope, status, priority, block, category, search } = req.query as Record<string, string | undefined>;

  let sql = `
    SELECT c.*,
           l.block, l.floor, l.room, l.qr_code_slug, l.facility_type,
           u.name AS reporter_name, u.email AS reporter_email, u.role AS reporter_role,
           a.assignment_id, a.team_id, a.technician_id, a.assignment_status, a.rejection_reason, a.assigned_by,
           mt.team_name,
           tu.name AS technician_name,
           d.due_date, d.escalation_status, d.escalated_at,
           (SELECT rating FROM feedback f WHERE f.complaint_id = c.complaint_id ORDER BY f.created_at DESC LIMIT 1) AS feedback_rating
    FROM complaints c
    JOIN locations l ON c.location_id = l.location_id
    JOIN users u ON c.user_id = u.user_id
    LEFT JOIN assignments a ON c.complaint_id = a.complaint_id
    LEFT JOIN maintenance_teams mt ON a.team_id = mt.team_id
    LEFT JOIN technicians t ON a.technician_id = t.technician_id
    LEFT JOIN users tu ON t.user_id = tu.user_id
    LEFT JOIN deadlines d ON c.complaint_id = d.complaint_id
    WHERE 1=1
  `;
  const params: Array<string | number> = [];

  if (scope === 'mine' || user.role === 'student' || user.role === 'faculty') {
    if (user.role === 'student' || user.role === 'faculty' || scope === 'mine') {
      sql += ` AND (c.user_id = ? OR EXISTS (SELECT 1 FROM complaint_reporters cr WHERE cr.complaint_id = c.complaint_id AND cr.user_id = ?))`;
      params.push(user.user_id, user.user_id);
    }
  } else if (user.role === 'technician') {
    const tech = db.prepare('SELECT technician_id, team_id FROM technicians WHERE user_id = ?').get(user.user_id) as
      | { technician_id: number; team_id: number }
      | undefined;
    if (tech) {
      sql += ` AND (a.technician_id = ? OR a.team_id = ?)`;
      params.push(tech.technician_id, tech.team_id);
    }
  }

  if (status && status !== 'All') {
    sql += ` AND c.status = ?`;
    params.push(status);
  }
  if (priority && priority !== 'All') {
    sql += ` AND c.priority = ?`;
    params.push(priority);
  }
  if (block && block !== 'All') {
    sql += ` AND l.block = ?`;
    params.push(block);
  }
  if (category && category !== 'All') {
    sql += ` AND c.category = ?`;
    params.push(category);
  }
  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    sql += ` AND (c.ticket_code LIKE ? OR c.description LIKE ? OR c.category LIKE ? OR l.block LIKE ? OR l.room LIKE ?)`;
    params.push(like, like, like, like, like);
  }

  sql += ` ORDER BY
    CASE c.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
    c.created_at DESC`;

  const complaints = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  if (user.role === 'student') {
    for (const c of complaints) {
      c.assignment_id = null;
      c.team_id = null;
      c.technician_id = null;
      c.assignment_status = null;
      c.rejection_reason = null;
      c.assigned_by = null;
      c.team_name = null;
      c.technician_name = null;
    }
  }
  res.json({ complaints });
});

app.get('/api/complaints/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  refreshOverdueDeadlines();
  const id = Number(req.params.id);
  const user = req.user!;
  const complaint = db
    .prepare(
      `SELECT c.*,
              l.block, l.floor, l.room, l.qr_code_slug, l.facility_type,
              u.name AS reporter_name, u.email AS reporter_email, u.role AS reporter_role,
              a.assignment_id, a.team_id, a.technician_id, a.assignment_status, a.rejection_reason, a.assigned_by,
              mt.team_name,
              tu.name AS technician_name,
              d.due_date, d.escalation_status, d.escalated_at
       FROM complaints c
       JOIN locations l ON c.location_id = l.location_id
       JOIN users u ON c.user_id = u.user_id
       LEFT JOIN assignments a ON c.complaint_id = a.complaint_id
       LEFT JOIN maintenance_teams mt ON a.team_id = mt.team_id
       LEFT JOIN technicians t ON a.technician_id = t.technician_id
       LEFT JOIN users tu ON t.user_id = tu.user_id
       LEFT JOIN deadlines d ON c.complaint_id = d.complaint_id
       WHERE c.complaint_id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!complaint) {
    res.status(404).json({ error: 'Complaint not found.' });
    return;
  }

  if (user.role === 'student' || user.role === 'faculty') {
    const linked = db
      .prepare('SELECT id FROM complaint_reporters WHERE complaint_id = ? AND user_id = ?')
      .get(id, user.user_id);
    if (complaint.user_id !== user.user_id && !linked) {
      res.status(403).json({ error: 'You do not have permission to inspect this complaint.' });
      return;
    }
  }

  if (user.role === 'student') {
    complaint.assignment_id = null;
    complaint.team_id = null;
    complaint.technician_id = null;
    complaint.assignment_status = null;
    complaint.rejection_reason = null;
    complaint.assigned_by = null;
    complaint.team_name = null;
    complaint.technician_name = null;
  }

  const updates = db
    .prepare('SELECT * FROM complaint_updates WHERE complaint_id = ? ORDER BY timestamp ASC')
    .all(id);
  const reporters =
    user.role === 'student'
      ? []
      : db
          .prepare(
            `SELECT cr.*, u.name, u.email, u.role
             FROM complaint_reporters cr
             JOIN users u ON cr.user_id = u.user_id
             WHERE cr.complaint_id = ?
             ORDER BY cr.reported_at ASC`
          )
          .all(id);
  const feedback = db
    .prepare(
      `SELECT f.*, u.name
       FROM feedback f
       JOIN users u ON f.user_id = u.user_id
       WHERE f.complaint_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(id);

  res.json({ complaint, updates, reporters, feedback });
});

app.post('/api/complaints/submit', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const {
      imageDataUrl,
      description,
      block,
      floor,
      room,
      category,
      aiFaultDescription,
      aiConfidence,
      aiSeverity,
      aiSafetyWarning,
      priority,
      slaHours,
      isElectricalHazard,
    } = req.body as {
      imageDataUrl?: string;
      description?: string;
      block?: string;
      floor?: string;
      room?: string;
      category?: string;
      aiFaultDescription?: string;
      aiConfidence?: number;
      aiSeverity?: string;
      aiSafetyWarning?: string;
      priority?: 'Critical' | 'High' | 'Medium' | 'Low';
      slaHours?: number;
      isElectricalHazard?: boolean;
    };

    if (!block?.trim() || !floor?.trim() || !room?.trim()) {
      res.status(400).json({
        error: 'Could you please specify the block, floor, and room number where the issue occurred?',
        missingLocation: true,
      });
      return;
    }

    if (!description?.trim()) {
      res.status(400).json({ error: 'Please provide a brief description of the issue.' });
      return;
    }

    const normCategory = category || 'Other facility issue';
    const existingDuplicate = findOpenDuplicate(block, floor, room, normCategory);

    if (existingDuplicate) {
      // Link reporter instead of creating a duplicate ticket
      const alreadyLinked = db
        .prepare('SELECT id FROM complaint_reporters WHERE complaint_id = ? AND user_id = ?')
        .get(existingDuplicate.complaint_id, user.user_id);

      if (!alreadyLinked) {
        db.prepare('INSERT INTO complaint_reporters (complaint_id, user_id, note) VALUES (?, ?, ?)').run(
          existingDuplicate.complaint_id,
          user.user_id,
          description.trim()
        );
        db.prepare('UPDATE complaints SET report_count = report_count + 1, updated_at = datetime("now") WHERE complaint_id = ?').run(
          existingDuplicate.complaint_id
        );
      }

      db.prepare(
        'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
      ).run(
        existingDuplicate.complaint_id,
        user.user_id,
        user.name,
        existingDuplicate.status,
        `Duplicate report linked from ${user.name}: "${description.trim()}"`
      );

      db.prepare(
        'INSERT INTO notifications (user_id, complaint_id, title, message, type) VALUES (?, ?, ?, ?, ?)'
      ).run(
        user.user_id,
        existingDuplicate.complaint_id,
        `Linked to Existing Request ${existingDuplicate.ticket_code}`,
        `An open "${existingDuplicate.category}" complaint already exists in ${existingDuplicate.block}, ${existingDuplicate.floor}, ${existingDuplicate.room}. You have been linked and will receive resolution updates.`,
        'duplicate'
      );

      res.status(200).json({
        duplicateDetected: true,
        linkedComplaint:
          user.role === 'student'
            ? { ...existingDuplicate, team_name: null }
            : existingDuplicate,
        message:
          user.role === 'student'
            ? `Duplicate prevented: linked to existing open ticket ${existingDuplicate.ticket_code}.`
            : `Duplicate prevented: linked to existing open ticket ${existingDuplicate.ticket_code} (${existingDuplicate.team_name || 'Maintenance'}).`,
      });
      return;
    }

    const locationId = findOrCreateLocation(block, floor, room);
    const savedImagePath = imageDataUrl ? saveDataUrlToDisk(imageDataUrl, 'issue') : null;

    const finalPriority = isElectricalHazard || normCategory === 'Electrical hazard' ? 'Critical' : priority || 'Medium';
    const finalHazard = isElectricalHazard || normCategory === 'Electrical hazard' ? 1 : 0;
    const hours =
      finalPriority === 'Critical' ? 1 : finalPriority === 'High' ? 4 : finalPriority === 'Low' ? 72 : slaHours || 24;

    const countRow = db.prepare('SELECT COUNT(*) as c FROM complaints').get() as { c: number };
    const ticketCode = `CF-2026-${String(106 + countRow.c).padStart(3, '0')}`;

    const insertRes = db
      .prepare(
        `INSERT INTO complaints (
          ticket_code, user_id, location_id, image_path, description,
          category, ai_fault_description, ai_confidence, ai_severity, ai_safety_warning,
          priority, status, report_count, is_electrical_hazard
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Assigned', 1, ?)`
      )
      .run(
        ticketCode,
        user.user_id,
        locationId,
        savedImagePath,
        description.trim(),
        normCategory,
        aiFaultDescription || description.trim(),
        aiConfidence ?? 90,
        aiSeverity || finalPriority,
        aiSafetyWarning || '',
        finalPriority,
        finalHazard
      );

    const complaintId = Number(insertRes.lastInsertRowid);

    db.prepare('INSERT INTO complaint_reporters (complaint_id, user_id, note) VALUES (?, ?, ?)').run(
      complaintId,
      user.user_id,
      description.trim()
    );

    const targetTeamName = mapCategoryToTeam(normCategory);
    const teamRow = db.prepare('SELECT team_id FROM maintenance_teams WHERE team_name = ?').get(targetTeamName) as
      | { team_id: number }
      | undefined;
    const teamId = teamRow ? teamRow.team_id : 1;

    // Pick available technician with lowest workload in that team
    const techRow = db
      .prepare(
        `SELECT t.technician_id, t.user_id, u.name
         FROM technicians t
         JOIN users u ON t.user_id = u.user_id
         WHERE t.team_id = ?
         ORDER BY CASE t.availability WHEN 'Available' THEN 1 WHEN 'Busy' THEN 2 ELSE 3 END, t.active_load ASC
         LIMIT 1`
      )
      .get(teamId) as { technician_id: number; user_id: number; name: string } | undefined;

    db.prepare(
      'INSERT INTO assignments (complaint_id, team_id, technician_id, assigned_by, assignment_status) VALUES (?, ?, ?, ?, ?)'
    ).run(complaintId, teamId, techRow ? techRow.technician_id : null, 'AI Agent', 'Pending');

    if (techRow) {
      db.prepare('UPDATE technicians SET active_load = active_load + 1 WHERE technician_id = ?').run(
        techRow.technician_id
      );
    }

    const dueDate = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    db.prepare('INSERT INTO deadlines (complaint_id, due_date, escalation_status) VALUES (?, ?, ?)').run(
      complaintId,
      dueDate,
      'On Track'
    );

    db.prepare(
      'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
    ).run(complaintId, user.user_id, user.name, 'Submitted', 'Complaint registered with multimodal intake.');

    db.prepare(
      'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
    ).run(
      complaintId,
      null,
      'CampusFix AI Agent',
      'Assigned',
      `Detected ${normCategory} (${aiConfidence ?? 90}% confidence). Priority: ${finalPriority} (${hours}h SLA). Routed to ${targetTeamName}${techRow ? ` (${techRow.name})` : ''}.`
    );

    // Notifications
    if (techRow) {
      db.prepare(
        'INSERT INTO notifications (user_id, complaint_id, title, message, type) VALUES (?, ?, ?, ?, ?)'
      ).run(
        techRow.user_id,
        complaintId,
        finalHazard ? `EMERGENCY HAZARD: ${ticketCode}` : `New Assignment: ${ticketCode}`,
        `${normCategory} at ${normalizeBlock(block)}, ${normalizeFloor(floor)}, ${room.trim()}. Priority: ${finalPriority} (${hours}h SLA).`,
        finalHazard ? 'urgent' : 'info'
      );
    }

    if (finalHazard) {
      const admins = db.prepare("SELECT user_id FROM users WHERE role = 'admin'").all() as Array<{ user_id: number }>;
      for (const adm of admins) {
        db.prepare(
          'INSERT INTO notifications (user_id, complaint_id, title, message, type) VALUES (?, ?, ?, ?, ?)'
        ).run(
          adm.user_id,
          complaintId,
          `CRITICAL Electrical Hazard Alert (${ticketCode})`,
          `Immediate escalation triggered at ${normalizeBlock(block)}, ${normalizeFloor(floor)}, ${room.trim()}.`,
          'urgent'
        );
      }
    }

    res.status(201).json({
      duplicateDetected: false,
      complaint_id: complaintId,
      ticket_code: ticketCode,
      assignedTeam: user.role === 'student' ? undefined : targetTeamName,
      assignedTechnician: user.role === 'student' ? undefined : techRow?.name || 'Team Queue',
      priority: finalPriority,
      dueDate,
      isElectricalHazard: Boolean(finalHazard),
    });
  } catch (err) {
    console.error('Submit complaint error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to submit complaint' });
  }
});

// Technician accepts assignment
app.post('/api/complaints/:id/accept', requireAuth, requireRole('technician', 'admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.user!;

  const tech = db.prepare('SELECT technician_id FROM technicians WHERE user_id = ?').get(user.user_id) as
    | { technician_id: number }
    | undefined;

  db.prepare(
    "UPDATE assignments SET assignment_status = 'Accepted', technician_id = COALESCE(technician_id, ?) WHERE complaint_id = ?"
  ).run(tech?.technician_id || null, id);

  db.prepare("UPDATE complaints SET status = 'In Progress', updated_at = datetime('now') WHERE complaint_id = ?").run(id);

  db.prepare(
    'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
  ).run(id, user.user_id, user.name, 'In Progress', 'Technician accepted assignment and began inspection.');

  res.json({ ok: true });
});

// Technician rejects assignment with reason
app.post('/api/complaints/:id/reject', requireAuth, requireRole('technician'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const { reason } = req.body as { reason?: string };

  if (!reason?.trim()) {
    res.status(400).json({ error: 'A rejection reason is required.' });
    return;
  }

  db.prepare(
    "UPDATE assignments SET assignment_status = 'Rejected', rejection_reason = ?, technician_id = NULL WHERE complaint_id = ?"
  ).run(reason.trim(), id);

  db.prepare("UPDATE complaints SET status = 'Submitted', updated_at = datetime('now') WHERE complaint_id = ?").run(id);

  db.prepare(
    'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
  ).run(id, user.user_id, user.name, 'Submitted', `Assignment rejected by ${user.name}: ${reason.trim()}`);

  const admins = db.prepare("SELECT user_id FROM users WHERE role = 'admin'").all() as Array<{ user_id: number }>;
  for (const adm of admins) {
    db.prepare(
      'INSERT INTO notifications (user_id, complaint_id, title, message, type) VALUES (?, ?, ?, ?, ?)'
    ).run(
      adm.user_id,
      id,
      'Assignment Rejected — Reassignment Needed',
      `${user.name} rejected complaint #${id}: ${reason.trim()}`,
      'escalation'
    );
  }

  res.json({ ok: true });
});

// Technician adds progress note
app.post('/api/complaints/:id/progress', requireAuth, requireRole('technician', 'admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const { remarks } = req.body as { remarks?: string };
  if (!remarks?.trim()) {
    res.status(400).json({ error: 'Repair remarks cannot be empty.' });
    return;
  }

  db.prepare("UPDATE complaints SET status = 'In Progress', updated_at = datetime('now') WHERE complaint_id = ?").run(id);
  db.prepare(
    'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
  ).run(id, user.user_id, user.name, 'In Progress', remarks.trim());

  res.json({ ok: true });
});

// Technician marks resolved with optional after-repair photo + AI verification
app.post('/api/complaints/:id/resolve', requireAuth, requireRole('technician', 'admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const user = req.user!;
    const { afterImageDataUrl, repairNotes } = req.body as {
      afterImageDataUrl?: string;
      repairNotes?: string;
    };

    const complaint = db.prepare('SELECT * FROM complaints WHERE complaint_id = ?').get(id) as
      | {
          complaint_id: number;
          ticket_code: string;
          image_path: string | null;
          category: string;
          user_id: number;
        }
      | undefined;

    if (!complaint) {
      res.status(404).json({ error: 'Complaint not found.' });
      return;
    }

    let afterImagePath: string | null = null;
    let verificationSummary = '';

    if (afterImageDataUrl) {
      afterImagePath = saveDataUrlToDisk(afterImageDataUrl, 'after');
      const parsed = extractBase64FromDataUrl(afterImageDataUrl);
      if (parsed) {
        try {
          const check = await verifyBeforeAfterRepair({
            beforeImagePath: complaint.image_path,
            afterImageBase64: parsed.base64,
            afterMimeType: parsed.mimeType,
            repairNotes: repairNotes || 'Repair completed',
            category: complaint.category,
          });
          verificationSummary = `AI Before/After Check (${check.confidence}% confidence): ${check.summary}`;
        } catch {
          verificationSummary = 'After-repair photograph uploaded as verification evidence.';
        }
      }
    }

    db.prepare(
      `UPDATE complaints
       SET status = 'Resolved',
           after_image_path = COALESCE(?, after_image_path),
           before_after_summary = CASE WHEN ? != '' THEN ? ELSE before_after_summary END,
           resolved_at = datetime('now'),
           updated_at = datetime('now')
       WHERE complaint_id = ?`
    ).run(afterImagePath, verificationSummary, verificationSummary, id);

    db.prepare(
      `UPDATE technicians
       SET active_load = CASE WHEN active_load > 0 THEN active_load - 1 ELSE 0 END
       WHERE user_id = ?`
    ).run(user.user_id);

    const remarks = `${repairNotes?.trim() || 'Repair work completed.'}${verificationSummary ? ` | ${verificationSummary}` : ''} — Awaiting reporter confirmation.`;
    db.prepare(
      'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
    ).run(id, user.user_id, user.name, 'Resolved', remarks);

    // Notify ALL linked reporters to confirm resolution
    const reporters = db
      .prepare('SELECT DISTINCT user_id FROM complaint_reporters WHERE complaint_id = ?')
      .all(id) as Array<{ user_id: number }>;

    for (const rep of reporters) {
      db.prepare(
        'INSERT INTO notifications (user_id, complaint_id, title, message, type) VALUES (?, ?, ?, ?, ?)'
      ).run(
        rep.user_id,
        id,
        `Confirm Fix: ${complaint.ticket_code} (${complaint.category})`,
        `${user.name} marked your complaint as Resolved. Please confirm whether the issue is fixed or reopen it.`,
        'resolution_check'
      );
    }

    res.json({ ok: true, verificationSummary });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to resolve complaint' });
  }
});

// Reporter confirms resolution or reopens
app.post('/api/complaints/:id/confirm', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const { confirmed, rating, comments } = req.body as {
    confirmed: boolean;
    rating?: number;
    comments?: string;
  };

  const complaint = db.prepare('SELECT * FROM complaints WHERE complaint_id = ?').get(id) as
    | { complaint_id: number; ticket_code: string; user_id: number; priority: string }
    | undefined;

  if (!complaint) {
    res.status(404).json({ error: 'Complaint not found.' });
    return;
  }

  const isLinkedReporter = db
    .prepare('SELECT id FROM complaint_reporters WHERE complaint_id = ? AND user_id = ?')
    .get(id, user.user_id);

  if (complaint.user_id !== user.user_id && !isLinkedReporter && user.role !== 'admin') {
    res.status(403).json({ error: 'Only the complaint reporter or an admin can confirm resolution.' });
    return;
  }

  if (confirmed) {
    db.prepare("UPDATE complaints SET status = 'Closed', updated_at = datetime('now') WHERE complaint_id = ?").run(id);
    db.prepare('INSERT INTO feedback (complaint_id, user_id, rating, comments, confirmed_fixed) VALUES (?, ?, ?, ?, 1)').run(
      id,
      user.user_id,
      Math.min(5, Math.max(1, rating || 5)),
      comments?.trim() || 'Confirmed fixed by reporter.'
    );
    db.prepare(
      'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
    ).run(
      id,
      user.user_id,
      user.name,
      'Closed',
      `Reporter confirmed fix (${rating || 5}/5 stars). ${comments?.trim() || ''}`
    );
    res.json({ ok: true, status: 'Closed' });
  } else {
    db.prepare("UPDATE complaints SET status = 'Reopened', resolved_at = NULL, updated_at = datetime('now') WHERE complaint_id = ?").run(id);
    db.prepare('INSERT INTO feedback (complaint_id, user_id, rating, comments, confirmed_fixed) VALUES (?, ?, ?, ?, 0)').run(
      id,
      user.user_id,
      Math.min(5, Math.max(1, rating || 1)),
      comments?.trim() || 'Issue persists after repair.'
    );
    db.prepare(
      'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
    ).run(
      id,
      user.user_id,
      user.name,
      'Reopened',
      `Reporter rejected fix and reopened ticket: ${comments?.trim() || 'Issue not resolved.'}`
    );

    const assign = db
      .prepare(
        `SELECT t.user_id FROM assignments a JOIN technicians t ON a.technician_id = t.technician_id WHERE a.complaint_id = ?`
      )
      .get(id) as { user_id: number } | undefined;

    if (assign) {
      db.prepare(
        'INSERT INTO notifications (user_id, complaint_id, title, message, type) VALUES (?, ?, ?, ?, ?)'
      ).run(
        assign.user_id,
        id,
        `Ticket Reopened: ${complaint.ticket_code}`,
        `${user.name} reported that the issue is still not fixed: ${comments?.trim() || ''}`,
        'urgent'
      );
    }

    res.json({ ok: true, status: 'Reopened' });
  }
});

// Admin manual reassignment
app.post('/api/complaints/:id/reassign', requireAuth, requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const { teamId, technicianId, remarks } = req.body as {
    teamId: number;
    technicianId?: number | null;
    remarks?: string;
  };

  if (!teamId) {
    res.status(400).json({ error: 'Target maintenance team is required.' });
    return;
  }

  const team = db.prepare('SELECT team_name FROM maintenance_teams WHERE team_id = ?').get(teamId) as
    | { team_name: string }
    | undefined;
  if (!team) {
    res.status(404).json({ error: 'Maintenance team not found.' });
    return;
  }

  let chosenTechId = technicianId || null;
  if (!chosenTechId) {
    const autoTech = db
      .prepare(
        `SELECT technician_id FROM technicians WHERE team_id = ? ORDER BY active_load ASC LIMIT 1`
      )
      .get(teamId) as { technician_id: number } | undefined;
    chosenTechId = autoTech?.technician_id || null;
  }

  db.prepare(
    `UPDATE assignments
     SET team_id = ?, technician_id = ?, assigned_by = ?, assignment_status = 'Pending', rejection_reason = NULL, assigned_at = datetime('now')
     WHERE complaint_id = ?`
  ).run(teamId, chosenTechId, `Admin (${user.name})`, id);

  db.prepare("UPDATE complaints SET status = 'Assigned', updated_at = datetime('now') WHERE complaint_id = ?").run(id);

  db.prepare(
    'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
  ).run(
    id,
    user.user_id,
    user.name,
    'Assigned',
    `Manually reassigned to ${team.team_name}. ${remarks?.trim() || ''}`
  );

  if (chosenTechId) {
    const tUser = db.prepare('SELECT user_id FROM technicians WHERE technician_id = ?').get(chosenTechId) as
      | { user_id: number }
      | undefined;
    if (tUser) {
      db.prepare(
        'INSERT INTO notifications (user_id, complaint_id, title, message, type) VALUES (?, ?, ?, ?, ?)'
      ).run(tUser.user_id, id, `Reassigned Complaint #${id}`, `Admin assigned complaint #${id} to you.`, 'info');
    }
  }

  res.json({ ok: true });
});

// Admin escalation
app.post('/api/complaints/:id/escalate', requireAuth, requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const { reason } = req.body as { reason?: string };

  db.prepare(
    "UPDATE deadlines SET escalation_status = 'Escalated', escalated_at = datetime('now') WHERE complaint_id = ?"
  ).run(id);
  db.prepare("UPDATE complaints SET priority = 'Critical', updated_at = datetime('now') WHERE complaint_id = ?").run(id);
  db.prepare(
    'INSERT INTO complaint_updates (complaint_id, actor_user_id, actor_name, status, remarks) VALUES (?, ?, ?, ?, ?)'
  ).run(
    id,
    user.user_id,
    user.name,
    'Escalated',
    `Escalated to Critical by Facility Admin: ${reason?.trim() || 'SLA deadline breached.'}`
  );

  const assign = db
    .prepare(
      `SELECT t.user_id FROM assignments a JOIN technicians t ON a.technician_id = t.technician_id WHERE a.complaint_id = ?`
    )
    .get(id) as { user_id: number } | undefined;

  if (assign) {
    db.prepare(
      'INSERT INTO notifications (user_id, complaint_id, title, message, type) VALUES (?, ?, ?, ?, ?)'
    ).run(assign.user_id, id, 'SLA Escalation Alert', `Complaint #${id} escalated to Critical priority by Admin.`, 'escalation');
  }

  res.json({ ok: true });
});

// ---------- TEAMS, TECHNICIANS & USERS ----------
app.get('/api/teams', requireAuth, requireRole('admin', 'technician'), (_req, res) => {
  const teams = db.prepare('SELECT * FROM maintenance_teams ORDER BY team_id').all() as Array<{
    team_id: number;
    team_name: string;
    specialization: string;
    contact_email: string;
  }>;

  const technicians = db
    .prepare(
      `SELECT t.technician_id, t.user_id, t.team_id, t.availability, t.active_load,
              u.name, u.email, u.department, mt.team_name
       FROM technicians t
       JOIN users u ON t.user_id = u.user_id
       JOIN maintenance_teams mt ON t.team_id = mt.team_id
       ORDER BY mt.team_name, u.name`
    )
    .all();

  res.json({ teams, technicians });
});

app.patch('/api/technicians/availability', requireAuth, requireRole('technician', 'admin'), (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { availability, technicianId } = req.body as {
    availability: 'Available' | 'Busy' | 'Off Duty';
    technicianId?: number;
  };
  if (!['Available', 'Busy', 'Off Duty'].includes(availability)) {
    res.status(400).json({ error: 'Invalid availability status.' });
    return;
  }

  if (user.role === 'admin' && technicianId) {
    db.prepare('UPDATE technicians SET availability = ? WHERE technician_id = ?').run(availability, technicianId);
  } else {
    db.prepare('UPDATE technicians SET availability = ? WHERE user_id = ?').run(availability, user.user_id);
  }
  res.json({ ok: true, availability });
});

app.get('/api/users', requireAuth, requireRole('admin'), (_req, res) => {
  const users = db
    .prepare('SELECT user_id, name, email, role, department, created_at FROM users ORDER BY role, name')
    .all();
  res.json({ users });
});

app.patch('/api/users/:id/role', requireAuth, requireRole('admin'), (req, res) => {
  const targetId = Number(req.params.id);
  const { role } = req.body as { role: 'student' | 'faculty' | 'technician' | 'admin' };
  if (!['student', 'faculty', 'technician', 'admin'].includes(role)) {
    res.status(400).json({ error: 'Invalid role.' });
    return;
  }
  db.prepare('UPDATE users SET role = ? WHERE user_id = ?').run(role, targetId);
  res.json({ ok: true });
});

// ---------- ANALYTICS & WEEKLY REPORT ----------
app.get('/api/analytics/weekly', requireAuth, requireRole('admin', 'faculty'), (_req, res) => {
  refreshOverdueDeadlines();

  const summary = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) AS resolved,
         SUM(CASE WHEN status NOT IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN is_electrical_hazard = 1 AND status NOT IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) AS active_hazards,
         ROUND(AVG(CASE WHEN resolved_at IS NOT NULL THEN (julianday(resolved_at) - julianday(created_at)) * 24 END), 1) AS avg_resolution_hours
       FROM complaints`
    )
    .get() as {
    total: number;
    resolved: number;
    pending: number;
    active_hazards: number;
    avg_resolution_hours: number | null;
  };

  const overdueRow = db
    .prepare(
      `SELECT COUNT(*) AS overdue
       FROM deadlines d
       JOIN complaints c ON d.complaint_id = c.complaint_id
       WHERE d.escalation_status IN ('Overdue', 'Escalated')
         AND c.status NOT IN ('Resolved', 'Closed')`
    )
    .get() as { overdue: number };

  const byCategory = db
    .prepare(
      `SELECT category AS name, COUNT(*) AS count
       FROM complaints
       GROUP BY category
       ORDER BY count DESC`
    )
    .all();

  const byBlock = db
    .prepare(
      `SELECT l.block AS block,
              COUNT(*) AS total,
              SUM(CASE WHEN c.status IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) AS resolved,
              SUM(CASE WHEN c.status NOT IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) AS open
       FROM complaints c
       JOIN locations l ON c.location_id = l.location_id
       GROUP BY l.block
       ORDER BY total DESC`
    )
    .all();

  const teamPerformance = db
    .prepare(
      `SELECT mt.team_name AS team,
              COUNT(a.complaint_id) AS assigned,
              SUM(CASE WHEN c.status IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) AS resolved,
              ROUND(AVG(CASE WHEN c.resolved_at IS NOT NULL THEN (julianday(c.resolved_at) - julianday(c.created_at)) * 24 END), 1) AS avg_hours,
              ROUND(AVG(f.rating), 1) AS avg_rating
       FROM maintenance_teams mt
       LEFT JOIN assignments a ON mt.team_id = a.team_id
       LEFT JOIN complaints c ON a.complaint_id = c.complaint_id
       LEFT JOIN feedback f ON c.complaint_id = f.complaint_id
       GROUP BY mt.team_id
       ORDER BY assigned DESC`
    )
    .all();

  const dailyTrend = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS date,
              COUNT(*) AS submitted,
              SUM(CASE WHEN status IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) AS resolved
       FROM complaints
       GROUP BY substr(created_at, 1, 10)
       ORDER BY date ASC
       LIMIT 14`
    )
    .all();

  res.json({
    summary: {
      total: summary.total || 0,
      resolved: summary.resolved || 0,
      pending: summary.pending || 0,
      overdue: overdueRow.overdue || 0,
      activeHazards: summary.active_hazards || 0,
      avgResolutionHours: summary.avg_resolution_hours ?? 4.2,
      resolutionRate: summary.total ? Math.round(((summary.resolved || 0) / summary.total) * 100) : 0,
    },
    byCategory,
    byBlock,
    teamPerformance,
    dailyTrend,
  });
});

app.get('/api/analytics/predictive', requireAuth, requireRole('admin', 'faculty'), (_req, res) => {
  const recurring = db
    .prepare(
      `SELECT l.block, l.floor, l.room, c.category,
              COUNT(*) AS occurrences,
              MAX(c.created_at) AS last_reported
       FROM complaints c
       JOIN locations l ON c.location_id = l.location_id
       GROUP BY c.location_id, c.category
       HAVING COUNT(*) >= 2
       ORDER BY occurrences DESC, last_reported DESC`
    )
    .all() as Array<{
    block: string;
    floor: string;
    room: string;
    category: string;
    occurrences: number;
    last_reported: string;
  }>;

  const recommendations = recurring.map((r) => ({
    ...r,
    riskLevel: r.occurrences >= 3 ? 'High' : 'Moderate',
    recommendation:
      r.category.includes('Fan') || r.category.includes('Electrical')
        ? `Repeated ${r.category.toLowerCase()} in ${r.block} ${r.room} (${r.occurrences} incidents). Schedule preventive motor/wiring replacement instead of spot repairs.`
        : `Recurring ${r.category.toLowerCase()} in ${r.block} ${r.room} (${r.occurrences} incidents). Perform full unit inspection and hardware upgrade.`,
  }));

  res.json({ recurring: recommendations });
});

// ---------- NOTIFICATIONS ----------
app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const notifications = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
    .all(user.user_id);
  const unreadRow = db
    .prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_status = 0')
    .get(user.user_id) as { c: number };
  res.json({ notifications, unreadCount: unreadRow.c });
});

app.patch('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  db.prepare('UPDATE notifications SET read_status = 1 WHERE notification_id = ? AND user_id = ?').run(
    Number(req.params.id),
    user.user_id
  );
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  db.prepare('UPDATE notifications SET read_status = 1 WHERE user_id = ?').run(user.user_id);
  res.json({ ok: true });
});

// ---------- VITE / STATIC SERVING ----------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`CampusFix server running on http://localhost:${PORT}`);
  });
}

startServer();
