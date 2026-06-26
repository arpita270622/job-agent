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

const { PORT = 3001, NOTION_TOKEN, NOTION_DB_ID, GEMINI_API_KEY, SLACK_WEBHOOK_URL } = process.env;

// ══════════════════════════════════════════════════════════════════════════
//  REAL ATS ENGINE
// ══════════════════════════════════════════════════════════════════════════

// STOP_WORDS removed — new ATS engine uses a tech-term whitelist instead of a blocklist,
// so noise words like "india", "hiring", "team" can never appear as keywords.

const SYNONYMS = {
  'javascript': ['js', 'ecmascript', 'es6', 'es2015'],
  'typescript': ['ts'], 'python': ['py'], 'postgresql': ['postgres', 'psql'],
  'mongodb': ['mongo'], 'kubernetes': ['k8s'], 'amazon web services': ['aws'],
  'google cloud platform': ['gcp'], 'microsoft azure': ['azure'],
  'machine learning': ['ml'], 'artificial intelligence': ['ai'],
  'natural language processing': ['nlp'], 'continuous integration': ['ci'],
  'continuous deployment': ['cd', 'ci/cd'], 'react.js': ['react', 'reactjs'],
  'node.js': ['node', 'nodejs'], 'next.js': ['next', 'nextjs'],
  'vue.js': ['vue', 'vuejs'], 'express.js': ['express', 'expressjs'],
};

// ── Section-aware JD parser ───────────────────────────────────────────────
// Only extracts keywords from real technical sections (Requirements, Skills,
// Responsibilities). Ignores intro, "About us", "What we offer", benefits, etc.
// This mirrors how Workday/Greenhouse ATS systems actually parse JDs.

