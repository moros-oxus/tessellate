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

export const SUPPORTED_MODEL_VERSIONS = [1];

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
    typeof version !== 'number' ||
    !SUPPORTED_MODEL_VERSIONS.includes(version)
  ) {
    return {
      issues: [
        {
          path: '/version',
          message: `model version ${JSON.stringify(version)} is not supported (supported: ${SUPPORTED_MODEL_VERSIONS.join(', ')})`,
        },
      ],
    };
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
