import type { CareEngine } from '../engine/engine.ts';
import type { Bedrock } from './bedrock.ts';

export interface Digest {
  date: string;
  text: string;
  model: string;
  facts: ReturnType<CareEngine['dayFacts']>;
}

const SYSTEM = [
  "You write the end-of-day note a family receives about an older relative who lives alone.",
  'Use only the JSON facts provided. Never invent events, never guess at health or mood, never give medical advice.',
  'Warm, plain, 2 to 4 short sentences, at most 70 words. Lead with the reassurance or the one thing that needs attention.',
  'Mention times the way people say them ("just before 8"). Do not use bullet points, headings or emoji.',
].join(' ');

/** The digest is the one place a model writes prose for the family, and it is grounded in dayFacts() only. */
export async function writeDigest(engine: CareEngine, bedrock: Bedrock | undefined, dateKey?: string): Promise<Digest> {
  const facts = engine.dayFacts(dateKey);
  if (bedrock) {
    try {
      const reply = await bedrock.text(SYSTEM, `Facts for ${facts.resident}'s day:\n${JSON.stringify(facts)}`, { maxTokens: 220, temperature: 0.4 });
      if (reply.text) return { date: facts.date, text: reply.text, model: reply.modelId, facts };
    } catch {
      // fall through to the template
    }
  }
  return { date: facts.date, text: templateDigest(facts), model: 'template', facts };
}

export function templateDigest(f: ReturnType<CareEngine['dayFacts']>): string {
  const parts: string[] = [];
  const open = f.concerns.filter((c) => c.status === 'open');
  if (open.length) parts.push(`Needs attention: ${open.map((c) => c.title.toLowerCase()).join(', ')}.`);
  if (f.firstActivity) parts.push(`${f.resident} was up at ${f.firstActivity}${f.usualFirstActivity ? ` (usually ${f.usualFirstActivity})` : ''} and last active at ${f.lastActivity}.`);
  else parts.push(`No activity from ${f.resident} has been seen today.`);
  const answered = f.visitors.filter((v) => v.answered).length;
  if (f.visitors.length) parts.push(`${f.visitors.length} doorbell ring${f.visitors.length > 1 ? 's' : ''}, ${answered} answered.`);
  if (f.deliveries.length) {
    const inside = f.deliveries.filter((d) => d.broughtInside).length;
    parts.push(`${f.deliveries.length} deliver${f.deliveries.length > 1 ? 'ies' : 'y'}, ${inside} brought inside.`);
  }
  const resolved = f.concerns.filter((c) => c.status === 'resolved');
  if (resolved.length) parts.push(`Earlier check-ins (${resolved.map((c) => c.title.toLowerCase()).join(', ')}) were resolved.`);
  else if (!open.length) parts.push('Nothing unusual.');
  return parts.join(' ');
}
