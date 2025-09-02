// server/openai-client.js
let openaiClient = null;

export async function getOpenAI() {
  // ✅ Soporta tanto OpenAI oficial como servidores OpenAI-compatibles (Ollama, vLLM, etc.)
  const baseURL = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || '';
  const apiKey =
    process.env.OPENAI_API_KEY ||
    process.env.LLM_API_KEY ||
    (baseURL ? 'sk-local' : ''); // algunos backends locales requieren un string no vacío

  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const mod = await import('openai');
  const OpenAI = mod.default || mod.OpenAI || mod;

  const rawOrg = process.env.OPENAI_ORG || '';
  const rawProj = process.env.OPENAI_PROJECT || '';

  const opts = { apiKey };
  if (baseURL) opts.baseURL = baseURL;
  if (/^org_[A-Za-z0-9]+$/.test(rawOrg)) opts.organization = rawOrg;
  if (/^proj_[A-Za-z0-9]+$/.test(rawProj)) opts.project = rawProj;

  openaiClient = new OpenAI(opts);

  console.log(
    '[AI] OpenAI init → baseURL:',
    baseURL || 'default',
    'org:',
    opts.organization || 'auto',
    'project:',
    opts.project || 'auto'
  );

  return openaiClient;
}

export default getOpenAI;