function parseJD(jobDescription) {
  const lines = jobDescription.split('\n').map(l => l.trim()).filter(Boolean);

  const REQUIRED_HEADERS = [
    /must.?have/i, /required/i, /requirements/i, /minimum.?qual/i,
    /basic.?qual/i, /essential/i, /mandatory/i, /you.?must/i,
    /key.?skills/i, /technical.?skills/i, /skills.?required/i,
    /what.?you.?need/i, /what.?we.?need/i, /qualifications/i,
  ];

  const PREFERRED_HEADERS = [
    /nice.?to.?have/i, /preferred/i, /bonus/i, /good.?to.?have/i,
    /additional/i, /desired/i, /ideally/i, /advantage/i,
    /what.?you.?bring/i, /preferred.?qual/i,
  ];

  const RESPONSIBILITY_HEADERS = [
    /responsibilities/i, /what.?you.?will/i, /what.?you.?ll/i,
    /your.?role/i, /the.?role/i, /job.?duties/i, /duties/i,
    /you.?will/i, /role.?overview/i,
  ];

  // Sections to completely ignore — no keyword extraction
  const SKIP_HEADERS = [
    /about.?(us|the|company|team|position|role|razorpay|stripe|google|amazon|flipkart|swiggy|zomato|uber|ola)/i,
    /who.?we.?are/i, /our.?mission/i, /overview/i,
    /what.?we.?offer/i, /what.?we.?provide/i, /benefits/i,
    /perks/i, /compensation/i, /salary/i, /why.?(join|us)/i,
    /our.?culture/i, /life.?at/i, /equal.?opportunity/i,
    /location/i, /hybrid/i,
  ];

  function classifyHeader(line) {
    const isShort = line.length < 72;
    const looksLikeHeader = isShort && (
      /^[A-Z][A-Z\s\/\(\)]{3,}$/.test(line) ||
      line.endsWith(':') ||
      /^\*{1,2}[^*]+\*{1,2}$/.test(line) ||
      /^#{1,3}\s/.test(line)
    );
    if (!looksLikeHeader && !isShort) return null;
    const clean = line.replace(/[*#:]/g, '').trim();
    if (SKIP_HEADERS.some(r => r.test(clean))) return 'skip';
    if (REQUIRED_HEADERS.some(r => r.test(clean))) return 'required';
    if (PREFERRED_HEADERS.some(r => r.test(clean))) return 'preferred';
    if (RESPONSIBILITY_HEADERS.some(r => r.test(clean))) return 'responsibility';
    return null;
  }

  function isBullet(line) {
    return /^[-•*►▸✓✔→]\s/.test(line) || /^\d+[.)]\s/.test(line);
  }

  let currentSection = null;
  const requiredKeywords = new Set();
  const preferredKeywords = new Set();

  const yearsMatch = jobDescription.match(/(\d+)\+?\s*(?:to\s*\d+\s*)?years?\s+(?:of\s+)?(?:experience|exp)/i);
  const yearsRequired = yearsMatch ? parseInt(yearsMatch[1]) : null;

  for (const line of lines) {
    const headerType = classifyHeader(line);
    if (headerType === 'skip')           { currentSection = 'skip'; continue; }
    if (headerType === 'required')       { currentSection = 'required'; continue; }
    if (headerType === 'preferred')      { currentSection = 'preferred'; continue; }
    if (headerType === 'responsibility') { currentSection = 'responsibility'; continue; }
    if (currentSection === null || currentSection === 'skip') continue;

    // In required/preferred sections parse all lines; in responsibilities only bullets
    if (currentSection === 'responsibility' && !isBullet(line)) continue;

    const extracted = extractTechKeywordsOnly(line.toLowerCase());
    if (currentSection === 'required') {
      extracted.forEach(k => requiredKeywords.add(k));
    } else if (currentSection === 'preferred') {
      extracted.forEach(k => preferredKeywords.add(k));
    } else if (currentSection === 'responsibility') {
      extracted.forEach(k => preferredKeywords.add(k));
    }
  }

  // Fallback for completely unstructured JDs
  if (requiredKeywords.size === 0 && preferredKeywords.size === 0) {
    extractTechKeywordsOnly(jobDescription.toLowerCase()).forEach(k => preferredKeywords.add(k));
  }

  return {
    required: [...requiredKeywords],
    preferred: [...preferredKeywords],
    allKeywords: [...new Set([...requiredKeywords, ...preferredKeywords])],
    yearsRequired,
  };
}

function parseResume(resume) {
  const resumeLower = resume.toLowerCase();
  const keywords = new Set(extractTechKeywordsOnly(resumeLower));
  const yearMatches = resumeLower.match(/(\d+)\+?\s*years?/gi) || [];
  const yearsExp = yearMatches.length > 0 ? Math.max(...yearMatches.map(m => parseInt(m))) : 0;
  return { keywords, yearsExp };
}

// Replaces extractKeywordsFromText — only returns real technical terms, never grammar/noise
function extractTechKeywordsOnly(text) {
  const keywords = new Set();

  // Multi-word tech phrases checked first
  const TECH_PHRASES = [
    'node.js','react.js','next.js','vue.js','express.js','spring boot','ruby on rails',
    'asp.net','.net core','amazon web services','google cloud platform','microsoft azure',
    'aws lambda','ci/cd pipeline','continuous integration','continuous deployment',
    'infrastructure as code','machine learning','deep learning','natural language processing',
    'computer vision','data pipeline','data warehouse','a/b testing','microservices architecture',
    'event driven','event-driven','distributed systems','system design','high availability',
    'fault tolerant','load balancing','api gateway','service mesh',
    'postgresql','mysql','mongodb','redis','cassandra','elasticsearch','dynamodb',
    'apache kafka','rabbitmq','amazon sqs',
    'unit testing','integration testing','test driven development','end to end testing',
    'code review','version control','agile methodology','rest api','restful api',
    'graphql api','grpc','react native','payment gateway','payment processing',
    'pci dss','fraud detection','data structures','system design',
  ];
  for (const phrase of TECH_PHRASES) {
    if (text.includes(phrase)) keywords.add(phrase);
  }

  // Whitelist of real technical single tokens — nothing else gets through
  const TECH_TOKENS = new Set([
    // Languages
    'java','python','go','golang','rust','kotlin','swift','scala','ruby',
    'javascript','typescript','php','c++','c#','r','elixir','dart','groovy','perl',
    'bash','shell',
    // Frontend
    'react','angular','vue','svelte','html','css','sass','webpack','vite',
    'tailwind','bootstrap','redux','graphql','apollo',
    // Backend / frameworks
    'node','express','django','flask','fastapi','spring','rails','laravel',
    'gin','fiber','nestjs','fastify',
    // Databases
    'sql','nosql','postgres','mysql','mongo','redis','cassandra','sqlite',
    'elasticsearch','solr','neo4j','influxdb','snowflake','bigquery','clickhouse',
    // Cloud
    'aws','gcp','azure','lambda','ec2','s3','eks','ecs','gke','cloudfront',
    // DevOps
    'docker','kubernetes','k8s','terraform','ansible','jenkins','nginx','apache',
    'linux','unix','prometheus','grafana','datadog','splunk','sentry','kibana',
    'argocd','helm','circleci','github','gitlab','bitbucket',
    // Queues
    'kafka','rabbitmq','sqs','pubsub','celery','sidekiq',
    // Testing
    'jest','mocha','pytest','junit','selenium','cypress','playwright','postman',
    // Concepts
    'api','rest','grpc','websocket','microservices','serverless',
    'oauth','jwt','ssl','tls','caching','cdn',
    // Data / ML
    'spark','hadoop','airflow','dbt','pandas','numpy','tensorflow','pytorch',
    'keras','mlflow',
    // Mobile
    'android','ios','flutter',
    // Fintech
    'upi','neft','rtgs','kyc','aml','pci','payments','fintech','reconciliation','settlement',
  ]);

  const tokens = text.replace(/[^a-z0-9+#.\-_/\s]/g, ' ').split(/\s+/);
  for (const token of tokens) {
    const t = token.trim();
    if (t.length < 2) continue;
    if (TECH_TOKENS.has(t)) keywords.add(t);
  }

  // Synonyms
  for (const [canonical, alts] of Object.entries(SYNONYMS)) {
    if (keywords.has(canonical) || alts.some(a => keywords.has(a))) {
      keywords.add(canonical);
      alts.forEach(a => keywords.add(a));
    }
  }

  return keywords;
}

// ── Semantic keyword matcher via Gemini ───────────────────────────────────
// Runs only on keywords that didn't match via exact/substring.
// Returns a Set of JD keywords that are semantically covered by the resume.
async function semanticMatch(unmatchedKeywords, resumeText) {
  if (!unmatchedKeywords.length || !GEMINI_API_KEY) return new Set();

  const resumeSnippet = resumeText.substring(0, 2000);
  const prompt = `You are an ATS expert checking if a resume semantically covers certain skills.

RESUME:
${resumeSnippet}

JD KEYWORDS NOT FOUND BY EXACT MATCH:
${unmatchedKeywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

For each keyword, decide if the resume SEMANTICALLY covers it — meaning the candidate has equivalent experience even if the exact word isn't used.

Examples of semantic matches:
- JD: "kafka" → Resume: "message queues" or "event streaming" → MATCH
- JD: "system design" → Resume: "designed scalable architecture" → MATCH
- JD: "kubernetes" → Resume: "container orchestration" or "k8s" → MATCH
- JD: "microservices" → Resume: "distributed services" or "service-oriented" → MATCH
- JD: "rabbitmq" → Resume: "message broker" or "async messaging" → MATCH
- JD: "code review" → Resume: "reviewed PRs" or "peer reviews" → MATCH
- JD: "data structures" → Resume: "algorithms", "DSA", "competitive programming" → MATCH

Be generous but not dishonest. If there is a reasonable equivalent, count it as matched.

Return ONLY a JSON array of the NUMBER(s) from the list that are semantically covered. Example: [1, 3, 5]
If none match, return [].`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const r = await axios.post(geminiUrl,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 200 } },
      { timeout: 20000 }
    );
    const raw = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    const indices = JSON.parse(cleaned.substring(start, end + 1));
    const matched = new Set();
    indices.forEach(i => { const kw = unmatchedKeywords[i - 1]; if (kw) matched.add(kw); });
    console.log(`[Semantic Match] ${matched.size}/${unmatchedKeywords.length} additional matches via AI`);
    return matched;
  } catch (e) {
    console.error('[Semantic Match] Failed, falling back to exact match only:', e.message);
    return new Set();
  }
}

