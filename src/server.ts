import 'dotenv/config';

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';

import express from 'express';
import OpenAI from 'openai';
import { randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Db, MongoClient } from 'mongodb';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();
const scrypt = promisify(nodeScrypt);
const sessionCookieName = 'morrow_session';
const sessionDurationMs = 1000 * 60 * 60 * 24 * 30;
const geminiModel = process.env['ASSISTANT_MODEL'] || 'gemini-3.5-flash-lite';
const openAiModel = process.env['OPENAI_MODEL'] || 'gpt-4o-mini';
const openAiClient = process.env['OPENAI_API_KEY']
  ? new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] })
  : null;
const assistantTimeoutMs = 20_000;

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface AssistantProvider {
  name: string;
  request: (messages: ChatMessage[], signal: AbortSignal) => Promise<string>;
}

class AssistantProviderError extends Error {
  constructor(readonly category: string) {
    super('Assistant provider request failed.');
  }
}

class AssistantProvidersError extends Error {
  constructor(readonly failures: string[]) {
    super('All assistant providers failed.');
  }
}

function getHttpFailureCategory(status: number): string {
  if (status === 401 || status === 403) return 'key_or_access_denied';
  if (status === 429) return 'rate_limited_or_quota';
  if (status >= 500) return 'provider_unavailable';
  return `http_${status}`;
}

function getProviderFailureCategory(error: unknown): string {
  if (error instanceof AssistantProviderError) return error.category;
  if (error instanceof OpenAI.APIError && error.status) return getHttpFailureCategory(error.status);
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';
  return 'network_error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseChatMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;

  const messages: ChatMessage[] = [];
  for (const valueMessage of value) {
    if (!isRecord(valueMessage)) return null;
    const { role, text } = valueMessage;
    if ((role !== 'user' && role !== 'model') || typeof text !== 'string' || text.length > 40000) return null;
    messages.push({ role, text });
  }

  return messages;
}

function getGeminiReply(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data['candidates'])) return '';
  const candidate = data['candidates'][0];
  if (!isRecord(candidate) || !isRecord(candidate['content']) || !Array.isArray(candidate['content']['parts'])) return '';

  return candidate['content']['parts']
    .map((part: unknown) => isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '')
    .join('');
}

async function requestGemini(messages: ChatMessage[], signal: AbortSignal): Promise<string> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) throw new Error('Gemini is not configured.');

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          contents: messages.map(message => ({
            role: message.role === 'model' ? 'model' : 'user',
            parts: [{ text: message.text }]
          })),
          generationConfig: { temperature: 0.4, maxOutputTokens: 768 }
        })
      }
    );

    const data: unknown = await response.json().catch(() => null);
    if (response.ok) return getGeminiReply(data);
    if ((response.status !== 429 && response.status < 500) || attempt === 2) {
      throw new AssistantProviderError(getHttpFailureCategory(response.status));
    }

    await new Promise(resolve => setTimeout(resolve, 350));
  }

  throw new Error('Gemini request failed.');
}

async function requestOpenAI(messages: ChatMessage[], signal: AbortSignal): Promise<string> {
  if (!openAiClient) throw new Error('OpenAI is not configured.');

  try {
    const response = await openAiClient.chat.completions.create({
      model: openAiModel,
      messages: messages.map(message => ({
        role: message.role === 'model' ? 'assistant' : 'user',
        content: message.text
      })),
      temperature: 0.4,
      max_completion_tokens: 768
    }, { signal });

    return response.choices[0]?.message.content || '';
  } catch (error) {
    if (error instanceof OpenAI.APIError && error.status) {
      throw new AssistantProviderError(getHttpFailureCategory(error.status));
    }
    throw error;
  }
}

