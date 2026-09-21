export const SPEECH_CHUNK_MAX = 280
export const SPEECH_FIRST_MAX = 140

const sentences = new Intl.Segmenter("en", { granularity: "sentence" })

// Long replies are synthesized chunk by chunk so playback can start before the rest is ready.
// The first chunk stays short to cut time-to-first-audio; later chunks pack whole sentences.
export function speechChunks(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return []
  const chunks: string[] = []
  let current = ""
  for (const sentence of [...sentences.segment(normalized)].map((entry) => entry.segment.trim()).filter(Boolean)) {
    for (const piece of splitLong(sentence)) {
      if (!current) {
        current = piece
        continue
      }
      const limit = chunks.length === 0 ? SPEECH_FIRST_MAX : SPEECH_CHUNK_MAX
      if (current.length + piece.length + 1 <= limit) {
        current = `${current} ${piece}`
        continue
      }
      chunks.push(current)
      current = piece
    }
    if (chunks.length === 0 && current) {
      chunks.push(current)
      current = ""
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function splitLong(sentence: string): string[] {
  if (sentence.length <= SPEECH_CHUNK_MAX) return [sentence]
  const pieces: string[] = []
  let current = ""
  for (const word of sentence.split(" ")) {
    if (!current) {
      current = word
      continue
    }
    if (current.length + word.length + 1 <= SPEECH_CHUNK_MAX) {
      current = `${current} ${word}`
      continue
    }
    pieces.push(current)
    current = word
  }
  if (current) pieces.push(current)
  return pieces.flatMap(chop)
}

function chop(piece: string): string[] {
  if (piece.length <= SPEECH_CHUNK_MAX) return [piece]
  const slices: string[] = []
  for (let index = 0; index < piece.length; index += SPEECH_CHUNK_MAX) {
    slices.push(piece.slice(index, index + SPEECH_CHUNK_MAX))
  }
  return slices
}