async function computeATSScore(resume, jobDescription) {
  if (!jobDescription || jobDescription.trim().length < 50) return buildEmptyResult('JD too short');
  const jdParsed = parseJD(jobDescription);
  const resumeParsed = parseResume(resume);

  const hasPreferred = jdParsed.preferred.length > 0;

  // ── Pass 1: exact + substring match ──────────────────────────────────
  const exactMatch = (kw) =>
    resumeParsed.keywords.has(kw) ||
    [...resumeParsed.keywords].some(rk => kw.includes(rk) || rk.includes(kw));

  const reqExactMatched = jdParsed.required.filter(exactMatch);
  const reqExactMissing = jdParsed.required.filter(kw => !reqExactMatched.includes(kw));
  const prefExactMatched = hasPreferred ? jdParsed.preferred.filter(exactMatch) : [];
  const prefExactMissing = hasPreferred ? jdParsed.preferred.filter(kw => !prefExactMatched.includes(kw)) : [];

  // ── Pass 2: Gemini semantic match on the remaining ones ───────────────
  const allUnmatched = [...new Set([...reqExactMissing, ...prefExactMissing])];
  const semanticallyMatched = await semanticMatch(allUnmatched, resume);

  // ── Merge ─────────────────────────────────────────────────────────────
  const requiredMatched = [...reqExactMatched, ...reqExactMissing.filter(k => semanticallyMatched.has(k))];
  const requiredMissing  = jdParsed.required.filter(kw => !requiredMatched.includes(kw));
  const preferredMatched = [...prefExactMatched, ...prefExactMissing.filter(k => semanticallyMatched.has(k))];
  const preferredMissing = jdParsed.preferred.filter(kw => !preferredMatched.includes(kw));

  // ── Score ─────────────────────────────────────────────────────────────
  const requiredTotal  = Math.max(jdParsed.required.length, 1);
  const requiredWeight = hasPreferred ? 50 : 80;
  const requiredScore  = Math.round((requiredMatched.length / requiredTotal) * requiredWeight);

  let preferredScore = 0, preferredMaxScore = 30;
  if (hasPreferred) {
    preferredScore = Math.round((preferredMatched.length / jdParsed.preferred.length) * 30);
  } else {
    preferredMaxScore = 0;
  }

  const formatResult  = scoreFormat(resume);
  const contentResult = scoreContent(resume);
  const totalScore    = Math.min(100, requiredScore + preferredScore + formatResult.score + contentResult.score);

  let experienceMatch = null;
  if (jdParsed.yearsRequired && resumeParsed.yearsExp) {
    experienceMatch = {
      required: jdParsed.yearsRequired,
      found: resumeParsed.yearsExp,
      meets: resumeParsed.yearsExp >= jdParsed.yearsRequired,
    };
  }

  function dedupeKeywords(keywords) {
    const arr = [...keywords];
    return arr.filter(kw => {
      if (!kw.includes(' ')) {
        return !arr.some(other => other !== kw && other.includes(' ') && other.includes(kw));
      }
      return true;
    });
  }

  return {
    totalScore, passThreshold: totalScore >= 70, recommendation: getRecommendation(totalScore),
    breakdown: {
      required: {
        label: 'Required Skills', score: requiredScore, maxScore: requiredWeight,
        matched: dedupeKeywords(requiredMatched.filter(k => k.length > 2)).slice(0, 12),
        missing: dedupeKeywords(requiredMissing.filter(k => k.length > 2)).slice(0, 8),
      },
      preferred: {
        label: 'Preferred Skills', score: preferredScore, maxScore: preferredMaxScore,
        notInJD: !hasPreferred,
        matched: dedupeKeywords(preferredMatched.filter(k => k.length > 2)).slice(0, 8),
        missing: dedupeKeywords(preferredMissing.filter(k => k.length > 2)).slice(0, 6),
      },
      format: formatResult, content: contentResult,
    },
    experienceMatch,
  };
}


