import { generate } from '../generate'
import { getImage, listImages } from '../images'
import { findVisionModel } from '../ollama'
import type { Tool } from '../tool-types'

const TASKS: Record<string, string> = {
  describe: 'Describe this image in detail: what it shows, the main objects or people, the setting, colours and anything notable.',
  ocr: 'Transcribe all the text in this image exactly as written, keeping the line breaks and order. Output only the text.',
  chart: 'This is a chart, graph or diagram. Say what type it is, what the axes and series are, list the key values you can read, and describe the main trend or conclusion.',
  objects: 'List every distinct object visible in this image, with roughly where each one is (left, right, top, bottom, centre) and how many there are.',
  extract: 'This is a document such as a receipt, invoice, form or ID. Extract its fields and values (vendor, date, line items, totals, numbers) and reply as compact JSON.',
}

export const visionTools: Tool[] = [
  {
    name: 'analyze_image',
    category: 'Vision',
    description:
      'Look at an image the user attached (photo, screenshot, receipt, invoice, chart, diagram, scanned page): describe it, read its text (OCR), read a chart, list objects, or extract fields. Needs a vision model installed in Ollama.',
    keywords: 'image picture photo screenshot receipt invoice chart graph diagram scan ocr read text from image describe what is in this detect objects look at attached vision see',
    parameters: {
      image: { type: 'string', description: 'The image id from the attachment note, e.g. img-1' },
      task: { type: 'string', description: 'describe (default), ocr, chart, objects or extract', optional: true },
      question: { type: 'string', description: 'A specific question about the image (overrides the task)', optional: true },
    },
    run: async ({ image, task = 'describe', question }) => {
      const img = getImage(image) ?? (listImages().length === 1 ? getImage(listImages()[0].id) : undefined)
      if (!img) {
        const have = listImages()
        return have.length ? `No image "${image}". Attached images: ${have.map((i) => `${i.id} (${i.name})`).join(', ')}.` : 'No image has been attached yet. Use the Attach button.'
      }
      const model = await findVisionModel()
      if (!model) return 'No vision model is installed in Ollama. Install one, for example: ollama pull qwen2.5vl:3b (or llava, gemma3, llama3.2-vision), then try again.'
      const key = Object.keys(TASKS).find((k) => task.toLowerCase().includes(k)) ?? 'describe'
      try {
        const text = await generate(question?.trim() || TASKS[key], { images: [img.base64], model, maxTokens: 700 })
        return `${img.name} (read by ${model}):\n${text || '(the model returned nothing)'}`
      } catch (e) {
        return `The vision model failed: ${(e as Error).message}`
      }
    },
  },
]
