import { Agent, BedrockModel, tool } from '@strands-agents/sdk';
import { z } from 'zod';
import type { CareEngine } from '../engine/engine.ts';
import { formatClock, formatMinuteOfDay, localParts } from '../engine/time.ts';
import type { AiConfig } from './bedrock.ts';

// "Ask Porchlight": a Strands agent on Amazon Bedrock that answers a family
// member's questions from Porchlight's own records and, when asked about the
// porch right now, from a fresh Ring snapshot checked by the vision model.

export interface AskDeps {
  engine: CareEngine;
  /** Fresh Ring snapshot + vision check of the front porch. */
  checkPorchNow?: () => Promise<string>;
  devices?: () => Array<{ name: string; online: boolean | null; role: string; battery?: number }>;
}

export interface Answer {
  text: string;
  model: string;
  toolsUsed: string[];
}

export function porchlightTools(deps: AskDeps, used: string[]) {
  const { engine } = deps;
  const tz = engine.household.timeZone;
  const dateKeyFor = (day: string | undefined) => {
    const now = engine.clock.now();
    if (!day || day === 'today') return localParts(now, tz).dateKey;
    if (day === 'yesterday') return localParts(now - 24 * 3600_000, tz).dateKey;
    return day;
  };
  return [
    tool({
      name: 'get_day_summary',
      description: "Facts about one day of the resident's activity: first and last activity, doorbell rings and whether they were answered, deliveries and whether they were brought in, check-ins Porchlight raised.",
      inputSchema: z.object({ day: z.string().optional().describe('"today", "yesterday" or YYYY-MM-DD. Defaults to today.') }),
      callback: (input) => {
        used.push('get_day_summary');
        return engine.dayFacts(dateKeyFor(input.day));
      },
    }),
    tool({
      name: 'get_open_checkins',
      description: 'Check-ins Porchlight currently has open, with what it has done so far and who has been told.',
      inputSchema: z.object({}),
      callback: () => {
        used.push('get_open_checkins');
        return engine.openConcerns().map((c) => ({
          title: c.title,
          severity: c.severity,
          opened: formatClock(c.openedAt, tz),
          summary: c.summary,
          steps: c.ladder.filter((s) => s.firedAt).map((s) => ({ step: s.kind, at: formatClock(s.firedAt!, tz), outcome: s.outcome ?? '' })),
          handledBy: c.acknowledgedBy ?? null,
        }));
      },
    }),
    tool({
      name: 'get_recent_activity',
      description: 'The Ring events Porchlight saw in the last N hours, oldest first, in plain words.',
      inputSchema: z.object({ hours: z.number().min(1).max(48).default(6) }),
      callback: (input) => {
        used.push('get_recent_activity');
        const now = engine.clock.now();
        return engine
          .signalsBetween(now - input.hours * 3600_000, now + 1)
          .filter((s) => s.kind !== 'device_online' && s.kind !== 'vehicle')
          .map((s) => `${formatClock(s.at, tz)} ${s.kind.replace(/_/g, ' ')}${s.deviceLabel ? ` (${s.deviceLabel})` : ''}`);
      },
    }),
    tool({
      name: 'get_usual_routine',
      description: "What Porchlight has learned about the resident's normal day from past Ring events.",
      inputSchema: z.object({}),
      callback: () => {
        used.push('get_usual_routine');
        const r = engine.rhythm;
        return {
          daysObserved: r.days,
          confidence: r.confidence,
          usuallyUpBetween: r.firstActivity ? [formatMinuteOfDay(r.firstActivity.p10), formatMinuteOfDay(r.firstActivity.p90)] : null,
          checkInTime: formatMinuteOfDay(r.checkInBy),
          usualLastActivity: r.lastActivity ? formatMinuteOfDay(r.lastActivity.median) : null,
          deliveriesPerWeek: r.deliveriesPerWeek,
          visitorsPerWeek: r.visitorsPerWeek,
        };
      },
    }),
    tool({
      name: 'check_porch_now',
      description: 'Takes a fresh snapshot from the front-door Ring camera and checks whether a package or a person is on the porch right now.',
      inputSchema: z.object({}),
      callback: async () => {
        used.push('check_porch_now');
        return deps.checkPorchNow ? await deps.checkPorchNow() : 'No front-door camera is connected.';
      },
    }),
    tool({
      name: 'get_devices',
      description: 'The Ring devices Porchlight uses and whether each one is online.',
      inputSchema: z.object({}),
      callback: () => {
        used.push('get_devices');
        return deps.devices?.() ?? [];
      },
    }),
  ];
}

