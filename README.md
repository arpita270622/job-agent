# ApplyIQ — Agentic Job Application System

An end-to-end AI-powered job application agent built with Node.js, Express.js, and Gemini 2.5 Flash. Paste a resume + job description and ApplyIQ autonomously researches the company, generates a tailored cover letter, scores your fit via a real ATS engine, optimizes your resume bullets, and manages the full application lifecycle across Notion, Slack, and Gmail.

![Node.js](https://img.shields.io/badge/Node.js-Express-green?style=flat-square)
![AI](https://img.shields.io/badge/AI-Gemini%202.5%20Flash-blue?style=flat-square)
![MCP](https://img.shields.io/badge/MCP-Notion%20%7C%20Slack%20%7C%20Gmail-purple?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square)

**🌐 Live Demo: [appyiq-muhj.onrender.com](https://appyiq-muhj.onrender.com)**

> ⚠️ Hosted on Render free tier — first load may take ~30 seconds to wake up.

---

## What It Does

Paste your resume + a job description → the agent runs a 5-step pipeline automatically:

| Step | What happens |
|------|-------------|
| 🔍 Research | Company summary, culture, tech stack, recent highlights via Gemini |
| ✍️ Cover Letter | Tailored 300–400 word letter matched to your resume + chosen tone |
| 🤖 ATS Score | Section-aware JD parsing + two-pass semantic matching via Gemini AI |
| 📋 Notion | Saves application with status, match score, cover letter |
| 💬 Slack + 📧 Gmail | Notifies Slack, drafts follow-up email |

---

## Features

**Core Agent**
- Company research — culture, tech stack, recent highlights
- Cover letter generation in 3 tones: Formal / Conversational / Bold
- Match Score (0–100) via Gemini AI holistic judgment
- Real ATS engine mirroring Workday / Greenhouse keyword parsing

**ATS Engine**
- Section-aware JD parsing — only extracts from Requirements, Skills, Responsibilities; ignores intro/benefits fluff
- Two-pass keyword matching: exact match first, then Gemini AI semantic match (`message queues` → `kafka`, `container orchestration` → `kubernetes`)
- Deduplication — `microservices` and `microservices architecture` count as one

**Resume Optimizer**
- Takes missing ATS keywords → rewrites specific resume bullets to include them naturally
- Before/After view for each changed bullet with keywords-added badges
- Suggests new bullets the candidate can add
- One-click copy per bullet

**Application Tracker Dashboard**
- All applications stored in Notion
- Live status dropdown (Applied → Researching → Interview → Offer → Rejected) updates Notion instantly
- Match score badges, date tracking, delete with confirmation

**More Features**
- Interview Prep — 18 role-specific questions across 6 categories with answer outlines
- LinkedIn Outreach — 3 Gemini-crafted sub-300-char messages with live character counter
- PDF Export — exports cover letter as a formatted PDF
- Auto-save drafts — localStorage saves inputs, restores on refresh
- Dark / Light mode — persisted across sessions

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Vanilla JS, HTML5, CSS3 | Glassmorphism dark/light UI |
| Backend | Node.js, Express.js | API server & service orchestration |
| AI Engine | Google Gemini 2.5 Flash | Research, cover letters, semantic ATS matching |
| ATS Engine | Custom section-aware parser | JD keyword extraction mirroring Workday/Greenhouse |
| Database | Notion API | Structured application tracking |
| Notifications | Slack Webhooks | Real-time application alerts |
| Resume Parsing | PDF.js + Mammoth.js | PDF / DOCX / TXT upload support |
| PDF Export | jsPDF | Cover letter PDF download |

---

## Quick Start

**Prerequisites:** Node.js v18+, Gemini API key, Notion integration

```bash
git clone https://github.com/arpita270622/job-agent.git
cd job-agent
npm install
cp .env.example .env
# Add your API keys to .env
node server.js
```

Open `http://localhost:3001`

### Environment Variables

```env
PORT=3001
GEMINI_API_KEY=your_gemini_api_key
NOTION_TOKEN=your_notion_integration_token
NOTION_DB_ID=your_notion_database_id
SLACK_WEBHOOK_URL=your_slack_webhook_url
```

Get your Gemini API key free at [aistudio.google.com](https://aistudio.google.com/apikey)

---

## Notion Database Setup

Create a database with these exact columns:

| Column | Type |
|--------|------|
| Company | Title |
| Role | Text |
| Status | Select (Applied, Researching, Interview, Offer, Rejected) |
| Match Score | Text |
| Date Applied | Date |
| Cover Letter | Text |
| Notes | Text |

---

## Project Structure

```
job-agent/
├── server.js          # Express backend — ATS engine, Gemini routes, MCP connectors
├── public/
│   ├── index.html     # Single-page app
│   ├── styles.css     # Design system — glassmorphism, dark/light themes, animations
│   └── app.js         # Client logic — agent pipeline, modals, draft saving
├── .env.example
├── .gitignore
└── package.json
```

---

## How the ATS Engine Works

Real ATS systems like Workday and Greenhouse scan resumes for keyword overlap — no human judgment, no context. ApplyIQ replicates this:

1. **Section detection** — identifies Required, Preferred, Responsibilities sections by header patterns; skips intro, benefits, and company description entirely
2. **Tech-only whitelist** — extracts only real technical terms (languages, frameworks, tools, concepts), never grammar words or filler
3. **Pass 1: exact + substring match** — fast, no API call
4. **Pass 2: Gemini semantic match** — sends unmatched keywords to Gemini in one batch; detects equivalents like `kafka` ↔ `event streaming`, `system design` ↔ `designed scalable architecture`
5. **Scoring** — Required Skills (50 pts), Preferred Skills (30 pts), Format (10 pts), Content Quality (10 pts)
6. **Pass threshold: 70** — mirrors industry standard

---

## Author

**Arpita Oberoi** — B.Tech ECE with IoT, NSUT 2026
[LinkedIn](https://www.linkedin.com/in/arpita-oberoi-961414349) · [GitHub](https://github.com/arpita270622)

---

## License

MIT — feel free to use as inspiration for your own projects.
