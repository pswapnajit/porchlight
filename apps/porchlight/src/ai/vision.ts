import { decodePng } from 'ring-partner-kit';
import type { VisionResult } from '../engine/types.ts';
import { type Bedrock, extractJson } from './bedrock.ts';

// Ring's computer-vision guidelines recommend a tiered funnel: filter on the
// webhook sub_type first (free), and run a heavy model only at the moments a
// decision depends on it. Porchlight follows that literally: Ring's own
// package_delivery classification starts the clock, and the vision model runs
// once, when the dwell time is up, on a snapshot with privacy zones blacked out.

export interface VisionAnalyzer {
  readonly name: string;
  analyzePorch(image: Uint8Array, format: 'png' | 'jpeg', at: number): Promise<VisionResult>;
}

const SYSTEM = [
  'You check doorbell-camera snapshots for a family caregiving app.',
  'Report only on objects: whether a package, box, bag or parcel is lying on the porch or doormat, and whether a person is visible.',
  'Never describe what a person looks like, guess who they are, or comment on anything inside black masked areas (those are privacy zones).',
  'The image may be wide-angle, low resolution, night infrared, or carry a timestamp watermark; ignore the watermark.',
  'Answer with JSON only: {"package_present": true|false|"unsure", "person_present": true|false|"unsure", "confidence": 0.0-1.0, "description": "<one short sentence about the porch>"}',
].join(' ');

const PROMPT = 'Is a delivered package still on this porch? Reply with the JSON object only.';

export class BedrockVision implements VisionAnalyzer {
  readonly name: string;
  readonly #bedrock: Bedrock;
  readonly #minConfidence: number;

  constructor(bedrock: Bedrock, minConfidence = 0.6) {
    this.#bedrock = bedrock;
    this.#minConfidence = minConfidence;
    this.name = `Amazon Bedrock (${bedrock.config.visionModelId})`;
  }

  async analyzePorch(image: Uint8Array, format: 'png' | 'jpeg', at: number): Promise<VisionResult> {
    try {
      const reply = await this.#bedrock.image(SYSTEM, PROMPT, image, format);
      return parseVisionReply(reply.text, this.name, at, this.#minConfidence);
    } catch (err) {
      return { packagePresent: null, confidence: 0, description: `Vision check failed (${(err as Error).name}), so Porchlight will ask instead of guessing.`, model: this.name, at };
    }
  }
}

/** Guardrail: anything unparseable, "unsure" or under the confidence bar becomes null, and null means "ask a person". */
export function parseVisionReply(text: string, model: string, at: number, minConfidence = 0.6): VisionResult {
  const json = extractJson<{ package_present?: unknown; person_present?: unknown; confidence?: unknown; description?: unknown }>(text);
  if (!json) return { packagePresent: null, confidence: 0, description: "The vision model's answer couldn't be read.", model, at };
  const confidence = typeof json.confidence === 'number' ? Math.max(0, Math.min(1, json.confidence)) : 0;
  const tri = (v: unknown) => (v === true ? true : v === false ? false : null);
  let packagePresent = tri(json.package_present);
  if (confidence < minConfidence) packagePresent = null;
  const description = typeof json.description === 'string' && json.description.length < 300 ? json.description : 'No description.';
  return { packagePresent, personPresent: tri(json.person_present), confidence, description, model, at };
}

/**
 * Offline stand-in used only with the local simulator when no AWS credentials
 * are configured. It reads the ground truth the simulator wrote into the PNG,
 * and says so in every result, so it can never be mistaken for real vision.
 */
export class SimulatorOracleVision implements VisionAnalyzer {
  readonly name = 'Simulator ground truth (no Bedrock configured)';

  async analyzePorch(image: Uint8Array, _format: 'png' | 'jpeg', at: number): Promise<VisionResult> {
    try {
      const objects = (decodePng(image).text['sim:objects'] ?? '').split(',');
      const pkg = objects.includes('package');
      const person = objects.includes('person');
      return {
        packagePresent: pkg,
        personPresent: person,
        confidence: 1,
        description: pkg ? 'A package is still on the porch.' : person ? 'Someone is on the porch; no package is visible.' : 'The porch is clear.',
        model: this.name,
        at,
      };
    } catch {
      return { packagePresent: null, confidence: 0, description: 'Not a simulator image.', model: this.name, at };
    }
  }
}

export class NoVision implements VisionAnalyzer {
  readonly name = 'No vision model configured';

  async analyzePorch(_image: Uint8Array, _format: 'png' | 'jpeg', at: number): Promise<VisionResult> {
    return { packagePresent: null, confidence: 0, description: "No vision model is configured, so Porchlight can't look at the porch.", model: this.name, at };
  }
}
