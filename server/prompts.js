import fs from 'fs';
import path from 'path';

const PROMPT_DIRS = [
  path.join(process.cwd(), 'server', 'prompts'),
  path.join(process.cwd(), 'server', 'data', 'prompts'),
];

const cache = {};
for (const dir of PROMPT_DIRS) {
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.endsWith('.md') && !(f in cache)) {
        cache[f] = fs.readFileSync(path.join(dir, f), 'utf8');
      }
    }
  } catch {}
}

export function getPrompt(name) {
  return cache[name] || '';
}
export function getPromptSection(file, section) {
  const s = cache[file] || '';
  const re = new RegExp(`<!-- SECTION:${section} -->([\\s\\S]*?)<!-- \\/SECTION -->`, 'i');
  const m = re.exec(s);
  return m ? m[1].trim() : s; // fallback: todo el archivo
}

export default cache;