function scoreFormat(resume) {
  let score = 0; const checks = [];
  const sections = {
    'Experience': /\b(experience|work history|employment)\b/i.test(resume),
    'Education': /\b(education|degree|university|college|b\.tech|m\.tech)\b/i.test(resume),
    'Skills': /\b(skills|technologies|competencies|expertise)\b/i.test(resume),
    'Contact': /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(resume),
  };
  const sc = Object.values(sections).filter(Boolean).length;
  const sectionScore = Math.round((sc / 4) * 5);
  score += sectionScore;
  checks.push({ label: 'Sections detected', passed: sc >= 3, detail: `${sc}/4 sections found`, score: sectionScore, maxScore: 5 });
  const wc = resume.split(/\s+/).length;
  const lengthScore = wc >= 300 && wc <= 900 ? 3 : wc < 200 ? 0 : 1;
  score += lengthScore;
  checks.push({ label: 'Length', passed: wc >= 300, detail: `${wc} words`, score: lengthScore, maxScore: 3 });
  const hasStructure = resume.split('\n').length > 10;
  const structureScore = hasStructure ? 2 : 0;
  score += structureScore;
  checks.push({ label: 'Text structure', passed: hasStructure, detail: hasStructure ? 'ATS-friendly' : 'Add line breaks', score: structureScore, maxScore: 2 });
  return { label: 'Format & Parseability', score: Math.min(score, 10), maxScore: 10, checks };
}

function scoreContent(resume) {
  const resumeLower = resume.toLowerCase();
  let score = 0; const checks = [];
  const actionVerbs = ['led','built','designed','developed','created','implemented','launched','managed','optimized','improved','increased','reduced','achieved','drove','architected','engineered','deployed','integrated','automated','scaled','mentored','delivered'];
  const foundVerbs = actionVerbs.filter(v => resumeLower.includes(v));
  const verbScore = Math.min(Math.round((foundVerbs.length / 6) * 4), 4);
  score += verbScore;
  checks.push({ label: 'Action verbs', passed: foundVerbs.length >= 4, detail: `${foundVerbs.length} found`, score: verbScore, maxScore: 4 });
  const quantCount = (resume.match(/\b\d+[\+]?\s*(%|users|customers|engineers|projects|systems|ms|seconds|hours|days|months|years|x|k|m|million|\$)/gi) || []).length;
  const quantScore = Math.min(quantCount >= 3 ? 4 : quantCount >= 1 ? 2 : 0, 4);
  score += quantScore;
  checks.push({ label: 'Quantified achievements', passed: quantCount >= 2, detail: `${quantCount} metrics found`, score: quantScore, maxScore: 4 });
  const firstPerson = (resume.match(/\b(I |me |my |I've|I'm)\b/g) || []).length;
  const pronounScore = firstPerson === 0 ? 2 : 0;
  score += pronounScore;
  checks.push({ label: 'No first-person', passed: firstPerson === 0, detail: firstPerson === 0 ? 'Good' : `${firstPerson} pronouns`, score: pronounScore, maxScore: 2 });
  return { label: 'Content Quality', score: Math.min(score, 10), maxScore: 10, checks };
}

function buildEmptyResult(message) {
  return { totalScore: 0, passThreshold: false, recommendation: { level: 'N/A', message, color: 'error' },
    breakdown: {
      required: { label: 'Required Skills', score: 0, maxScore: 50, matched: [], missing: [] },
      preferred: { label: 'Preferred Skills', score: 0, maxScore: 30, matched: [], missing: [] },
      format: { label: 'Format', score: 0, maxScore: 10, checks: [] },
      content: { label: 'Content', score: 0, maxScore: 10, checks: [] },
    }, experienceMatch: null };
}

