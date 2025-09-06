import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROMPT_DIRS = [
  path.join(__dirname, 'prompts'),
  path.join(__dirname, 'data', 'prompts'),
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
