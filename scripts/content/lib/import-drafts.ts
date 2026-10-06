import type {ContentDocument} from '../../content-validation'

/**
 * Materializes a document as a Sanity draft. References whose targets only
 * exist as drafts are temporarily weak and are strengthened by Studio when
 * the referring document is published after its target.
 */
export function prepareDraftDocument(
  document: ContentDocument,
  unpublishedTargets: ReadonlyMap<string, string>,
): ContentDocument {
  const prepared = visit(document, (value) => {
    if (!isRecord(value) || value._type !== 'reference' || typeof value._ref !== 'string') return value
    const targetType = unpublishedTargets.get(value._ref)
    if (!targetType) return value
    return {
      ...value,
      _weak: true,
      _strengthenOnPublish: {type: targetType},
    }
  }) as ContentDocument
  return {...prepared, _id: `drafts.${document._id}`}
}

function visit(value: unknown, transform: (value: unknown) => unknown): unknown {
  const transformed = transform(value)
  if (Array.isArray(transformed)) return transformed.map((item) => visit(item, transform))
  if (!isRecord(transformed)) return transformed
  return Object.fromEntries(Object.entries(transformed).map(([key, child]) => [key, visit(child, transform)]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