export class AskPorchlight {
  readonly #deps: AskDeps;
  readonly #ai?: AiConfig;

  constructor(deps: AskDeps, ai?: AiConfig) {
    this.#deps = deps;
    this.#ai = ai?.enabled ? ai : undefined;
  }

  get model(): string {
    return this.#ai ? `Strands agent on Amazon Bedrock (${this.#ai.textModelId})` : 'offline answers (no Bedrock configured)';
  }

  async ask(question: string, asker = 'the family'): Promise<Answer> {
    const used: string[] = [];
    if (!this.#ai) return { text: offlineAnswer(this.#deps.engine, question), model: this.model, toolsUsed: ['get_day_summary'] };
    const h = this.#deps.engine.household;
    const now = this.#deps.engine.clock.now();
    const agent = new Agent({
      model: new BedrockModel({ region: this.#ai.region, modelId: this.#ai.textModelId, apiKey: this.#ai.apiKey, maxTokens: 500, temperature: 0.2 }),
      tools: porchlightTools(this.#deps, used),
      printer: false,
      systemPrompt: [
        `You are Porchlight, helping ${asker} keep a gentle eye on ${h.resident.name} ("${h.resident.preferredName}"), who lives alone.`,
        `It is ${formatClock(now, h.timeZone)} on ${localParts(now, h.timeZone).dateKey} in ${h.resident.preferredName}'s time zone.`,
        'Answer only from tool results. If the tools do not say, say you do not know. Never guess about health, mood or who a visitor was.',
        'No medical advice. Answer in 1 to 3 short, calm sentences with times. If a check-in is open, say what Porchlight already did.',
      ].join(' '),
    });
    try {
      const result = await agent.invoke(question);
      return { text: result.toString().trim(), model: this.model, toolsUsed: [...new Set(used)] };
    } catch (err) {
      return { text: `${offlineAnswer(this.#deps.engine, question)} (Bedrock was unavailable: ${(err as Error).name})`, model: 'offline fallback', toolsUsed: ['get_day_summary'] };
    }
  }
}

/** Deterministic answers for when no model is configured. */
export function offlineAnswer(engine: CareEngine, question: string): string {
  const f = engine.dayFacts();
  const q = question.toLowerCase();
  const name = f.resident;
  const open = engine.openConcerns();
  if (/package|deliver|parcel|amazon|pharmacy/.test(q)) {
    if (!f.deliveries.length) return `No deliveries have arrived for ${name} today.`;
    return f.deliveries.map((d) => `A delivery came at ${d.time}${d.broughtInside ? ` and was brought inside by ${d.broughtInside}` : ' and has not been confirmed inside yet'}.`).join(' ');
  }
  if (/visit|door ?bell|ring|who came|aide/.test(q)) {
    if (!f.visitors.length) return `Nobody has rung ${name}'s doorbell today.`;
    return `The doorbell rang ${f.visitors.length} time${f.visitors.length > 1 ? 's' : ''} today: ${f.visitors.map((v) => `${v.time}${v.answered === false ? ' (not answered)' : v.answered ? ' (answered)' : ''}`).join(', ')}.`;
  }
  if (open.length) return `${open[0].title}: ${open[0].summary}`;
  if (f.firstActivity) return `${name} has been up since ${f.firstActivity}${f.usualFirstActivity ? ` (usually ${f.usualFirstActivity})` : ''}, last active at ${f.lastActivity}. Nothing needs attention.`;
  return `Porchlight hasn't seen ${name} yet today.`;
}
