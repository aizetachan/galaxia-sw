// server/world/planner.js
// Simple planner scoring beats, hooks and affordances

export function planSuggestions(threads = [], hooks = [], affordances = []) {
  const candidates = [];

  // Gather main and side beats
  threads.forEach(t => {
    const avail = (t.beats || []).filter(b => b.state === 'available');
    if (!avail.length) return;
    const weightBase = t.priority || 0;
    avail.forEach(b => {
      candidates.push({ type: 'beat', threadKind: t.kind, id: b.id, title: b.title, weight: weightBase + (t.kind === 'main' ? 100 : 0) });
    });
  });

  hooks.forEach(h => {
    candidates.push({ type: 'hook', id: h.id, label: h.label, weight: h.weight || 0 });
  });

  affordances.forEach(a => {
    candidates.push({ type: 'affordance', id: a.id, action: a.action, weight: a.weight || 0 });
  });

  candidates.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const top = [];
  let mainIncluded = false;
  for (const c of candidates) {
    if (top.length >= 3) break;
    if (c.type === 'beat' && c.threadKind === 'main') mainIncluded = true;
    top.push(c);
  }
  if (!mainIncluded) {
    const main = candidates.find(c => c.type === 'beat' && c.threadKind === 'main');
    if (main) {
      top.pop();
      top.push(main);
    }
  }
  return top;
}

export default { planSuggestions };
