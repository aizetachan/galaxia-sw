import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const WORLD_FILE = path.join(DATA_DIR, 'world.json');

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(WORLD_FILE)) {
    const fresh = { createdAt: Date.now(), characters: {}, events: [] };
    fs.writeFileSync(WORLD_FILE, JSON.stringify(fresh, null, 2), 'utf-8');
  }
}

export function getWorld() {
  ensureFiles();
  const raw = fs.readFileSync(WORLD_FILE, 'utf-8');
  return JSON.parse(raw);
}

export function saveWorld(world) {
  ensureFiles();
  fs.writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2), 'utf-8');
}

export function upsertCharacter(char) {
  const world = getWorld();
  world.characters[char.name] = { ...world.characters[char.name], ...char };
  saveWorld(world);
  return world.characters[char.name];
}

export function appendEvent(evt) {
  const world = getWorld();
  world.events.push({ ...evt, id: (Math.random().toString(36).slice(2)) + Date.now().toString(36) });
  saveWorld(world);
  return evt;
}
