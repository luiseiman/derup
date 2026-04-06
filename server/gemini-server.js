import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || process.env.GEMINI_PORT || 8787);
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const DIST_DIR = path.resolve(process.cwd(), 'dist');

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB

const CONTENT_TYPE_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);

const loadDotEnv = () => {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    const value = rest.join('=').trim();
    if (!key || process.env[key] !== undefined) return;
    process.env[key] = value;
  });
};

loadDotEnv();

const rooms = new Map(); // roomId -> { nodes, connections, aggregations, clients: Set }

const getOrCreateRoom = (roomId) => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { nodes: [], connections: [], aggregations: [], clients: new Set() });
  }
  return rooms.get(roomId);
};

// Clean up empty rooms every 10 minutes
setInterval(() => {
  for (const [id, room] of rooms.entries()) {
    if (room.clients.size === 0) rooms.delete(id);
  }
}, 10 * 60 * 1000);

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const sendFile = (req, res, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
  const basename = path.basename(filePath);

  // Cache: hashed Vite assets → 1 year, index.html → no-cache
  const isHashed = /\.[a-f0-9]{8,}\.\w+$/.test(basename);
  const cacheControl = isHashed
    ? 'public, max-age=31536000, immutable'
    : ext === '.html'
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=3600';

  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Vary': 'Accept-Encoding',
  };

  const acceptEncoding = (req.headers['accept-encoding'] || '').toString();
  const canGzip = COMPRESSIBLE.has(ext) && acceptEncoding.includes('gzip');

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    sendJson(res, 500, { error: 'Error serving static file.' });
  });

  if (canGzip) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    pipeline(stream, zlib.createGzip({ level: 6 }), res, () => {});
  } else {
    res.writeHead(200, headers);
    stream.pipe(res);
  }
};

const serveSpa = (req, res, pathname) => {
  if (!fs.existsSync(DIST_DIR)) {
    sendJson(res, 503, { error: 'Frontend dist no disponible. Ejecuta npm run build.' });
    return true;
  }

  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let candidate = path.join(DIST_DIR, safePath);
  if (!candidate.startsWith(DIST_DIR)) {
    sendJson(res, 400, { error: 'Invalid path.' });
    return true;
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    sendFile(req, res, candidate);
    return true;
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    const indexInFolder = path.join(candidate, 'index.html');
    if (fs.existsSync(indexInFolder)) {
      sendFile(req, res, indexInFolder);
      return true;
    }
  }

  const indexPath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    sendJson(res, 404, { error: 'Static index not found.' });
    return true;
  }
  sendFile(req, res, indexPath);
  return true;
};

const normalizeError = (error, fallback = 'Server error.') => {
  if (!error) return fallback;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message.trim() || fallback;
  }
  return fallback;
};

