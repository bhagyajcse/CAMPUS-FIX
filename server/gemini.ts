import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import fs from 'fs';
import path from 'path';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface VisionAnalysisResult {
  imageClear: boolean;
  clarificationNeeded: string;
  faultCategory:
    | 'Projector issue'
    | 'Plumbing issue'
    | 'Electrical / Fan issue'
    | 'Electrical hazard'
    | 'Network issue'
    | 'Furniture issue'
    | 'Other facility issue';
  faultDescription: string;
  confidence: number;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  isElectricalHazard: boolean;
  safetyWarning: string;
  extractedBlock: string;
  extractedFloor: string;
  extractedRoom: string;
  recommendedTeam:
    | 'Electrical team'
    | 'Plumbing team'
    | 'IT / AV support'
    | 'Network team'
    | 'Civil / Furniture team';
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  slaHours: number;
}

export async function analyzeFacilityComplaint(params: {
  imageBase64?: string;
  mimeType?: string;
  description: string;
  block?: string;
  floor?: string;
  room?: string;
}): Promise<VisionAnalysisResult> {
  const ai = getClient();

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

  if (params.imageBase64 && params.mimeType) {
    parts.push({
      inlineData: {
        mimeType: params.mimeType,
        data: params.imageBase64,
      },
    });
  }

  parts.push({
    text: `Analyze this campus facility maintenance complaint.
User Description: "${params.description || 'No description provided'}"
Form-provided Location (may be partial or empty): Block="${params.block || ''}", Floor="${params.floor || ''}", Room="${params.room || ''}"

Rules:
1. Inspect the image carefully. If an image is provided and it is completely black, severely blurry, unreadable, or clearly unrelated to any campus facility/maintenance object (e.g. blank screen or random unrelated object with no fault visible and vague description), set imageClear=false and explain in clarificationNeeded what clear photo or extra detail is needed instead of guessing. Otherwise set imageClear=true.
2. Classify faultCategory into one of:
   - "Projector issue" (broken/flickering projector, HDMI/AV screen fault) -> team "IT / AV support", default priority Medium
   - "Plumbing issue" (leaking tap, pipe burst, clogged sink/toilet, water puddle) -> team "Plumbing team", priority High for major leaks else Medium
   - "Electrical / Fan issue" (broken/wobbly ceiling fan, faulty tube light, non-working AC/switch) -> team "Electrical team", priority Medium
   - "Electrical hazard" (exposed wires, sparking socket, burnt switchboard, dangling live cable) -> team "Electrical team", priority MUST be "Critical", isElectricalHazard=true, provide urgent safetyWarning
   - "Network issue" (broken Wi-Fi router, red LED AP, damaged Ethernet port) -> team "Network team", priority High or Medium
   - "Furniture issue" (broken classroom chair, desk, door hinge, bench) -> team "Civil / Furniture team", priority Low or Medium
   - "Other facility issue" -> team "Civil / Furniture team"
3. Extract Block, Floor, and Room if mentioned in the text description or visible in the image (e.g. door sign), or preserve the form-provided values if present. Leave empty string "" if missing.
4. Set slaHours strictly by priority: Critical=1, High=4, Medium=24, Low=72.
5. Confidence must be 0-100 reflecting visual + textual certainty.`,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction:
        'You are CampusFix AI, an expert campus facility maintenance triage vision agent. Always return accurate, structured maintenance classifications.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          imageClear: { type: Type.BOOLEAN },
          clarificationNeeded: { type: Type.STRING },
          faultCategory: { type: Type.STRING },
          faultDescription: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          severity: { type: Type.STRING },
          isElectricalHazard: { type: Type.BOOLEAN },
          safetyWarning: { type: Type.STRING },
          extractedBlock: { type: Type.STRING },
          extractedFloor: { type: Type.STRING },
          extractedRoom: { type: Type.STRING },
          recommendedTeam: { type: Type.STRING },
          priority: { type: Type.STRING },
          slaHours: { type: Type.INTEGER },
        },
        required: [
          'imageClear',
          'clarificationNeeded',
          'faultCategory',
          'faultDescription',
          'confidence',
          'severity',
          'isElectricalHazard',
          'safetyWarning',
          'extractedBlock',
          'extractedFloor',
          'extractedRoom',
          'recommendedTeam',
          'priority',
          'slaHours',
        ],
      },
    },
  });

  const raw = JSON.parse((response.text ?? '{}').trim()) as Partial<VisionAnalysisResult>;

  const priority = normalizePriority(raw.priority || raw.severity);
  const slaMap: Record<'Critical' | 'High' | 'Medium' | 'Low', number> = {
    Critical: 1,
    High: 4,
    Medium: 24,
    Low: 72,
  };

  const category = normalizeCategory(raw.faultCategory);
  const isHazard = Boolean(raw.isElectricalHazard) || category === 'Electrical hazard';

  return {
    imageClear: raw.imageClear !== false,
    clarificationNeeded: raw.clarificationNeeded || '',
    faultCategory: category,
    faultDescription: raw.faultDescription || params.description || 'Facility maintenance issue detected.',
    confidence: Math.min(100, Math.max(0, Math.round(Number(raw.confidence ?? 85)))),
    severity: isHazard ? 'Critical' : priority,
    isElectricalHazard: isHazard,
    safetyWarning:
      raw.safetyWarning ||
      (isHazard
        ? 'EMERGENCY SAFETY WARNING: Exposed or damaged electrical equipment detected. Keep clear of the area, warn nearby students, and alert the Electrical team immediately.'
        : ''),
    extractedBlock: (raw.extractedBlock || params.block || '').trim(),
    extractedFloor: (raw.extractedFloor || params.floor || '').trim(),
    extractedRoom: (raw.extractedRoom || params.room || '').trim(),
    recommendedTeam: mapCategoryToTeam(category, raw.recommendedTeam),
    priority: isHazard ? 'Critical' : priority,
    slaHours: isHazard ? 1 : slaMap[priority],
  };
}

