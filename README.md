# 🚀 ApplyIQ — Smart Job Application Agent

An end-to-end AI-powered job application assistant that autonomously researches companies, generates tailored cover letters, and manages application state across multiple services — all from a single dashboard.

![Tech Stack](https://img.shields.io/badge/Node.js-Express-green?style=flat-square)
![AI](https://img.shields.io/badge/AI-Google%20Gemini%202.0-blue?style=flat-square)
![MCP](https://img.shields.io/badge/MCP-Notion%20%7C%20Slack%20%7C%20Gmail-purple?style=flat-square)

---

## ✨ What It Does

Paste a job description → the AI agent automatically:

1. **🔍 Researches** the company (culture, tech stack, key highlights)
2. **✍️ Writes** a tailored cover letter matched to your resume
3. **📋 Saves** the application to a Notion database
4. **💬 Notifies** you via Slack webhook
5. **📧 Drafts** a follow-up email ready to send

**One prompt, five things happen automatically.**

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────┐
│          Frontend (Vanilla JS)           │
│   Premium dark UI · Pipeline visualizer  │
│   Glassmorphism · Micro-animations       │
└──────────────────┬───────────────────────┘
                   │ REST API
┌──────────────────▼───────────────────────┐
│       Backend (Express.js Server)        │
│                                          │
│  POST /api/agent/run    → Gemini AI      │
│  POST /api/notion/save  → Notion API     │
│  GET  /api/notion/apps  → Notion Query   │
│  POST /api/slack/notify → Slack Webhook  │
│  POST /api/gmail/draft  → Email Draft    │
└──────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | HTML, CSS, Vanilla JS | Premium glassmorphism dark UI |
| Backend | Node.js, Express.js | API server & service orchestration |
| AI Engine | Google Gemini 2.0 Flash | Company research & cover letter generation |
| Database | Notion API | Structured application tracking |
| Notifications | Slack Webhooks | Real-time application alerts |
| Email | Gmail (mailto) | Follow-up email drafting |

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Gemini API Key](https://aistudio.google.com/apikey) (free)
- [Notion Integration](https://www.notion.so/my-integrations) + Database
- [Slack Webhook](https://api.slack.com/messaging/webhooks) (optional)

### Setup

```bash
# Clone the repo
git clone https://github.com/arpita270622/job-agent.git
cd job-agent

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your API keys

# Start the server
npm start
```

Open **http://localhost:3001** in your browser.

### Environment Variables

Create a `.env` file in the root directory:

```env
PORT=3001
GEMINI_API_KEY=your_gemini_api_key_here
NOTION_TOKEN=your_notion_integration_token
NOTION_DB_ID=your_notion_database_id
SLACK_WEBHOOK_URL=your_slack_webhook_url
```

---

## 📸 Features

### 🎯 AI Agent Pipeline
- Real-time pipeline visualizer showing each step as it executes
- Animated step progression with status indicators (active → complete → error)

### 📝 Smart Cover Letters
- Personalized to your resume and the target job description
- Match score (0-100) with skill alignment analysis
- Company-specific interview tips

### 📊 Application Tracker
- All applications stored in Notion with full metadata
- Dashboard view with status tracking (Applied, Interview, Offer)
- Color-coded match scores

### 🔔 Multi-Service Notifications
- Slack alerts when applications are saved
- Email drafts ready to send with one click

---

## 📁 Project Structure

```
job-agent/
├── server.js          # Express backend — AI + MCP connector routes
├── public/
│   ├── index.html     # Premium single-page application
│   ├── styles.css     # Design system (glassmorphism, animations)
│   └── app.js         # Client-side logic & API orchestration
├── .env               # API keys (not committed)
├── .gitignore
├── package.json
└── README.md
```

---

## 🎯 Resume Bullet

> *"Built an end-to-end AI job application agent using Google Gemini and MCP connectors (Notion, Slack, Gmail) that autonomously researches companies, generates tailored cover letters, and manages application state across services — demonstrating full-stack development, AI orchestration, and multi-service integration."*

---

## 👩‍💻 Author

**Arpita Oberoi**  
B.Tech EIOT

---

## 📄 License

MIT License — feel free to use this as inspiration for your own projects.
