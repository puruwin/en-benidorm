import sharp from 'sharp'

/**
 * Recodifica la imagen sin metadatos: sharp no copia EXIF (GPS incluido), XMP ni IPTC salvo que se pida
 * con `withMetadata`. `rotate()` aplica antes la orientación EXIF para que la foto no quede girada.
 */
export async function stripMetadata(input: Buffer): Promise<{bytes: Buffer; format: string; width: number; height: number}> {
  const image = sharp(input, {failOn: 'error'}).rotate()
  const {format} = await sharp(input).metadata()
  const encoded = format === 'jpeg' ? image.jpeg({quality: 92, mozjpeg: true}) : format === 'png' ? image.png() : format === 'webp' ? image.webp({quality: 92}) : null
  if (!encoded) throw new Error(`Formato no admitido: ${format ?? 'desconocido'} (usa JPEG, PNG o WebP).`)
  const {data, info} = await encoded.toBuffer({resolveWithObject: true})
  return {bytes: data, format: info.format, width: info.width, height: info.height}
}
