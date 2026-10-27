export const SEO_TITLE_MAX = 60
export const SEO_DESCRIPTION_MIN = 70
export const SEO_DESCRIPTION_MAX = 155

export interface SeoFields {
  metaTitle?: string | null
  metaDescription?: string | null
  noIndex?: boolean | null
}

const length = (value: string): number => [...value].length

/** Mínimo SEO de un documento con página pública. Una página `noIndex` queda libre. */
export function indexableSeoIssues(seo: SeoFields | undefined | null): string[] {
  if (seo?.noIndex === true) return []
  const issues: string[] = []
  const title = seo?.metaTitle?.trim() ?? ''
  const description = seo?.metaDescription?.trim() ?? ''
  if (!title) issues.push('Falta el título SEO: es obligatorio si la página es indexable.')
  else if (length(title) > SEO_TITLE_MAX) issues.push(`El título SEO tiene ${length(title)} caracteres (máximo ${SEO_TITLE_MAX}).`)
  if (!description) issues.push('Falta la meta description: es obligatoria si la página es indexable.')
  else if (length(description) < SEO_DESCRIPTION_MIN || length(description) > SEO_DESCRIPTION_MAX) {
    issues.push(`La meta description tiene ${length(description)} caracteres (entre ${SEO_DESCRIPTION_MIN} y ${SEO_DESCRIPTION_MAX}).`)
  }
  return issues
}