function getRecommendation(score) {
  if (score >= 85) return { level: 'Excellent', message: 'Strong ATS match — very likely to pass screening', color: 'success' };
  if (score >= 70) return { level: 'Good', message: 'Should pass ATS — a few keyword additions will strengthen it', color: 'warning' };
  if (score >= 55) return { level: 'Fair', message: 'May be filtered — add the missing required keywords', color: 'warning' };
  return { level: 'Needs Work', message: 'High rejection risk — resume needs significant keyword alignment', color: 'error' };
}

// ══════════════════════════════════════════════════════════════════════════
//  TONE INSTRUCTIONS (Feature 4 — Cover Letter Tone Variants)
// ══════════════════════════════════════════════════════════════════════════

const TONE_INSTRUCTIONS = {
  formal: `Write in a professional, polished tone. Use complete sentences, respectful language,
and a structured format. Avoid contractions. Mirror the formality of a senior-level business letter.`,
  conversational: `Write in a warm, human, conversational tone. Use natural language and light
contractions (I'm, I've, you'll). Sound like a real person writing to another real person, not
a template. Be genuine and direct without being casual.`,
  bold: `Write in a confident, direct, high-energy tone. Lead with impact. Use punchy sentences.
Quantify achievements aggressively. Sound like someone who knows their value and is not afraid to
show it. Avoid hedging language like "I believe" or "I think I could".`,
};

// ══════════════════════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', services: { notion: !!(NOTION_TOKEN && NOTION_DB_ID), gemini: !!GEMINI_API_KEY, slack: !!SLACK_WEBHOOK_URL } });
});

