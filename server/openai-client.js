// server/openai-client.js
let openaiClient = null;

export async function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  if (openaiClient) return openaiClient;

  const mod = await import('openai');
  const OpenAI = mod.default || mod.OpenAI || mod;

  const organization = process.env.OPENAI_ORG || undefined;     // ej: org_abc123
  const project      = process.env.OPENAI_PROJECT || undefined;  // ej: proj_xyz789

  openaiClient = new OpenAI({
    apiKey,
    ...(organization ? { organization } : {}),
    ...(project ? { project } : {}),
  });

  // Log único para confirmar qué org/proyecto está usando el server
  console.log('[AI] OpenAI init → org:', organization || '—', 'project:', project || '—');

  return openaiClient;
}

export default getOpenAI;
