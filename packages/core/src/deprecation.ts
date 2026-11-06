/**
 * A deprecation, as a host shows it: the FIRST line of the entity's description, which
 * tessellate owns — `Deprecated: <reason>` or `Deprecated.` — above whatever the designer wrote.
 * A description publishes with a library, so a subscribing file sees it in its pickers; the
 * entity itself stays (a deprecated token still exists). Pure; read back for comparison.
 */

const LINE = /^Deprecated(?::\s?(.*)|\.)$/;

/** The description with tessellate's line set to `deprecated` (or removed when undefined). */
export function withDeprecation(
  description: string | undefined,
  deprecated: string | undefined,
): string {
  const lines = (description ?? '').split('\n');
  const rest = LINE.test(lines[0] ?? '') ? lines.slice(1) : lines;
  const body = rest.join('\n');
  if (deprecated === undefined) return body;
  const line = deprecated === '' ? 'Deprecated.' : `Deprecated: ${deprecated}`; // verbatim, so it reads back exactly
  return body === '' ? line : `${line}\n${body}`;
}

/** The deprecation a description carries (`''` for a bare `Deprecated.`), or undefined. */
export function deprecationIn(
  description: string | undefined,
): string | undefined {
  const first = (description ?? '').split('\n')[0] ?? '';
  const match = LINE.exec(first);
  if (!match) return undefined;
  return match[1] ?? '';
}
