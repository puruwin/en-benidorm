const area = (slug: string, name: string) => ({
  _id: `area-${slug}`,
  _type: 'area',
  name,
  slug: {_type: 'slug', current: slug},
  language: 'es',
})

export const areas = [
  area('centro', 'Centro'),
  area('casco-antiguo', 'Casco Antiguo'),
  area('levante', 'Levante'),
  area('poniente', 'Poniente'),
  area('rincon-de-loix', 'Rincón de Loix'),
  area('la-cala', 'La Cala'),
]
