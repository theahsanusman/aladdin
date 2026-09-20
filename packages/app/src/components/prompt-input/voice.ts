export function recordingMime(MediaRecorderClass = MediaRecorder) {
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((mime) => MediaRecorderClass.isTypeSupported(mime))
}

export function encodeAudio(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error("Audio encoding failed"))
      resolve(reader.result.slice(reader.result.indexOf(",") + 1))
    }
    reader.readAsDataURL(blob)
  })
}