export async function verifyBeforeAfterRepair(params: {
  beforeImagePath: string | null;
  afterImageBase64: string;
  afterMimeType: string;
  repairNotes: string;
  category: string;
}): Promise<{ verified: boolean; confidence: number; summary: string }> {
  const ai = getClient();
  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

  if (params.beforeImagePath) {
    const absBefore = path.resolve(process.cwd(), params.beforeImagePath.replace(/^\/+/, ''));
    if (fs.existsSync(absBefore)) {
      const ext = path.extname(absBefore).toLowerCase();
      const beforeMime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
      const beforeBase64 = fs.readFileSync(absBefore).toString('base64');
      parts.push({ text: 'BEFORE REPAIR IMAGE:' });
      parts.push({ inlineData: { mimeType: beforeMime, data: beforeBase64 } });
    }
  }

  parts.push({ text: 'AFTER REPAIR IMAGE:' });
  parts.push({
    inlineData: {
      mimeType: params.afterMimeType,
      data: params.afterImageBase64,
    },
  });

  parts.push({
    text: `Compare the repair state for category "${params.category}". Technician notes: "${params.repairNotes}".
Determine if the after-repair photo visibly supports that maintenance work was completed cleanly and safely.`,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          verified: { type: Type.BOOLEAN },
          confidence: { type: Type.NUMBER },
          summary: { type: Type.STRING },
        },
        required: ['verified', 'confidence', 'summary'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    verified?: boolean;
    confidence?: number;
    summary?: string;
  };

  return {
    verified: Boolean(parsed.verified),
    confidence: Math.min(100, Math.max(0, Math.round(Number(parsed.confidence ?? 80)))),
    summary: parsed.summary || 'After-repair photograph attached as evidence for reporter confirmation.',
  };
}

export async function runCampusAssistant(params: {
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  knownLocations: Array<{ block: string; floor: string; room: string }>;
}): Promise<{
  reply: string;
  readyToPrefill: boolean;
  prefill: {
    block: string;
    floor: string;
    room: string;
    category: string;
    description: string;
  };
}> {
  const ai = getClient();
  const locSummary = params.knownLocations
    .slice(0, 20)
    .map((l) => `${l.block} / ${l.floor} / ${l.room}`)
    .join('; ');

  const conversationText = params.history
    .map((m) => `${m.role === 'user' ? 'Student/Faculty' : 'CampusFix Assistant'}: ${m.text}`)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Known campus locations: ${locSummary}

Conversation so far:
${conversationText}

Respond helpfully as CampusFix AI Campus Assistant.
- Guide the student/faculty to clarify the exact Block, Floor, Room number, and fault details if any are missing.
- If they mention an electrical hazard (sparking, exposed wires, shock), immediately warn them to stay away and avoid touching it.
- When you have a clear issue description (and ideally location), set readyToPrefill=true and populate prefill fields so they can click "Open in Complaint Form" with one click.`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reply: { type: Type.STRING },
          readyToPrefill: { type: Type.BOOLEAN },
          prefill: {
            type: Type.OBJECT,
            properties: {
              block: { type: Type.STRING },
              floor: { type: Type.STRING },
              room: { type: Type.STRING },
              category: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ['block', 'floor', 'room', 'category', 'description'],
          },
        },
        required: ['reply', 'readyToPrefill', 'prefill'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    reply?: string;
    readyToPrefill?: boolean;
    prefill?: {
      block?: string;
      floor?: string;
      room?: string;
      category?: string;
      description?: string;
    };
  };

  return {
    reply: parsed.reply || 'Please describe the issue along with the block, floor, and room number.',
    readyToPrefill: Boolean(parsed.readyToPrefill),
    prefill: {
      block: parsed.prefill?.block || '',
      floor: parsed.prefill?.floor || '',
      room: parsed.prefill?.room || '',
      category: parsed.prefill?.category || '',
      description: parsed.prefill?.description || '',
    },
  };
}

function normalizePriority(val?: string): 'Critical' | 'High' | 'Medium' | 'Low' {
  const s = (val || '').toLowerCase();
  if (s.includes('crit')) return 'Critical';
  if (s.includes('high')) return 'High';
  if (s.includes('low')) return 'Low';
  return 'Medium';
}

function normalizeCategory(
  val?: string
):
  | 'Projector issue'
  | 'Plumbing issue'
  | 'Electrical / Fan issue'
  | 'Electrical hazard'
  | 'Network issue'
  | 'Furniture issue'
  | 'Other facility issue' {
  const s = (val || '').toLowerCase();
  if (s.includes('hazard') || s.includes('wire') || s.includes('spark')) return 'Electrical hazard';
  if (s.includes('projector') || s.includes('av') || s.includes('display')) return 'Projector issue';
  if (s.includes('plumb') || s.includes('tap') || s.includes('water') || s.includes('leak')) return 'Plumbing issue';
  if (s.includes('fan') || s.includes('electric') || s.includes('light') || s.includes('ac')) return 'Electrical / Fan issue';
  if (s.includes('net') || s.includes('wifi') || s.includes('wi-fi') || s.includes('router')) return 'Network issue';
  if (s.includes('furn') || s.includes('chair') || s.includes('desk') || s.includes('bench')) return 'Furniture issue';
  return 'Other facility issue';
}

export function mapCategoryToTeam(
  category: string,
  suggested?: string
):
  | 'Electrical team'
  | 'Plumbing team'
  | 'IT / AV support'
  | 'Network team'
  | 'Civil / Furniture team' {
  if (category === 'Electrical hazard' || category === 'Electrical / Fan issue') return 'Electrical team';
  if (category === 'Plumbing issue') return 'Plumbing team';
  if (category === 'Projector issue') return 'IT / AV support';
  if (category === 'Network issue') return 'Network team';
  if (category === 'Furniture issue') return 'Civil / Furniture team';
  if (
    suggested === 'Electrical team' ||
    suggested === 'Plumbing team' ||
    suggested === 'IT / AV support' ||
    suggested === 'Network team' ||
    suggested === 'Civil / Furniture team'
  ) {
    return suggested;
  }
  return 'Civil / Furniture team';
}
