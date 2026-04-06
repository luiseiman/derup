#!/usr/bin/env node
/**
 * One-time OAuth login for ChatGPT (OpenAI Codex).
 * Works on VPS/remote: prints URL, you paste the redirect URL back.
 *
 * Usage: node scripts/openai-oauth-login.mjs
 */

import http from 'node:http';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
const SCOPE = 'openid profile email offline_access';
const TOKEN_FILE = path.resolve(process.cwd(), '.oauth-tokens.json');

// Detect if running on a remote/headless server
const isRemote = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && process.platform === 'linux';

// ── PKCE ────────────────────────────────────────────────────────────────────

function base64urlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generatePKCE() {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);
  const data = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));
  return { verifier, challenge };
}

function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── JWT decode (no verification) ────────────────────────────────────────────

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}

function getAccountId(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;
  const auth = payload['https://api.openai.com/auth'];
  return auth?.chatgpt_account_id ?? null;
}

// ── Prompt helper ───────────────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Extract code from redirect URL or raw code ─────────────────────────────

function parseCodeFromInput(input) {
  // Full URL: http://localhost:1455/auth/callback?code=XXX&state=YYY
  if (input.startsWith('http')) {
    try {
      const u = new URL(input);
      return { code: u.searchParams.get('code'), state: u.searchParams.get('state') };
    } catch { /* fall through */ }
  }
  // Raw code
  return { code: input, state: null };
}

// ── Save tokens ─────────────────────────────────────────────────────────────

function saveTokens(tokenData) {
  const accountId = getAccountId(tokenData.access_token);
  const email = decodeJwtPayload(tokenData.id_token ?? '')?.email ?? null;

  const tokens = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
    account_id: accountId,
    email,
    updated_at: new Date().toISOString(),
  };

  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));

  console.log(`\n  Tokens guardados en .oauth-tokens.json`);
  console.log(`  Email: ${email ?? 'desconocido'}`);
  console.log(`  Account ID: ${accountId ?? 'desconocido'}`);
  console.log(`  Expira en: ${tokenData.expires_in ?? '?'}s`);
  console.log('\n  Listo. El dashboard puede usar ChatGPT Pro.\n');
}

// ── Token exchange ──────────────────────────────────────────────────────────

async function exchangeCode(code, verifier) {
  console.log('  Intercambiando código por tokens...');

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text}`);
  }

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token || !tokenData.refresh_token) {
    throw new Error(`Respuesta incompleta: ${JSON.stringify(tokenData)}`);
  }

  return tokenData;
}

// ── Remote flow (VPS/SSH) ───────────────────────────────────────────────────

async function remoteFlow() {
  const { verifier, challenge } = await generatePKCE();
  const state = randomState();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');

  console.log('\n🔐 OpenAI OAuth Login (modo remoto)\n');
  console.log('  1. Abrí esta URL en tu browser LOCAL:\n');
  console.log(`  ${url.toString()}\n`);
  console.log('  2. Logueate con tu cuenta ChatGPT Pro.');
  console.log('  3. Después del login, el browser va a redirigir a localhost:1455');
  console.log('     (va a dar error — eso está bien).');
  console.log('  4. Copiá la URL COMPLETA de la barra de direcciones y pegala acá.\n');

  const input = await prompt('  Pegá la redirect URL: ');

  if (!input) {
    throw new Error('No se recibió input');
  }

  const parsed = parseCodeFromInput(input);
  if (!parsed.code) {
    throw new Error('No se pudo extraer el código de autorización');
  }
  if (parsed.state && parsed.state !== state) {
    throw new Error(`State mismatch: esperado ${state}, recibido ${parsed.state}`);
  }

  const tokenData = await exchangeCode(parsed.code, verifier);
  saveTokens(tokenData);
}

// ── Local flow (Mac/Desktop) ────────────────────────────────────────────────

async function localFlow() {
  const { verifier, challenge } = await generatePKCE();
  const state = randomState();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');

  console.log('\n🔐 OpenAI OAuth Login\n');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '', `http://localhost:${CALLBACK_PORT}`);
        if (reqUrl.pathname !== '/auth/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        if (reqUrl.searchParams.get('state') !== state) {
          res.writeHead(400);
          res.end('State mismatch');
          return;
        }
        const authCode = reqUrl.searchParams.get('code');
        if (!authCode) {
          res.writeHead(400);
          res.end('Missing authorization code');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><body><h2>Login exitoso</h2><p>Podés cerrar esta pestaña.</p></body></html>');
        server.close();
        resolve(authCode);
      } catch (err) {
        res.writeHead(500);
        res.end('Error');
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      console.log(`  Callback server en http://localhost:${CALLBACK_PORT}`);
      console.log('  Abriendo browser...\n');
      try {
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        execSync(`${cmd} "${url.toString()}"`, { stdio: 'ignore' });
      } catch {
        console.log(`  No se pudo abrir el browser. Abrí manualmente:\n  ${url.toString()}\n`);
      }
    });

    setTimeout(() => {
      server.close();
      reject(new Error('Timeout: no se recibió callback en 2 minutos'));
    }, 120_000);
  });

  console.log('  Código recibido.');
  const tokenData = await exchangeCode(code, verifier);
  saveTokens(tokenData);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (isRemote) {
    await remoteFlow();
  } else {
    await localFlow();
  }
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
