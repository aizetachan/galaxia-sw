export const now = () => Date.now();
export const hhmm = ts => new Date(ts).toLocaleTimeString();
export function escapeHtml(s=''){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
export function formatMarkdown(t=''){ const safe=escapeHtml(t); return safe.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>'); }
export const titleCase = (s='') => String(s).toLowerCase().replace(/\b\w/g, m=>m.toUpperCase()).replace(/\s+/g,' ').trim();