// ── Run agent ─────────────────────────────────────────────────────────────
app.post('/api/agent/run', async (req, res) => {
  try {
    // Feature 4: read tone from request body (defaults to 'formal')
    const { company, role, description, resume, tone = 'formal' } = req.body;
    if (!company || !role) return res.status(400).json({ error: 'Missing required fields' });
    if (!resume) return res.status(400).json({ error: 'Missing resume' });
    if (!GEMINI_API_KEY) return res.status(503).json({ error: 'Gemini API key not configured' });

    console.log(`[Agent] Running for ${company} — ${role} | Tone: ${tone}`);
    const atsResult = await computeATSScore(resume, description || '');
    console.log(`[ATS] Score: ${atsResult.totalScore}/100`);

    const toneGuide = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.formal;

    const prompt = `
You are an expert career advisor and job application strategist.

CANDIDATE RESUME:
${resume}

TARGET JOB:
Company: ${company}
Role: ${role}
Job Description: ${description || 'Not provided.'}

TASKS:
1. Company Research: summary, culture, tech stack, recent highlights.
2. Cover Letter: 300-400 words to Hiring Manager at ${company}. Use resume only — no invented facts.
   TONE INSTRUCTION: ${toneGuide}
3. Match Score: 0-100.
4. Key Matches: skills from resume matching the role.
5. Interview Tip: one company-specific actionable tip.
6. Skills Gap: 3-5 skills from JD to develop.

RESPOND IN EXACT JSON (no markdown):
{
  "research": { "companySummary": "...", "culture": "...", "techStack": ["..."], "recentHighlights": "..." },
  "coverLetter": "...",
  "matchScore": 85,
  "interviewTip": "...",
  "keyMatches": ["..."],
  "skillsGap": ["..."]
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await axios.post(geminiUrl, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7 } }, { timeout: 60000 });
    const rawText = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) { return res.status(500).json({ error: 'AI response parsing failed' }); }

    res.json({
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
      skillsGap: Array.isArray(parsed.skillsGap) ? parsed.skillsGap : [],
      ats: atsResult,
    });
  } catch (err) {
    console.error('[Agent] Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Agent failed', message: err.response?.data?.error?.message || err.message });
  }
});

// ── Interview Prep Questions ─────────────────────────────────────────────
app.post('/api/interview/prep', async (req, res) => {
  try {
    const { company, role, description, resume } = req.body;
    if (!company || !role) return res.status(400).json({ error: 'company and role required' });
    if (!GEMINI_API_KEY) return res.status(503).json({ error: 'Gemini not configured' });

    console.log(`[Interview Prep] Generating for ${company} — ${role}`);

    const jdSnippet = (description || '').substring(0, 1500);
    const resumeSnippet = (resume || '').substring(0, 800);

    const prompt = `You are a senior interview coach at a top tech company. Generate 18 realistic interview questions for a ${role} position at ${company}.

JOB DESCRIPTION: ${jdSnippet}
CANDIDATE RESUME: ${resumeSnippet}

Generate questions in these categories:
- 4 BEHAVIORAL (STAR method, past experiences)
- 6 TECHNICAL (specific to role, tools in JD, system design)
- 3 PROBLEM SOLVING (analytical, case-based)
- 2 COMPANY-SPECIFIC (about ${company}'s products, mission, culture)
- 2 LEADERSHIP (ownership, conflict, team situations)
- 1 CURVEBALL (unexpected, tests thinking)

For each question give:
- category (one of: BEHAVIORAL, TECHNICAL, PROBLEM SOLVING, COMPANY-SPECIFIC, LEADERSHIP, CURVEBALL)
- question (the actual question text)
- outline (3-4 bullet points for a strong answer)
- tip (one sentence on what the interviewer is really looking for)

Return ONLY a valid JSON object. No markdown. No explanation. Start directly with {:
{"questions":[{"category":"BEHAVIORAL","question":"...","outline":["...","...","..."],"tip":"..."}]}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const r = await axios.post(geminiUrl,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 4000 } },
      { timeout: 60000 }
    );

    const rawText = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`[Interview Prep] Raw length: ${rawText.length}`);

    let cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) cleaned = cleaned.substring(jsonStart, jsonEnd + 1);

    const fallback = { questions: [
      { category: 'BEHAVIORAL', question: `Tell me about a time you built something from scratch as a ${role}. What was your process?`, outline: ['Set context — what was the problem and constraints', 'Walk through your design decisions', 'Explain what you built and how', 'Share the measurable outcome or impact'], tip: 'Interviewers want to see ownership and end-to-end thinking.' },
      { category: 'BEHAVIORAL', question: 'Describe a situation where you disagreed with your team lead. How did you handle it?', outline: ['State the disagreement clearly and professionally', 'Explain your reasoning and how you communicated it', 'Describe what happened — did you escalate or compromise?', 'Share what you learned'], tip: 'Tests emotional maturity and communication skills.' },
      { category: 'TECHNICAL', question: `What tech stack would you choose for this ${role} role at ${company} and why?`, outline: ['Identify core requirements from the JD', 'Propose your stack with clear reasoning', 'Address scalability and trade-offs', 'Mention alternatives you considered'], tip: 'Shows structured thinking and depth — not just name-dropping.' },
      { category: 'COMPANY-SPECIFIC', question: `Why ${company} specifically — what about their product or mission excites you?`, outline: [`Research ${company}'s recent launches or news`, 'Connect their product to a problem you care about', 'Mention a specific team or technical challenge you want to work on', 'Show you understand their business, not just the brand'], tip: 'Generic "great company culture" answers are red flags. Be specific.' },
      { category: 'CURVEBALL', question: 'If you could only use one metric to measure the success of a software product, what would it be and why?', outline: ['Acknowledge there is no perfect single metric', 'Pick one and defend it clearly (DAU, retention, error rate, NPS...)', 'Explain what it captures and what it misses', 'Show you understand the trade-offs'], tip: 'Tests product thinking and your ability to defend a position under ambiguity.' },
    ]};

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      console.error('[Interview Prep] JSON parse failed — using fallback');
      return res.json(fallback);
    }

    const questions = parsed.questions && parsed.questions.length >= 5 ? parsed.questions : fallback.questions;
    console.log(`[Interview Prep] Done — ${questions.length} questions`);
    res.json({ questions });
  } catch (err) {
    console.error('[Interview Prep] Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed', message: err.response?.data?.error?.message || err.message });
  }
});

// ── LinkedIn Outreach (Feature 5) ─────────────────────────────────────────
app.post('/api/linkedin/outreach', async (req, res) => {
  try {
    const { company, role, resume } = req.body;
    if (!company || !role) return res.status(400).json({ error: 'company and role required' });
    if (!GEMINI_API_KEY) return res.status(503).json({ error: 'Gemini not configured' });

    console.log(`[LinkedIn] Generating outreach for ${company} — ${role}`);
    const resumeSnippet = (resume || '').substring(0, 600);

    const prompt = `You are a career coach helping a candidate write a cold LinkedIn connection message.

CANDIDATE BACKGROUND (from resume):
${resumeSnippet}

TARGET:
Company: ${company}
Role: ${role}

Write 3 different cold LinkedIn outreach messages the candidate can send to a hiring manager or recruiter at ${company}.
Each message must:
- Be under 300 characters (LinkedIn's connection note limit)
- Feel human and specific — NOT a template
- Reference something real about ${company} or the ${role} role
- End with a clear, low-friction ask (e.g. "Would love to connect." or "Open to a quick chat?")
- NOT use "I came across your profile" — that's overused

Return ONLY valid JSON, no markdown:
{
  "messages": [
    { "label": "Direct", "text": "..." },
    { "label": "Curious", "text": "..." },
    { "label": "Value-first", "text": "..." }
  ]
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const r = await axios.post(geminiUrl,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 800 } },
      { timeout: 30000 }
    );

    const rawText = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) cleaned = cleaned.substring(jsonStart, jsonEnd + 1);

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      parsed = { messages: [
        { label: 'Direct', text: `Hi! I'm exploring ${role} roles and ${company}'s work stands out. I'd love to connect and learn more about the team. Open to a quick chat?` },
        { label: 'Curious', text: `I've been following ${company}'s growth and the engineering challenges you're solving genuinely excite me. Would love to connect as a ${role} candidate!` },
        { label: 'Value-first', text: `I've built systems similar to what ${company} is working on and would bring a strong perspective to your ${role} team. Would love to connect.` },
      ]};
    }

    // Enforce 300 char limit
    parsed.messages = (parsed.messages || []).map(m => ({
      label: m.label,
      text: m.text.length > 300 ? m.text.substring(0, 297) + '...' : m.text,
      chars: m.text.length,
    }));

    console.log(`[LinkedIn] Done — ${parsed.messages.length} messages`);
    res.json(parsed);
  } catch (err) {
    console.error('[LinkedIn] Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed', message: err.message });
  }
});

