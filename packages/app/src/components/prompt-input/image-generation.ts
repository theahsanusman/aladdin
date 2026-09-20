export type GeneratedImage = {
  image: string
  mime: string
}

export function generatedImageFile(result: GeneratedImage, name = "aladdin-image") {
  const bytes = Uint8Array.from(atob(result.image), (character) => character.charCodeAt(0))
  const extension = result.mime === "image/jpeg" ? "jpg" : result.mime === "image/webp" ? "webp" : "png"
  return new File([bytes], `${name}.${extension}`, { type: result.mime })
}
