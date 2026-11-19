# CampusFix — Smart Campus Facility Request Agent (PS 36)

## Introduction

Campus facility issues—such as broken projectors, leaking washroom taps, faulty ceiling fans, exposed electrical wires, and Wi-Fi dead zones—are commonly reported through informal channels like WhatsApp messages, phone calls, or verbal complaints to faculty. As a result:

- Complaints get lost with no tracking ID.
- Reporters frequently forget to mention the exact Block, Floor, or Room number.
- Multiple students report the same issue, creating duplicate work.
- Urgent safety hazards (like exposed electrical wires) are not prioritized ahead of minor repairs.
- Students and faculty have no visibility into whether an issue was actually fixed.

**CampusFix** solves this with a centralized, AI-powered campus maintenance management platform. Students and faculty upload a photo and a short note, and the CampusFix AI Agent automatically diagnoses the fault, validates the room location, prevents duplicate tickets, prioritizes safety hazards, assigns the appropriate maintenance team, and tracks every repair through verified closure.

---

## Key Features of the project

- **AI Vision Fault Triage**: Uses Google Gemini Vision (`@google/genai`) on the backend to classify uploaded issue photos into campus categories (Projector, Plumbing, Electrical/Fan, Electrical Hazard, Network/Wi-Fi, Furniture, Other) with a confidence score and severity rating. Unclear photos trigger a request for a clearer image before dispatch.
- **Electrical Hazard Safety Escalation**: Exposed wires or sparking hazards are flagged immediately with safety warnings and assigned a **Critical (1-hour SLA)** priority.
- **Location Extraction & Room QR Support**: Automatically extracts Block, Floor, and Room from user input or Room QR URLs (`?qr=CF-BLKA-2-204`). Incomplete locations are blocked until the user specifies all three details.
- **Smart Duplicate Complaint Detection**: Queries the SQLite database for open complaints matching the same location and fault category, linking additional reporters to the existing ticket instead of creating duplicate dispatches.
- **Strict Role-Based Access Control (RBAC)**:
  - **Students**: Can register/sign in, submit complaints, view AI triage feedback, and track their own complaints. Students cannot browse campus-wide tickets or assign maintenance teams.
  - **Technicians**: View their assigned repair queue, accept or reject tasks with a mandatory reason, update availability, and upload After-Repair photos for Gemini Before/After verification.
  - **Faculty & Facility Admin**: Monitor campus-wide tickets, escalate or reassign teams, confirm repair closures, inspect predictive maintenance alerts, and download reports.
- **SLA Priority & Workload-Balanced Routing**: Automatically routes faults to specialized teams (`1h` Critical, `4h` High, `24h` Medium, `72h` Low) and picks the available technician with the lowest active workload.
- **Before & After Verification Loop**: Technicians upload proof-of-fix photos, Gemini compares Before vs. After images, and reporters/faculty can confirm closure or reopen unresolved tickets.
- **Weekly Facility Health Reports & Predictive AI**: Interactive Recharts analytics, recurring-fault predictive maintenance warnings, and 1-click **PDF (`jsPDF`)** and **CSV** exports.
- **AI Campus Assistant & Voice Input**: Conversational assistant supporting browser Speech-to-Text (`Web Speech API`) for hands-free issue reporting and status queries.
- **Built-in Pitch Deck Viewer & `.pptx` Export**: Includes an 8-slide hackathon presentation viewer and downloadable `CampusFix_Hackathon_Deck.pptx`.

---

## How the Project Works (Architecture)

CampusFix uses a three-tier full-stack architecture:

1. **Frontend (`React 19 + TypeScript + Tailwind CSS v4`)**: Role-tailored dashboards, photo upload, voice input, QR parameter support, Recharts analytics, and PDF/CSV export.
2. **Backend & AI Agent (`Node.js + Express + JWT + @google/genai`)**: Authenticates users with JWT + `bcryptjs`, enforces strict student/technician/admin permissions, stores uploaded photos in `/uploads`, runs Gemini Vision triage securely on the server, and manages SLA timers.
3. **Database (`SQLite via better-sqlite3`)**: Stores all records across 11 relational tables (`users`, `locations`, `complaints`, `complaint_reporters`, `maintenance_teams`, `technicians`, `assignments`, `deadlines`, `complaint_updates`, `feedback`, `notifications`) with foreign-key integrity and full audit trails.

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons |
| **AI & Multimodal** | Google Gemini (`@google/genai`), Web Speech API |
| **Backend & Auth** | Node.js, Express 4, JSON Web Tokens (`jsonwebtoken`), `bcryptjs` |
| **Database** | SQLite (`better-sqlite3`, WAL mode + Foreign Keys) |
| **Analytics & Export** | Recharts, `jsPDF`, CSV Export, `pptxgenjs` |

---

## How to Get the Code from GitHub and Run Locally

### Prerequisites
Make sure you have the following installed on your system:
- **Node.js** (v20 or higher recommended) — https://nodejs.org/
- **Git** — https://git-scm.com/
- A **Google Gemini API Key** — https://aistudio.google.com/

### 1. Clone the Repository from GitHub
Open your terminal (or PowerShell in VS Code) and run:

```bash
git clone https://github.com/<bhagyajcse>/<CAMPUS-FIX>.git
cd <CAMPUS-FIX>
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the root folder of the project (you can copy `.env.example`):

```env
GEMINI_API_KEY="YOUR_ACTUAL_GEMINI_API_KEY"
JWT_SECRET="replace_with_a_secure_random_secret"
APP_URL="http://localhost:3000"
```

> **Note:** Never commit your `.env` file or API keys to GitHub.

### 4. Start the Application
Run the development server (starts both the Express backend + SQLite database and the Vite React frontend on port `3000`):

```bash
npm run dev
```

Once started, open your browser and go to:

```text
http://localhost:3000
```

### Useful Commands

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts Express backend + Vite frontend on `http://localhost:3000` |
| `npm run lint` | Runs TypeScript type-checking (`tsc --noEmit`) |
| `npm run build` | Builds the production frontend bundle into `dist/` |
| `npm start` | Runs the server in production mode |
| `node scripts/generate-deck.mjs` | Regenerates `public/CampusFix_Hackathon_Deck.pptx` |
