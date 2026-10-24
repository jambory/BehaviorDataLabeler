export const BEHAVIORS = ['sit', 'down', 'paw', 'stand', 'bow', 'sit-pretty', 'play-dead', 'roll-over', 'spin', 'back-up'];
export const COLORS = ['#c5e981', '#84baff', '#f0bc76', '#a8a1f6', '#6bcfc1', '#e99cbf', '#b9c7dc', '#dbabed', '#f49b83', '#b4c778'];
export function validateSegments(segments, frameCount) {
  if (!Array.isArray(segments)) throw new Error('Invalid labels: expected a list of intervals.');
  return segments.map((s, i) => {
    if (!BEHAVIORS.includes(s.behavior) || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end > frameCount || s.end <= s.start) throw new Error(`Invalid label interval ${i + 1}.`);
    return { id: s.id || `import-${i}`, behavior: s.behavior, start: s.start, end: s.end };
  });
}
export function normalizeSegments(segments, frameCount) {
  const valid = validateSegments(segments, frameCount), merged = [];
  for (const behavior of BEHAVIORS) {
    for (const s of valid.filter(s => s.behavior === behavior).sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last?.behavior === behavior && last.end >= s.start) last.end = Math.max(last.end, s.end);
      else merged.push({ ...s });
    }
  }
  return merged;
}
export function segmentsToLabels(segments, frameCount) {
  const labels = Array.from({ length: frameCount }, () => []);
  for (const s of normalizeSegments(segments, frameCount)) for (let i = s.start; i < s.end; i++) labels[i].push(s.behavior);
  return labels;
}
export function labelsToSegments(labels, frameCount) {
  const segments = [];
  for (const behavior of BEHAVIORS) {
    let start = null;
    for (let i = 0; i <= frameCount; i++) {
      const active = i < frameCount && labels.get(i)?.includes(behavior);
      if (active && start === null) start = i;
      if (!active && start !== null) { segments.push({ id: `import-${behavior}-${start}`, behavior, start, end: i }); start = null; }
    }
  }
  return segments;
}
export function coverage(segments, frameCount) {
  const ranges = segments.map(s => [s.start, s.end]).sort((a,b) => a[0]-b[0]);
  let covered = 0, end = 0;
  for (const [a,b] of ranges) { covered += Math.max(0, b - Math.max(a,end)); end = Math.max(end,b); }
  return { covered, unlabeled: frameCount - covered };
}
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function moveSegment(s, mode, delta, count) {
  if (mode === 'start') return { ...s, start: clamp(s.start + delta, 0, s.end - 1) };
  if (mode === 'end') return { ...s, end: clamp(s.end + delta, s.start + 1, count) };
  const start = clamp(s.start + delta, 0, count - (s.end - s.start));
  return { ...s, start, end: start + s.end - s.start };
}
