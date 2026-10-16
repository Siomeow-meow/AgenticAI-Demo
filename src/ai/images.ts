/** Images attached in this session, kept in memory so the vision tool can read them by id. */
interface StoredImage {
  id: string
  name: string
  /** Base64 data (no "data:" prefix), as Ollama expects. */
  base64: string
}

const images = new Map<string, StoredImage>()
let counter = 0

async function toBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Remember an attached image and return its id (like "img-1"). */
export async function storeImage(file: File): Promise<string> {
  const id = `img-${++counter}`
  images.set(id, { id, name: file.name, base64: await toBase64(file) })
  return id
}

export const getImage = (id: string) => images.get(id.trim().toLowerCase())
export const listImages = () => [...images.values()].map(({ id, name }) => ({ id, name }))
