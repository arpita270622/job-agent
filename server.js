require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  }
  next();
});

const {
  PORT = 3001,
  NOTION_TOKEN,
  NOTION_DB_ID,
  GEMINI_API_KEY,
  SLACK_WEBHOOK_URL,
} = process.env;

// ── 1. Health check ────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    services: {
      notion: !!(NOTION_TOKEN && NOTION_DB_ID),
      gemini: !!GEMINI_API_KEY,
      slack: !!SLACK_WEBHOOK_URL,
    },
  });
});

// ── 2. Run agent ───────────────────────────────────────────────────────────
app.post('/api/agent/run', async (req, res) => {
  try {
    const { company, role, description, resume } = req.body;
    if (!company || !role) {
      return res.status(400).json({ error: 'Missing required fields', message: 'Please provide company and role.' });
    }
    if (!resume) {
      return res.status(400).json({ error: 'Missing resume', message: 'Please provide your resume.' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(503).json({ error: 'Gemini API key not configured' });
    }

    console.log(`[Agent] Researching ${company} for ${role}...`);

    const prompt = `
You are an expert career advisor and job application strategist.

CANDIDATE RESUME:
${resume}

TARGET JOB:
Company: ${company}
Role: ${role}
Job Description: ${description || 'Not provided — use your knowledge of typical requirements for this role.'}

TASKS — complete every one:
1. Company Research: Summarise the company (what they do, size, industry), their culture & values, likely tech stack, and recent highlights.
2. Tailored Cover Letter: Write a professional cover letter (300-400 words) addressed to the Hiring Manager at ${company}. Use specific skills and experiences from the resume above. Confident yet genuine tone. Do NOT invent details not in the resume.
3. Match Score: Calculate a score from 0 to 100 based on how well the candidate's skills match the role.
4. Key Matches: List specific skills or experiences from the resume that directly match this role.
5. Interview Tip: Give one actionable company-specific interview tip.

RESPOND IN THIS EXACT JSON FORMAT (no markdown, no code fences, just raw JSON):
{
  "research": {
    "companySummary": "...",
    "culture": "...",
    "techStack": ["tech1", "tech2"],
    "recentHighlights": "..."
  },
  "coverLetter": "...",
  "matchScore": 85,
  "interviewTip": "...",
  "keyMatches": ["skill1", "skill2"]
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await axios.post(
      geminiUrl,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7 } },
      { timeout: 60000}
    );

    const rawText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[Agent] JSON parse failed:', parseErr.message);
      return res.status(500).json({ error: 'AI response parsing failed', message: 'Please try again.' });
    }

    const result = {
      research: {
        companySummary: parsed.research?.companySummary || '',
        culture: parsed.research?.culture || '',
        techStack: Array.isArray(parsed.research?.techStack) ? parsed.research.techStack : [],
        recentHighlights: parsed.research?.recentHighlights || '',
      },
      coverLetter: parsed.coverLetter || '',
      matchScore: typeof parsed.matchScore === 'number' ? Math.min(100, Math.max(0, parsed.matchScore)) : 0,
      interviewTip: parsed.interviewTip || '',
      keyMatches: Array.isArray(parsed.keyMatches) ? parsed.keyMatches : [],
    };

    console.log(`[Agent] Done — match score ${result.matchScore}% for ${company}`);
    res.json(result);
  } catch (err) {
    console.error('[Agent] Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Agent execution failed', message: err.response?.data?.error?.message || err.message });
  }
});

// ── 3. Save to Notion ──────────────────────────────────────────────────────
app.post('/api/notion/save', async (req, res) => {
  try {
    const { company, role, status = 'Applied', matchScore, coverLetter, notes, dateApplied } = req.body;
    if (!NOTION_TOKEN || !NOTION_DB_ID) {
      return res.status(503).json({ error: 'Notion not configured' });
    }
    if (!company) return res.status(400).json({ error: 'company is required' });

    console.log(`[Notion] Saving: ${company} — ${role}`);
    const truncate = (str, max = 1999) => str && str.length > max ? str.substring(0, max) + '…' : str || '';

    const response = await axios.post(
      'https://api.notion.com/v1/pages',
      {
        parent: { database_id: NOTION_DB_ID },
        properties: {
          Company: { title: [{ text: { content: company } }] },
          Role: { rich_text: [{ text: { content: role || '' } }] },
          Status: { select: { name: status } },
          'Match Score': { rich_text: [{ text: { content: matchScore != null ? String(matchScore) : '' } }] },
          'Date Applied': { date: { start: dateApplied || new Date().toISOString().split('T')[0] } },
          'Cover Letter': { rich_text: [{ text: { content: truncate(coverLetter) } }] },
          Notes: { rich_text: [{ text: { content: truncate(notes) } }] },
        }
      },
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    console.log(`[Notion] Saved — page ${response.data.id}`);
    res.json({ success: true, id: response.data.id, url: response.data.url });
  } catch (err) {
    console.error('[Notion] Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to save to Notion', message: err.response?.data?.message || err.message });
  }
});

// ── 4. Fetch applications from Notion ─────────────────────────────────────
app.get('/api/notion/applications', async (_req, res) => {
  try {
    if (!NOTION_TOKEN || !NOTION_DB_ID) {
      return res.status(503).json({ error: 'Notion not configured' });
    }

    const response = await axios.post(
      `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
      {},
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const applications = response.data.results.map((page) => {
      const p = page.properties;
      const getText = (prop) => prop?.rich_text?.[0]?.text?.content || '';
      const getTitle = (prop) => prop?.title?.[0]?.text?.content || '';
      const getSelect = (prop) => prop?.select?.name || '';
      const getDate = (prop) => prop?.date?.start || '';
      return {
        id: page.id,
        company: getTitle(p['Company']),
        role: getText(p['Role']),
        status: getSelect(p['Status']),
        matchScore: getText(p['Match Score']),
        dateApplied: getDate(p['Date Applied']),
        coverLetter: getText(p['Cover Letter']),
        notes: getText(p['Notes']),
        url: page.url,
        lastEdited: page.last_edited_time,
      };
    });

    console.log(`[Notion] Retrieved ${applications.length} applications`);
    res.json(applications);
  } catch (err) {
    console.error('[Notion] Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch applications', message: err.response?.data?.message || err.message });
  }
});

// ── 5. Slack notification ──────────────────────────────────────────────────
app.post('/api/slack/notify', async (req, res) => {
  try {
    const { company, role, matchScore, status = 'Applied' } = req.body;
    if (!SLACK_WEBHOOK_URL) {
      return res.json({ success: false, message: 'Slack not configured' });
    }

    const scoreEmoji = matchScore >= 80 ? '🟢' : matchScore >= 60 ? '🟡' : matchScore >= 40 ? '🟠' : '🔴';
    const payload = {
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '🚀 New Job Application Filed!' } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*🏢 Company:*\n${company}` },
            { type: 'mrkdwn', text: `*💼 Role:*\n${role || 'N/A'}` },
            { type: 'mrkdwn', text: `*${scoreEmoji} Match Score:*\n${matchScore != null ? `${matchScore}%` : 'N/A'}` },
            { type: 'mrkdwn', text: `*📋 Status:*\n${status}` },
          ],
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `📅 ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}` }],
        },
      ],
    };

    await axios.post(SLACK_WEBHOOK_URL, payload, { timeout: 10000 });
    console.log('[Slack] Notification sent ✓');
    res.json({ success: true, message: 'Slack notification sent' });
  } catch (err) {
    console.error('[Slack] Error:', err.message);
    res.status(500).json({ error: 'Slack notification failed', message: err.message });
  }
});

// ── 6. Gmail draft ─────────────────────────────────────────────────────────
app.post('/api/gmail/draft', (req, res) => {
  try {
    const { to, subject, body, company } = req.body;
    if (!to || !subject) {
      return res.status(400).json({ error: 'to and subject are required' });
    }

    const mailtoUrl = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body || '')}`;
    const followUpSubject = `Following Up — ${subject}`;
    const followUpBody = `Dear Hiring Team at ${company || 'the company'},\n\nI wanted to follow up on my application. I remain very enthusiastic about the opportunity and believe my background aligns well with the role.\n\nPlease let me know if there are any additional materials I can provide.\n\nBest regards`;

    res.json({
      success: true,
      mailtoUrl,
      followUp: {
        subject: followUpSubject,
        body: followUpBody,
        mailtoUrl: `mailto:${to}?subject=${encodeURIComponent(followUpSubject)}&body=${encodeURIComponent(followUpBody)}`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate email draft', message: err.message });
  }
});

// ── Catch-all ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   🚀  Job Application AI Agent — Server     ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   Port     : ${String(PORT).padEnd(31)}║`);
  console.log(`║   Notion   : ${(NOTION_TOKEN ? '✅ Connected' : '❌ Not configured').padEnd(31)}║`);
  console.log(`║   Gemini   : ${(GEMINI_API_KEY ? '✅ Connected' : '❌ Not configured').padEnd(31)}║`);
  console.log(`║   Slack    : ${(SLACK_WEBHOOK_URL ? '✅ Connected' : '❌ Not configured').padEnd(31)}║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n   → http://localhost:${PORT}\n`);
});