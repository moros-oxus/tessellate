import type { FigmaModel } from '@vertekum/ext-export-figma';
import MODEL_SCHEMA from './model.schema.json';

/**
 * Model intake: parse, validate against the shipped schema, pin the version. The model is the
 * CONTRACT with vertekum's `figma` exporter — tessellate consumes `figma.model.json` verbatim
 * and refuses loudly rather than guessing at unknown shapes.
 *
 * (The schema is vendored from `@vertekum/ext-export-figma`; a test compares the copies so
 * drift fails the gate instead of skewing validation.)
 */

/**
 * Contract versions this intake understands — exactly the vendored schema's (a test pins them).
 * `draft.NN` while the model's shape is unstable, `YYYY.MM` once declared stable.
 */
export const SUPPORTED_MODEL_VERSIONS: readonly string[] = ['draft.02'];

export interface ModelIssue {
  path: string;
  message: string;
}

export async function readModel(
  raw: string,
): Promise<{ model: FigmaModel } | { issues: ModelIssue[] }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      issues: [
        {
          path: '',
          message: `not JSON: ${error instanceof Error ? error.message : error}`,
        },
      ],
    };
  }

  const version = (parsed as { version?: unknown })?.version;
  if (
    typeof version !== 'string' ||
    !SUPPORTED_MODEL_VERSIONS.includes(version)
  ) {
    // Integer versions predate the draft/calendar scheme — name the fix, not just the refusal.
    const message =
      typeof version === 'number'
        ? `model version ${version} predates versioned drafts — re-export with @vertekum/ext-export-figma 0.4 or newer`
        : `model version ${JSON.stringify(version)} is not supported (supported: ${SUPPORTED_MODEL_VERSIONS.join(', ')})`;
    return { issues: [{ path: '/version', message }] };
  }

  const AjvModule = await import('ajv/dist/2020.js');
  const Ajv = (AjvModule.default ?? AjvModule) as unknown as new (
    options: object,
  ) => {
    compile(schema: object): ((data: unknown) => boolean) & {
      errors?: Array<{ instancePath: string; message?: string }> | null;
    };
  };
  const validate = new Ajv({ strict: false, allErrors: true }).compile(
    MODEL_SCHEMA,
  );
  if (!validate(parsed)) {
    return {
      issues: (validate.errors ?? []).map((error) => ({
        path: error.instancePath,
        message: error.message ?? 'invalid',
      })),
    };
  }
  return { model: parsed as FigmaModel };
}
