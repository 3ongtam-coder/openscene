import { checkNarrationFit } from '@openvideo/shared/narrationTiming';
import { estimateImageCost, estimateVideoPlanCost, PRICING_AS_OF } from '@openvideo/shared/mediaGenerationPricing';
import { planVideoStoryboard } from '@openvideo/shared/videoStoryboardPlan';
import { timelineDurationMs } from '@openvideo/shared/timelineLogic';
import {
  requestBytePlusImage,
  requestImagenImage,
  requestOpenAiImage,
  type GeneratedImageData
} from '@openvideo/shared/imageGeneration';
import type { ImageAspectRatio } from '@openvideo/shared/providerSeams';

import { readKey, type ProviderSlot } from './credentials';
import { readProject } from './projectStore';
import type { SpendFeature } from './permissions';
import type { ToolSchema } from './agentChatClient';

/**
 * What the chat agent may ask to do.
 *
 * Each tool declares whether running it spends money, and on which feature. That
 * is the whole point of the field: a tool name tells the user what will happen,
 * but only the feature tells them what kind of charge they are approving, and
 * "always allow" has to mean *this* kind and not every kind.
 *
 * Only tools whose adapters actually run on the device are declared. A
 * `generate_video` tool would be a lie today — the video adapters are not ported
 * — and a model that is offered a tool will call it.
 */

export type ToolResult = {
  readonly summary: string;
  readonly image?: GeneratedImageData;
};

export type AgentTool = ToolSchema & {
  /** Null when running the tool costs nothing. */
  readonly spends: SpendFeature | null;
  /** Shown in the approval prompt, before anything is charged. */
  readonly costOf: (args: Record<string, unknown>) => string;
  readonly run: (args: Record<string, unknown>, context: { readonly projectId: string | null }) => Promise<ToolResult>;
};

const IMAGE_BINDINGS: Readonly<Record<string, { slot: ProviderSlot; request: (input: never) => Promise<GeneratedImageData> }>> = {
  'gpt-image-1': { slot: 'openaiApiKey', request: requestOpenAiImage as never },
  'imagen-4.0-generate-001': { slot: 'geminiApiKey', request: requestImagenImage as never },
  'seedream-3-0-t2i-250415': { slot: 'bytePlusApiKey', request: requestBytePlusImage as never }
};

const text = (args: Record<string, unknown>, key: string, fallback = ''): string =>
  typeof args[key] === 'string' ? (args[key] as string) : fallback;

const number = (args: Record<string, unknown>, key: string, fallback: number): number =>
  typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : fallback;

export const AGENT_TOOLS: readonly AgentTool[] = [
  {
    name: 'plan_video_shots',
    description:
      'Break a target video length into shots the chosen model can actually render, and price them. Planning is free; it does not generate anything.',
    parameters: {
      type: 'object',
      properties: {
        totalSeconds: { type: 'number', description: 'Desired finished length in seconds.' },
        providerId: { type: 'string', enum: ['openai', 'google_gemini', 'byteplus'] },
        modelId: { type: 'string', description: 'Video model id, e.g. sora-2.' }
      },
      required: ['totalSeconds', 'providerId']
    },
    spends: null,
    costOf: () => 'free',
    run: async (args) => {
      const providerId = text(args, 'providerId', 'openai');
      const modelId = text(args, 'modelId', 'sora-2');
      const plan = planVideoStoryboard({ totalSeconds: number(args, 'totalSeconds', 30), providerId });
      const cost = estimateVideoPlanCost(
        plan.shots.map((shot) => ({ modelId, durationSeconds: shot.durationSeconds }))
      );
      const total =
        cost.fullyPriced && cost.totalUsd !== undefined
          ? `~$${cost.totalUsd.toFixed(2)} (list price ${PRICING_AS_OF})`
          : 'no total — at least one shot could not be priced, so a partial sum would read as the whole bill';
      const rounded =
        plan.roundedFrom === undefined
          ? ''
          : ` The requested ${plan.roundedFrom}s is not reachable from this model's shot lengths, so the plan runs ${plan.totalSeconds}s.`;
      return {
        summary: `${plan.shots.length} shots totalling ${plan.totalSeconds}s: ${plan.shots
          .map((shot) => `${shot.startSeconds}-${shot.startSeconds + shot.durationSeconds}s`)
          .join(', ')}. Estimated generation cost ${total}.${rounded}`
      };
    }
  },
  {
    name: 'check_narration_fit',
    description: 'Check whether a narration script fits a given number of seconds of picture. Free.',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string' },
        targetSeconds: { type: 'number' }
      },
      required: ['script', 'targetSeconds']
    },
    spends: null,
    costOf: () => 'free',
    run: async (args) => {
      const fit = checkNarrationFit({
        script: text(args, 'script'),
        targetSeconds: number(args, 'targetSeconds', 10)
      });
      return {
        summary: `${fit.verdict}: ${fit.advice} (${fit.estimate.units} ${
          fit.estimate.kind === 'cjk-characters' ? 'characters' : 'words'
        }, ~${fit.estimate.estimatedSeconds}s at a ${fit.estimate.pace} pace)`
      };
    }
  },
  {
    name: 'describe_timeline',
    description: 'Report the open project: its tracks, clips and total length. Free.',
    parameters: { type: 'object', properties: {} },
    spends: null,
    costOf: () => 'free',
    run: async (_args, context) => {
      if (context.projectId === null) return { summary: 'No project is open.' };
      const project = readProject(context.projectId);
      if (project === null) return { summary: 'The open project could not be read.' };
      const tracks = project.timeline.tracks
        .map((track) => `${track.name} (${track.kind}, ${track.clips.length} clips)`)
        .join('; ');
      return {
        summary: `"${project.name}" runs ${(timelineDurationMs(project.timeline) / 1000).toFixed(1)}s across ${
          project.timeline.tracks.length
        } tracks: ${tracks}. ${project.assets.length} assets imported.`
      };
    }
  },
  {
    name: 'generate_image',
    description: 'Generate one image with an image model. This charges your provider account.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        modelId: { type: 'string', enum: Object.keys(IMAGE_BINDINGS) },
        aspectRatio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'] }
      },
      required: ['prompt']
    },
    spends: 'image-generation',
    costOf: (args) => {
      const cost = estimateImageCost({ modelId: text(args, 'modelId', 'gpt-image-1'), imageCount: 1 });
      return cost.priced && cost.amountUsd !== undefined ? `~$${cost.amountUsd.toFixed(2)}` : 'Cost unknown';
    },
    run: async (args) => {
      const modelId = text(args, 'modelId', 'gpt-image-1');
      const binding = IMAGE_BINDINGS[modelId];
      if (binding === undefined) return { summary: `${modelId} is not a model this device can run.` };
      const apiKey = await readKey(binding.slot);
      if (apiKey === null) return { summary: `No key stored for ${modelId}. Add one in Settings.` };
      const image = await binding.request({
        apiKey,
        modelId,
        prompt: text(args, 'prompt'),
        aspectRatio: (text(args, 'aspectRatio', '1:1') as ImageAspectRatio)
      } as never);
      // The bytes go to the screen; the model is told only that it worked, since
      // handing a base64 payload back into the transcript would blow the context
      // window for no benefit.
      return { summary: `Image generated (${image.providerJobId}).`, image };
    }
  }
];

export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}