async function raceAssistantProviders(messages: ChatMessage[], providers: AssistantProvider[]): Promise<string> {
  let winnerChosen = false;
  const failures: string[] = [];
  const controllers = providers.map(() => new AbortController());

  const attempts = providers.map((provider, index) => {
    const controller = controllers[index];
    const timeout = setTimeout(() => controller.abort(), assistantTimeoutMs);

    return provider.request(messages, controller.signal)
      .then(reply => {
        const normalizedReply = reply.trim();
        if (!normalizedReply) throw new Error(`${provider.name} returned an empty response.`);
        if (winnerChosen) throw new Error(`${provider.name} completed after the winner.`);

        winnerChosen = true;
        controllers.forEach((otherController, otherIndex) => {
          if (otherIndex !== index) otherController.abort();
        });
        return normalizedReply;
      })
      .catch(error => {
        if (!winnerChosen) {
          const category = getProviderFailureCategory(error);
          failures.push(`${provider.name}:${category}`);
          console.error(`${provider.name} provider failed (${category}).`);
        }
        throw error;
      })
      .finally(() => clearTimeout(timeout));
  });

  try {
    return await Promise.any(attempts);
  } catch {
    controllers.forEach(controller => controller.abort());
    throw new AssistantProvidersError(failures);
  }
}

interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
}

