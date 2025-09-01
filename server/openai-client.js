// server/openai-client.js
let openaiClient = null;

export async function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  if (openaiClient) return openaiClient;

  const mod = await import('openai');
  const OpenAI = mod.default || mod.OpenAI || mod;

  // Solo pasamos org/proj si tienen el prefijo correcto para evitar ReferenceError
  const rawOrg = process.env.OPENAI_ORG || '';
  const rawProj = process.env.OPENAI_PROJECT || '';

  const opts = { apiKey };
  if (rawOrg && /^org_[a-zA-Z0-9]+$/.test(rawOrg)) opts.organization = rawOrg;
  if (rawProj && /^proj_[a-zA-Z0-9]+$/.test(rawProj)) opts.project = rawProj;

  openaiClient = new OpenAI(opts);

  console.log(
    '[AI] OpenAI init → org:',
    opts.organization ? opts.organization : 'auto',
    'project:',
    opts.project ? opts.project : 'auto'
  );

  return openaiClient;
}

export default getOpenAI;