const getBody = req =>
  new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large.'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const resolveGeminiApiKey = body => {
    const requestKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const envKey = typeof process.env.GEMINI_API_KEY === 'string' ? process.env.GEMINI_API_KEY.trim() : '';
    return requestKey || envKey;
  };
  const resolveGrokApiKey = body => {
    const requestKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const envXAI = typeof process.env.XAI_API_KEY === 'string' ? process.env.XAI_API_KEY.trim() : '';
    const envGrok = typeof process.env.GROK_API_KEY === 'string' ? process.env.GROK_API_KEY.trim() : '';
    return requestKey || envXAI || envGrok;
  };
  const resolveOpenclawToken = body => {
    const requestKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const envToken = typeof process.env.OPENCLAW_TOKEN === 'string' ? process.env.OPENCLAW_TOKEN.trim() : '';
    return requestKey || envToken;
  };
  const resolveOpenaiApiKey = body => {
    const requestKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const envKey = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
    return requestKey || envKey;
  };

  // ── ChatGPT OAuth token manager ──────────────────────────────────────────
  const CHATGPT_API_URL = 'https://chatgpt.com/backend-api/codex/responses';
  const CHATGPT_MODEL = 'gpt-5.4';
  const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
  const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
  const OAUTH_TOKEN_FILE = path.join(process.cwd(), '.oauth-tokens.json');
  const OAUTH_REFRESH_BUFFER_MS = 60_000;

  function decodeJwtPayload(token) {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()); }
    catch { return null; }
  }

  function readOAuthTokens() {
    try { return JSON.parse(fs.readFileSync(OAUTH_TOKEN_FILE, 'utf-8')); }
    catch { return null; }
  }

  function saveOAuthTokens(tokens) {
    fs.writeFileSync(OAUTH_TOKEN_FILE, JSON.stringify(tokens, null, 2));
  }

  async function refreshOAuthTokens(tokens) {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: OAUTH_CLIENT_ID,
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
    const json = await res.json();
    if (!json.access_token || !json.refresh_token) throw new Error('Token refresh incomplete');
    const payload = decodeJwtPayload(json.access_token);
    const auth = payload?.['https://api.openai.com/auth'];
    const updated = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + (json.expires_in ?? 3600) * 1000,
      account_id: auth?.chatgpt_account_id ?? tokens.account_id,
      email: tokens.email,
      updated_at: new Date().toISOString(),
    };
    saveOAuthTokens(updated);
    return updated;
  }

  async function getOAuthCredentials() {
    let tokens = readOAuthTokens();
    if (!tokens) return null;
    if (Date.now() >= tokens.expires_at - OAUTH_REFRESH_BUFFER_MS) {
      try { tokens = await refreshOAuthTokens(tokens); }
      catch (err) {
        console.error('[oauth] Refresh failed:', err.message);
        if (Date.now() >= tokens.expires_at) return null;
      }
    }
    return { accessToken: tokens.access_token, accountId: tokens.account_id };
  }

  async function parseChatGPTSSE(response) {
    const text = await response.text();
    let result = '';
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;
      try {
        const event = JSON.parse(data);
        if (event.type === 'response.output_text.delta' && event.delta) result += event.delta;
        if (event.type === 'response.content_part.delta' && event.delta?.text) result += event.delta.text;
        if (event.type === 'error' || event.type === 'response.failed') {
          throw new Error(event.error?.message ?? 'ChatGPT error');
        }
      } catch (e) { if (e.message === 'ChatGPT error') throw e; }
    }
    return result;
  }

  const parseJsonResponse = async (response, fallbackMessage) => {
    const rawText = await response.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = {
        error: {
          message: rawText.slice(0, 400) || fallbackMessage,
        },
      };
    }
    return data;
  };

  const fetchGeminiModels = async apiKey => {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey,
      },
    });
    const data = await parseJsonResponse(response, 'Respuesta no JSON desde Gemini.');
    if (!response.ok) {
      return { ok: false, status: response.status, data };
    }
    const models = Array.isArray(data?.models)
      ? data.models
        .filter(model => Array.isArray(model?.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
        .map(model => (typeof model?.name === 'string' ? model.name.replace(/^models\//, '') : ''))
        .filter(Boolean)
      : [];
    return { ok: true, status: 200, models };
  };

  const fetchGrokModels = async apiKey => {
    const response = await fetch('https://api.x.ai/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const data = await parseJsonResponse(response, 'Respuesta no JSON desde Grok.');
    if (!response.ok) {
      return { ok: false, status: response.status, data };
    }
    const models = Array.isArray(data?.data)
      ? data.data
        .map(model => (typeof model?.id === 'string' ? model.id : ''))
        .filter(Boolean)
      : [];
    return { ok: true, status: 200, models };
  };

  const fetchOpenaiModels = async apiKey => {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const data = await parseJsonResponse(response, 'Respuesta no JSON desde OpenAI.');
    if (!response.ok) {
      return { ok: false, status: response.status, data };
    }
    const models = Array.isArray(data?.data)
      ? data.data
        .map(model => (typeof model?.id === 'string' ? model.id : ''))
        .filter(id => id.startsWith('gpt'))
        .sort()
      : [];
    return { ok: true, status: 200, models };
  };

  if (req.method === 'POST' && url.pathname === '/api/gemini/health') {
    try {
      const body = await getBody(req);
      const apiKeyToUse = resolveGeminiApiKey(body);
      if (!apiKeyToUse) {
        sendJson(res, 401, { error: 'Missing Gemini API key.' });
        return;
      }

      const modelsResponse = await fetchGeminiModels(apiKeyToUse);
      if (!modelsResponse.ok) {
        sendJson(res, modelsResponse.status, { error: modelsResponse.data?.error?.message || 'Gemini API error.' });
        return;
      }
      sendJson(res, 200, { status: 'ok', models: modelsResponse.models });
    } catch {
      sendJson(res, 500, { error: 'Server error in /api/gemini/health.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/gemini/models') {
    try {
      const body = await getBody(req);
      const apiKeyToUse = resolveGeminiApiKey(body);
      if (!apiKeyToUse) {
        sendJson(res, 401, { error: 'Missing Gemini API key.' });
        return;
      }

      const modelsResponse = await fetchGeminiModels(apiKeyToUse);
      if (!modelsResponse.ok) {
        sendJson(res, modelsResponse.status, { error: modelsResponse.data?.error?.message || 'Gemini API error.' });
        return;
      }

      sendJson(res, 200, { models: modelsResponse.models });
    } catch (error) {
      sendJson(res, 500, { error: `Server error in /api/gemini/models: ${normalizeError(error)}` });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/gemini') {
    try {
      const body = await getBody(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gemini-2.5-pro';
      const apiKeyToUse = resolveGeminiApiKey(body);
      if (!apiKeyToUse) {
        sendJson(res, 401, { error: 'Missing Gemini API key.' });
        return;
      }
      if (!prompt) {
        sendJson(res, 400, { error: 'Missing prompt.' });
        return;
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKeyToUse,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
        }),
      });

      const data = await parseJsonResponse(response, 'Respuesta no JSON desde Gemini.');
      if (!response.ok) {
        sendJson(res, response.status, { error: data.error?.message || 'Gemini API error.' });
        return;
      }

      const text =
        data?.candidates?.[0]?.content?.parts
          ?.map(part => part.text || '')
          .join('')
          .trim() || '';

      sendJson(res, 200, { text });
    } catch (error) {
      sendJson(res, 500, { error: `Server error in /api/gemini: ${normalizeError(error)}` });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/grok/health') {
    try {
      const body = await getBody(req);
      const apiKeyToUse = resolveGrokApiKey(body);
      if (!apiKeyToUse) {
        sendJson(res, 401, { error: 'Missing Grok API key.' });
        return;
      }

      const modelsResponse = await fetchGrokModels(apiKeyToUse);
      if (!modelsResponse.ok) {
        sendJson(res, modelsResponse.status, { error: modelsResponse.data?.error?.message || 'Grok API error.' });
        return;
      }
      sendJson(res, 200, { status: 'ok', models: modelsResponse.models });
    } catch (error) {
      sendJson(res, 500, { error: `Server error in /api/grok/health: ${normalizeError(error)}` });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/grok/models') {
    try {
      const body = await getBody(req);
      const apiKeyToUse = resolveGrokApiKey(body);
      if (!apiKeyToUse) {
        sendJson(res, 401, { error: 'Missing Grok API key.' });
        return;
      }

      const modelsResponse = await fetchGrokModels(apiKeyToUse);
      if (!modelsResponse.ok) {
        sendJson(res, modelsResponse.status, { error: modelsResponse.data?.error?.message || 'Grok API error.' });
        return;
      }

      sendJson(res, 200, { models: modelsResponse.models });
    } catch (error) {
      sendJson(res, 500, { error: `Server error in /api/grok/models: ${normalizeError(error)}` });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/grok') {
    try {
      const body = await getBody(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'grok-3-mini';
      const apiKeyToUse = resolveGrokApiKey(body);
      if (!apiKeyToUse) {
        sendJson(res, 401, { error: 'Missing Grok API key.' });
        return;
      }
      if (!prompt) {
        sendJson(res, 400, { error: 'Missing prompt.' });
        return;
      }

      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKeyToUse}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.2,
        }),
      });

      const data = await parseJsonResponse(response, 'Respuesta no JSON desde Grok.');
      if (!response.ok) {
        sendJson(res, response.status, {
          error:
            data?.error?.message ||
            data?.message ||
            'Grok API error.',
        });
        return;
      }

      const text =
        typeof data?.choices?.[0]?.message?.content === 'string'
          ? data.choices[0].message.content.trim()
          : '';

      sendJson(res, 200, { text });
    } catch (error) {
      sendJson(res, 500, { error: `Server error in /api/grok: ${normalizeError(error)}` });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/openclaw/health') {
    try {
      const body = await getBody(req);
      const token = resolveOpenclawToken(body);
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'openclaw/main';
      const healthHeaders = { 'Content-Type': 'application/json' };
      if (token) healthHeaders['Authorization'] = `Bearer ${token}`;
      const response = await fetch('http://localhost:18789/v1/chat/completions', {
        method: 'POST',
        headers: healthHeaders,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 5,
        }),
      });
      const data = await parseJsonResponse(response, 'Respuesta no JSON desde OpenClaw.');
      if (!response.ok) {
        sendJson(res, response.status, { error: data?.error?.message || data?.message || 'OpenClaw API error.' });
        return;
      }
      sendJson(res, 200, { status: 'ok', model });
    } catch (error) {
      sendJson(res, 500, { error: `Server error in /api/openclaw/health: ${normalizeError(error)}` });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/openclaw/models') {
    // Fetch models dynamically from OpenClaw gateway
    try {
      const token = resolveOpenclawToken({});
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch('http://localhost:18789/v1/models', { headers });
      if (resp.ok) {
        const data = await resp.json();
        const models = (data?.data || []).map(m => m.id);
        sendJson(res, 200, { models });
        return;
      }
    } catch { /* fallback below */ }
    sendJson(res, 200, { models: ['openclaw'] });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/openclaw') {
    try {
      const body = await getBody(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'openclaw/main';
      const token = resolveOpenclawToken(body);
      if (!prompt) {
        sendJson(res, 400, { error: 'Missing prompt.' });
        return;
      }
      const clawHeaders = { 'Content-Type': 'application/json' };
      if (token) clawHeaders['Authorization'] = `Bearer ${token}`;

      const response = await fetch('http://localhost:18789/v1/chat/completions', {
        method: 'POST',
        headers: clawHeaders,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await parseJsonResponse(response, 'Respuesta no JSON desde OpenClaw.');
      if (!response.ok) {
        sendJson(res, response.status, {
          error: data?.error?.message || data?.message || 'OpenClaw API error.',
        });
        return;
      }

      const text =
        typeof data?.choices?.[0]?.message?.content === 'string'
          ? data.choices[0].message.content.trim()
          : '';

      sendJson(res, 200, { text });
    } catch (error) {
      sendJson(res, 500, { error: `Server error in /api/openclaw: ${normalizeError(error)}` });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/openai/models') {
    // ChatGPT OAuth: return fixed model
    const creds = await getOAuthCredentials();
    if (!creds) {
      sendJson(res, 401, { error: 'OAuth no configurado. Ejecutá: node scripts/openai-oauth-login.mjs' });
      return;
    }
    sendJson(res, 200, { models: [CHATGPT_MODEL] });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/openai') {
    try {
      const body = await getBody(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) {
        sendJson(res, 400, { error: 'Missing prompt.' });
        return;
      }

      const creds = await getOAuthCredentials();
      if (!creds) {
        sendJson(res, 401, { error: 'OAuth no configurado. Ejecutá: node scripts/openai-oauth-login.mjs' });
        return;
      }

      const headers = {
        'Authorization': `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'OpenAI-Beta': 'responses=experimental',
      };
      if (creds.accountId) headers['chatgpt-account-id'] = creds.accountId;

      const systemPrompt = typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
        ? body.systemPrompt.trim() : undefined;

      const requestBody = {
        model: CHATGPT_MODEL,
        stream: true,
        store: false,
        ...(systemPrompt ? { instructions: systemPrompt } : {}),
        input: [{ role: 'user', content: prompt }],
        reasoning: { effort: 'high' },
      };

      const response = await fetch(CHATGPT_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        sendJson(res, response.status, { error: `ChatGPT API error (${response.status}): ${errText.slice(0, 300)}` });
        return;
      }

      const text = await parseChatGPTSSE(response);
      sendJson(res, 200, { text });
    } catch (error) {
      sendJson(res, 500, { error: `Server error in /api/openai: ${normalizeError(error)}` });
    }
    return;
  }

  // ── Shared learning system (server-side, multi-user) ─────────────────────
  const LEARNING_FILE = path.join(process.cwd(), 'learning.json');

  function readLearning() {
    try { return JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf-8')); }
    catch { return { hints: {}, examples: [], domain: {} }; }
  }

  function saveLearning(data) {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(data, null, 2));
  }

  // GET /api/learning — read all learning data
  if (req.method === 'GET' && url.pathname === '/api/learning') {
    const data = readLearning();
    // Only return promoted hints (count >= threshold)
    const threshold = 3;
    const promotedHints = Object.entries(data.hints || {})
      .filter(([, v]) => v.count >= threshold)
      .map(([, v]) => v.text);
    sendJson(res, 200, {
      hints: promotedHints,
      examples: (data.examples || []).slice(-10),
      domain: data.domain || {},
    });
    return;
  }

  // POST /api/learning/hint — report a hint (increments counter)
  if (req.method === 'POST' && url.pathname === '/api/learning/hint') {
    try {
      const body = await getBody(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) { sendJson(res, 400, { error: 'Missing hint text' }); return; }
      const key = text.toLowerCase().replace(/\s+/g, ' ');
      const data = readLearning();
      if (!data.hints) data.hints = {};
      if (data.hints[key]) {
        data.hints[key].count += 1;
        data.hints[key].lastReported = new Date().toISOString();
      } else {
        data.hints[key] = { text, count: 1, firstReported: new Date().toISOString(), lastReported: new Date().toISOString() };
      }
      saveLearning(data);
      sendJson(res, 200, { count: data.hints[key].count, promoted: data.hints[key].count >= 3 });
    } catch (error) {
      sendJson(res, 500, { error: normalizeError(error) });
    }
    return;
  }

  // POST /api/learning/example — save a successful few-shot example
  if (req.method === 'POST' && url.pathname === '/api/learning/example') {
    try {
      const body = await getBody(req);
      const input = typeof body.input === 'string' ? body.input.trim() : '';
      const output = typeof body.output === 'string' ? body.output.trim() : '';
      if (!input || !output) { sendJson(res, 400, { error: 'Missing input/output' }); return; }
      const data = readLearning();
      if (!data.examples) data.examples = [];
      // Dedup by input
      if (!data.examples.some(ex => ex.input === input)) {
        data.examples.push({ input: input.slice(0, 150), output: output.slice(0, 300), ts: new Date().toISOString() });
        if (data.examples.length > 30) data.examples = data.examples.slice(-30);
        saveLearning(data);
      }
      sendJson(res, 200, { saved: true });
    } catch (error) {
      sendJson(res, 500, { error: normalizeError(error) });
    }
    return;
  }

  // POST /api/learning/domain — save domain knowledge
  if (req.method === 'POST' && url.pathname === '/api/learning/domain') {
    try {
      const body = await getBody(req);
      const domain = typeof body.domain === 'string' ? body.domain.trim() : '';
      const entities = Array.isArray(body.entities) ? body.entities.filter(e => typeof e === 'string') : [];
      if (!domain || entities.length === 0) { sendJson(res, 400, { error: 'Missing domain/entities' }); return; }
      const data = readLearning();
      if (!data.domain) data.domain = {};
      const existing = data.domain[domain] || [];
      data.domain[domain] = [...new Set([...existing, ...entities])].slice(0, 30);
      saveLearning(data);
      sendJson(res, 200, { saved: true });
    } catch (error) {
      sendJson(res, 500, { error: normalizeError(error) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const roomId = Math.random().toString(36).slice(2, 10);
    getOrCreateRoom(roomId);
    sendJson(res, 200, { roomId });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
    serveSpa(req, res, url.pathname);
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

// ── Connection tuning for 100+ concurrent users ────────────────────────────
server.keepAliveTimeout = 65_000;   // slightly above typical LB/CDN 60s
server.headersTimeout = 70_000;
server.maxHeadersCount = 100;
server.timeout = 120_000;           // 2 min for AI proxy requests

server.listen(PORT, HOST, () => {
  console.log(`derup server listening on http://${HOST}:${PORT} (pid ${process.pid})`);
});

// ── Graceful shutdown ───────────────────────────────────────────────────────
const shutdown = (signal) => {
  console.log(`\n${signal} received — shutting down gracefully...`);
  // Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  // Close all WebSocket clients
  wss.clients.forEach(ws => ws.close(1001, 'Server shutting down'));
  // Force exit after 10s if something hangs
  setTimeout(() => { console.error('Forced exit.'); process.exit(1); }, 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.searchParams.get('room');
  if (!roomId) { ws.close(4000, 'Missing room'); return; }

  const room = getOrCreateRoom(roomId);
  room.clients.add(ws);

  // Send current state to new client
  ws.send(JSON.stringify({ type: 'state', nodes: room.nodes, connections: room.connections, aggregations: room.aggregations }));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'update') {
      // Update room state
      if (Array.isArray(msg.nodes)) room.nodes = msg.nodes;
      if (Array.isArray(msg.connections)) room.connections = msg.connections;
      if (Array.isArray(msg.aggregations)) room.aggregations = msg.aggregations;
      // Broadcast to other clients
      for (const client of room.clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(JSON.stringify({ type: 'update', nodes: room.nodes, connections: room.connections, aggregations: room.aggregations }));
        }
      }
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
  });
});
