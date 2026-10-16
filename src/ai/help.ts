import { categoriesIn, listTools } from './tools/catalog'
import type { Tool } from './tool-types'

const TOOL_WORDS = /\b(tools?|tool ?kits?|tool ?sets?|capabilit(?:y|ies)|abilit(?:y|ies)|functions|features|commands)\b/
const LIST_WORDS = /\b(list|show|what|which|all|every|give|tell|enumerate|display|available|have|got|offer|include|name)\b/

// The question must be about THIS assistant. "How many toolsets does Claude have?" is about someone else
// and must go to the model, not be answered with our own tool list.
const SELF = /\b(you|your|yours|yourself|assistant|acme)\b|\b(can|could|does|do|will|would) it\b/
const OTHER = /\b(claude|chatgpt|gpt-?\d*|openai|anthropic|gemini|bard|copilot|llama|mistral|deepseek|grok|perplexity|alexa|siri|cursor|codex|langchain|ollama|qwen)\b/
/** True for questions about other products or companies ("How many tools does Claude have?"), not about this assistant. */
export function aboutOtherProduct(question: string): boolean {
  const q = question.toLowerCase()
  return OTHER.test(q) && !SELF.test(q)
}

/** A command such as "list all toolkits", "show tools", "list the IT tools". */
const COMMAND = /^\s*(please\s+)?(list|show|display|give me|enumerate)\b[^?]*\b(tools?|tool ?kits?|tool ?sets?)\b/

/** Instant, complete answer to "what tools / toolkits do you have?" (optionally for one category), straight from the registry. */
export function toolkitAnswer(question: string, tools: Tool[]): string | null {
  const q = question.toLowerCase()
  const asksWhatYouCanDo = /\bwhat (can|do) you (do|offer|have)\b|\bwhat are you able to\b|\byour (skills|abilities|capabilities)\b/.test(q)
  if (q.includes('[attached files')) return null
  const cats = [...new Set(tools.map((t) => t.category))]
  const mentioned = categoriesIn(question, cats)
  const about = SELF.test(q) || COMMAND.test(q) || (mentioned.length > 0 && /\bavailable\b/.test(q))
  if (OTHER.test(q) && !SELF.test(q)) return null
  if (!asksWhatYouCanDo && !(about && TOOL_WORDS.test(q) && LIST_WORDS.test(q))) return null
  return listTools(tools, { categories: mentioned })
}

const CAPABILITY = /\b(can|could|may|is it possible|able to|how (do|can|to|would)|do you (accept|support|take|read|handle)|does it (accept|support))\b/
const SEND = /\b(send|sending|upload|uploading|attach|attaching|import|importing|give|share|add|load|feed|provide|submit|accept|support|read|handle|open|take)\b/
const THING = /\b(data|files?|documents?|docs?|csv|excel|xlsx|spreadsheets?|pdfs?|word|docx|powerpoint|pptx|json|tables?|reports?)\b/

/** Instant, exact answers to "can I send you my data / files?" so a small model cannot get it vague or wrong. */
export function quickHelp(question: string): string | null {
  const q = question.toLowerCase()
  if (q.includes('[attached files')) return null
  if (!(CAPABILITY.test(q) && SEND.test(q) && THING.test(q))) return null
  return [
    'Yes - you can send me your own files and data, right here in the chat.',
    '',
    '1. Click 📎 Attach under the message box, or drag files onto the chat, or paste them.',
    '2. Supported: CSV, Excel (.xlsx), JSON, PDF, Word (.docx), PowerPoint (.pptx), and text, Markdown, HTML or log files. (Scans and images cannot be read.)',
    '3. Then ask about them, for example "Describe my data", "Which region has the highest total?", "Summarize the document" or "What does the policy say about remote work?".',
    '',
    'Tables can be searched, filtered, grouped and totalled, and every row is indexed so I can find individual records. Documents are split into passages and searched, and my answers show which file they came from. Files stay on this computer; you can review or remove them on the Knowledge page.',
  ].join('\n')
}