// ── Resume Optimizer ──────────────────────────────────────────────────────
app.post('/api/resume/optimize', async (req, res) => {
  try {
    const { resume, missingKeywords, role, company } = req.body;
    if (!resume) return res.status(400).json({ error: 'resume required' });
    if (!GEMINI_API_KEY) return res.status(503).json({ error: 'Gemini not configured' });

    console.log(`[Resume Optimizer] Running for ${company} — ${role}`);
    const keywordList = (missingKeywords || []).slice(0, 15).join(', ');

    const prompt = `You are an expert resume writer who helps candidates pass ATS systems without keyword stuffing.

CANDIDATE'S CURRENT RESUME:
${resume}

TARGET ROLE: ${role} at ${company}
MISSING KEYWORDS FROM JD: ${keywordList || 'General improvements needed'}

YOUR TASK:
Rewrite specific resume bullet points to naturally incorporate the missing keywords.
Rules:
- ONLY rewrite bullets that can genuinely include a missing keyword — don't force it
- Each rewrite must sound natural, specific, and achievement-focused
- Keep the same role/experience context — don't invent new experiences
- Use strong action verbs and quantify where possible
- Show BEFORE and AFTER for each changed bullet
- Also suggest 2-3 new bullet points the candidate could add if they have relevant experience
- Focus on the top 5-8 most impactful missing keywords

Return ONLY valid JSON, no markdown:
{
  "optimizedBullets": [
    {
      "original": "Built REST APIs for the platform",
      "optimized": "Designed and implemented RESTful APIs using Node.js with microservices architecture, reducing response time by 40%",
      "keywordsAdded": ["microservices architecture", "node.js"],
      "section": "Experience"
    }
  ],
  "suggestedNewBullets": [
    {
      "bullet": "Implemented CI/CD pipelines using Jenkins and Docker, automating deployment across staging and production environments",
      "keywordsAdded": ["ci/cd pipeline", "docker", "jenkins"],
      "note": "Add this if you have CI/CD experience"
    }
  ],
  "keywordsStillMissing": ["kafka", "kubernetes"],
  "summary": "3 bullets optimized, 8 keywords added. Focus on adding Kafka and Kubernetes to a project or skills section."
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const r = await axios.post(geminiUrl,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 4000 } },
      { timeout: 60000 }
    );

    const rawText = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) cleaned = cleaned.substring(jsonStart, jsonEnd + 1);

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      console.error('[Resume Optimizer] JSON parse failed');
      return res.status(500).json({ error: 'AI response parsing failed' });
    }

    console.log(`[Resume Optimizer] Done — ${(parsed.optimizedBullets||[]).length} bullets optimized`);
    res.json({
      optimizedBullets: parsed.optimizedBullets || [],
      suggestedNewBullets: parsed.suggestedNewBullets || [],
      keywordsStillMissing: parsed.keywordsStillMissing || [],
      summary: parsed.summary || '',
    });
  } catch (err) {
    console.error('[Resume Optimizer] Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed', message: err.message });
  }
});

// ── Notion: Save ──────────────────────────────────────────────────────────
app.post('/api/notion/save', async (req, res) => {
  try {
    const { company, role, status, matchScore, coverLetter, notes, dateApplied } = req.body;
    if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(503).json({ error: 'Notion not configured' });

    const truncate = (str, max = 1999) => (str || '').substring(0, max);

    const response = await axios.post('https://api.notion.com/v1/pages',
      {
        parent: { database_id: NOTION_DB_ID },
        properties: {
          Company: { title: [{ text: { content: truncate(company, 100) } }] },
          Role: { rich_text: [{ text: { content: truncate(role, 200) } }] },
          Status: { select: { name: status || 'Applied' } },
          'Match Score': { rich_text: [{ text: { content: String(matchScore || '') } }] },
          'Date Applied': { date: { start: dateApplied || new Date().toISOString().split('T')[0] } },
          'Cover Letter': { rich_text: [{ text: { content: truncate(coverLetter) } }] },
          Notes: { rich_text: [{ text: { content: truncate(notes) } }] },
        },
      },
      { headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    console.log(`[Notion] Saved: ${company} — ${role}`);
    res.json({ success: true, id: response.data.id });
  } catch (err) {
    console.error('[Notion] Save error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to save', message: err.response?.data?.message || err.message });
  }
});

// ── Notion: Delete ────────────────────────────────────────────────────────
app.post('/api/notion/delete', async (req, res) => {
  try {
    const { pageId } = req.body;
    console.log('[Notion] Delete request for pageId:', pageId);
    if (!pageId) return res.status(400).json({ error: 'pageId required' });
    if (!NOTION_TOKEN) return res.status(503).json({ error: 'Notion not configured' });

    const response = await axios.patch(
      `https://api.notion.com/v1/pages/${pageId}`,
      { archived: true },
      { headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    console.log('[Notion] Archived successfully:', response.data.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Notion] Delete error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to delete', message: err.response?.data?.message || err.message });
  }
});

// ── Notion: Update Status ─────────────────────────────────────────────────
app.patch('/api/notion/update-status', async (req, res) => {
  try {
    const { pageId, status } = req.body;
    if (!pageId || !status) return res.status(400).json({ error: 'pageId and status required' });
    if (!NOTION_TOKEN) return res.status(503).json({ error: 'Notion not configured' });

    console.log(`[Notion] Updating ${pageId} → ${status}`);
    const response = await axios.patch(`https://api.notion.com/v1/pages/${pageId}`,
      { properties: { Status: { select: { name: status } } } },
      { headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    console.log(`[Notion] Status updated ✓`);
    res.json({ success: true, id: response.data.id });
  } catch (err) {
    console.error('[Notion] Update error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to update', message: err.response?.data?.message || err.message });
  }
});

// ── Notion: Fetch Applications ────────────────────────────────────────────
app.get('/api/notion/applications', async (_req, res) => {
  try {
    if (!NOTION_TOKEN || !NOTION_DB_ID) return res.status(503).json({ error: 'Notion not configured' });
    const response = await axios.post(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {},
      { headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const applications = response.data.results.map(page => {
      const p = page.properties;
      return {
        id: page.id,
        company: p['Company']?.title?.[0]?.text?.content || '',
        role: p['Role']?.rich_text?.[0]?.text?.content || '',
        status: p['Status']?.select?.name || '',
        matchScore: p['Match Score']?.rich_text?.[0]?.text?.content || '',
        dateApplied: p['Date Applied']?.date?.start || '',
        url: page.url,
      };
    });
    console.log(`[Notion] Retrieved ${applications.length} applications`);
    res.json(applications);
  } catch (err) {
    console.error('[Notion] Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed', message: err.response?.data?.message || err.message });
  }
});

// ── Slack ─────────────────────────────────────────────────────────────────
app.post('/api/slack/notify', async (req, res) => {
  try {
    const { company, role, matchScore, status = 'Applied' } = req.body;
    if (!SLACK_WEBHOOK_URL) return res.json({ success: false });
    const scoreEmoji = matchScore >= 80 ? '🟢' : matchScore >= 60 ? '🟡' : matchScore >= 40 ? '🟠' : '🔴';
    await axios.post(SLACK_WEBHOOK_URL, {
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '🚀 New Job Application Filed!' } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: `*🏢 Company:*\n${company}` },
          { type: 'mrkdwn', text: `*💼 Role:*\n${role || 'N/A'}` },
          { type: 'mrkdwn', text: `*${scoreEmoji} Match:*\n${matchScore != null ? `${matchScore}%` : 'N/A'}` },
          { type: 'mrkdwn', text: `*📋 Status:*\n${status}` },
        ]},
        { type: 'context', elements: [{ type: 'mrkdwn', text: `📅 ${new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}` }] },
      ],
    }, { timeout: 10000 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Slack failed', message: err.message });
  }
});

// ── Gmail ─────────────────────────────────────────────────────────────────
app.post('/api/gmail/draft', (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'to and subject required' });
    res.json({ success: true, mailtoUrl: `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body || '')}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed', message: err.message });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   🚀  ApplyIQ — Job Application Agent       ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   Port     : ${String(PORT).padEnd(31)}║`);
  console.log(`║   Notion   : ${(NOTION_TOKEN ? '✅ Connected' : '❌ Not configured').padEnd(31)}║`);
  console.log(`║   Gemini   : ${(GEMINI_API_KEY ? '✅ Connected' : '❌ Not configured').padEnd(31)}║`);
  console.log(`║   Slack    : ${(SLACK_WEBHOOK_URL ? '✅ Connected' : '❌ Not configured').padEnd(31)}║`);
  console.log(`║   ATS      : ${'✅ Real JD-Based'.padEnd(31)}║`);
  console.log(`║   Features : ${'✅ Tone · LinkedIn · Interview Prep'.padEnd(31)}║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n   → http://localhost:${PORT}\n`);
});