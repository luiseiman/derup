import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

const PORT = Number(process.env.GEMINI_PORT || 8787);

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

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
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
    req.on('data', chunk => {
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

  sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI API proxy listening on http://127.0.0.1:${PORT}`);
});