interface SessionRecord {
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

interface StoredConversation {
  id: string;
  userId: string;
  title: string;
  updatedAt: number;
  messages: Array<{
    id: string;
    text: string;
    sender: 'user' | 'ai';
    time: string;
  }>;
}

let databasePromise: Promise<Db> | null = null;

async function getDatabase(): Promise<Db> {
  const uri = process.env['MONGODB_URI'];
  if (!uri) throw new Error('MONGODB_URI is missing');
  if (!databasePromise) {
    const client = new MongoClient(uri);
    databasePromise = client.connect().then(() => {
      const database = client.db(process.env['MONGODB_DB_NAME'] || 'morrow');
      return Promise.all([
        database.collection<UserRecord>('users').createIndex({ email: 1 }, { unique: true }),
        database.collection<SessionRecord>('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        database.createCollection<StoredConversation>('conversations').catch(() => null)
      ]).then(() => database);
    }).catch(async (error: unknown) => {
      databasePromise = null;
      await client.close().catch(() => undefined);
      throw error;
    });
  }
  return databasePromise;
}

void getDatabase().catch((error: unknown) => {
  console.error('MongoDB connection unavailable:', error);
});

function getSessionToken(request: express.Request): string | null {
  const cookies = request.headers.cookie?.split(';') || [];
  const sessionCookie = cookies.find(cookie => cookie.trim().startsWith(`${sessionCookieName}=`));
  return sessionCookie?.split('=').slice(1).join('=').trim() || null;
}

function setSessionCookie(response: express.Response, token: string): void {
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${sessionCookieName}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${sessionDurationMs / 1000}${secure}`);
}

function clearSessionCookie(response: express.Response): void {
  response.setHeader('Set-Cookie', `${sessionCookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

async function hashPassword(password: string, salt = randomBytes(16).toString('hex')): Promise<string> {
  const derivedKey = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(await hashPassword(password, salt).then(value => value.split(':')[1]), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function getAuthenticatedUser(request: express.Request): Promise<UserRecord | null> {
  const token = getSessionToken(request);
  if (!token) return null;

  const database = await getDatabase();
  const session = await database.collection<SessionRecord>('sessions').findOne({
    token,
    expiresAt: { $gt: new Date() }
  });
  if (!session) return null;

  return database.collection<UserRecord>('users').findOne({ id: session.userId });
}

function publicUser(user: UserRecord): { email: string; name: string; isAdmin: boolean } {
  return {
    email: user.email,
    name: user.name,
    isAdmin: user.email === process.env['ADMIN_EMAIL']?.trim().toLowerCase()
  };
}

async function createSession(user: UserRecord, response: express.Response): Promise<void> {
  const database = await getDatabase();
  const token = randomBytes(32).toString('hex');
  await database.collection<SessionRecord>('sessions').insertOne({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + sessionDurationMs),
    createdAt: new Date()
  });
  setSessionCookie(response, token);
}

app.use(express.json({ limit: '1mb' }));

// ===============================
// ACCOUNT API
// ===============================
app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');

    if (!email.includes('@') || !name || password.length < 8) {
      return res.status(400).json({ error: 'Enter your name, a valid email, and a password of at least 8 characters.' });
    }

    const database = await getDatabase();
    const user: UserRecord = {
      id: randomUUID(),
      email,
      name,
      passwordHash: await hashPassword(password),
      createdAt: new Date()
    };
    await database.collection<UserRecord>('users').insertOne(user);
    await createSession(user, res);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Unable to create your account right now.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const database = await getDatabase();
    const user = await database.collection<UserRecord>('users').findOne({ email });

    if (!user) {
      return res.status(404).json({
        code: 'ACCOUNT_NOT_FOUND',
        error: 'You have no account yet. Please create an account first.'
      });
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'That email and password combination could not be found.' });
    }

    await createSession(user, res);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

app.get('/api/auth/session', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Session lookup error:', error);
    return res.status(500).json({ error: 'Unable to check your session.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = getSessionToken(req);
    if (token) {
      const database = await getDatabase();
      await database.collection<SessionRecord>('sessions').deleteOne({ token });
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Unable to sign out right now.' });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const adminEmail = process.env['ADMIN_EMAIL']?.trim().toLowerCase();
    if (!user || !adminEmail || user.email !== adminEmail) {
      return res.status(403).json({ error: 'Admin access is required.' });
    }

    const database = await getDatabase();
    const users = await database.collection<UserRecord>('users')
      .find({}, { projection: { _id: 0, id: 0, passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ users });
  } catch (error) {
    console.error('Admin user lookup error:', error);
    return res.status(500).json({ error: 'Unable to load the user directory.' });
  }
});

// ===============================
// CONVERSATION API
// ===============================
app.get('/api/conversations', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in to view your conversations.' });

    const database = await getDatabase();
    const conversations = await database.collection<StoredConversation>('conversations')
      .find({ userId: user.id }, { projection: { _id: 0, userId: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
    return res.json({ conversations });
  } catch (error) {
    console.error('Conversation lookup error:', error);
    return res.status(500).json({ error: 'Unable to load your conversations.' });
  }
});

app.put('/api/conversations/:id', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in to save conversations.' });

    const conversation = req.body as Partial<StoredConversation>;
    if (!conversation.id || conversation.id !== req.params['id'] || !conversation.title || !Array.isArray(conversation.messages)) {
      return res.status(400).json({ error: 'Invalid conversation data.' });
    }

    const messages = conversation.messages.slice(-100).map(message => ({
      id: String(message.id || randomUUID()),
      text: String(message.text || '').slice(0, 10000),
      sender: message.sender === 'ai' ? 'ai' as const : 'user' as const,
      time: String(message.time || '')
    }));
    const database = await getDatabase();
    await database.collection<StoredConversation>('conversations').replaceOne(
      { id: conversation.id, userId: user.id },
      {
        id: conversation.id,
        userId: user.id,
        title: String(conversation.title).slice(0, 200),
        updatedAt: Number(conversation.updatedAt) || Date.now(),
        messages
      },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error('Conversation save error:', error);
    return res.status(500).json({ error: 'Unable to save your conversation.' });
  }
});

app.delete('/api/conversations', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in to delete your conversations.' });

    const database = await getDatabase();
    const result = await database.collection<StoredConversation>('conversations').deleteMany({ userId: user.id });
    return res.json({ deletedCount: result.deletedCount });
  } catch (error) {
    console.error('Conversation deletion error:', error);
    return res.status(500).json({ error: 'Unable to delete your conversations.' });
  }
});

// ===============================
// PARALLEL AI CHAT API
// ===============================
app.post('/api/chat', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Please sign in before starting a chat.' });
    }

    const messages = parseChatMessages(req.body?.messages);
    if (!messages) {
      return res.status(400).json({ error: 'Messages must contain 1 to 20 valid entries.' });
    }

    const providers: AssistantProvider[] = [];
    if (process.env['GEMINI_API_KEY']) {
      providers.push({ name: 'Gemini', request: requestGemini });
    }
    if (openAiClient) {
      providers.push({ name: 'OpenAI', request: requestOpenAI });
    }
    if (providers.length === 0) {
      return res.status(500).json({ error: 'Assistant service is not configured yet.' });
    }

    const reply = await raceAssistantProviders(messages, providers);
    return res.json({ reply });
  } catch (error) {
    console.error('Assistant provider race failed.');
    if (error instanceof AssistantProvidersError) {
      return res.status(502).json({
        error: 'Unable to reach the assistant.',
        providerFailures: error.failures
      });
    }
    return res.status(500).json({ error: 'Unable to reach the assistant.' });
  }
});

// ===============================
// STATIC FILES
// ===============================
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

// ===============================
// ANGULAR SSR
// ===============================
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') return;
      next(error);
    });
});

// ===============================
// START SERVER
// ===============================
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;

  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
