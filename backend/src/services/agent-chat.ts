import type { Agent } from '@mastra/core/agent'

export interface ChatHistoryEntry {
  role: 'user' | 'assistant'
  content: string
}

export function normalizeToolName(entry: any): string | null {
  return entry?.toolName
    || entry?.tool?.toolName
    || entry?.tool?.id
    || entry?.name
    || entry?.payload?.toolName
    || entry?.type
    || null
}

export function normalizeToolResult(entry: any): string {
  const result = entry?.result ?? entry?.output ?? entry?.data ?? null
  return typeof result === 'string' ? result : JSON.stringify(result)
}

export function buildAgentChatMessages(
  history: ChatHistoryEntry[],
  message: string,
  context?: string,
): { role: 'user' | 'assistant'; content: string }[] {
  const chatMessages: { role: 'user' | 'assistant'; content: string }[] = []

  for (const entry of history.slice(-20)) {
    if (!entry?.content?.trim()) continue
    chatMessages.push({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      content: entry.content.trim(),
    })
  }

  const contextBlock = typeof context === 'string' ? context.trim() : ''
  const userContent = contextBlock
    ? `${contextBlock}\n\n[用户指令]\n${message.trim()}`
    : message.trim()

  chatMessages.push({ role: 'user', content: userContent })
  return chatMessages
}

export function extractTextDelta(part: any): string {
  if (!part || part.type !== 'text-delta') return ''
  return String(part.text ?? part.textDelta ?? part.delta ?? part.payload?.text ?? '')
}

export async function collectAgentStream(
  agent: Agent,
  chatMessages: { role: 'user' | 'assistant'; content: string }[],
  handlers: {
    onDelta?: (text: string) => void
    onTool?: (phase: 'start' | 'end', name: string) => void
  },
  options?: { maxSteps?: number },
) {
  const stream = await agent.stream(chatMessages as any, { maxSteps: options?.maxSteps ?? 20 })

  for await (const part of stream.fullStream) {
    const delta = extractTextDelta(part)
    if (delta) handlers.onDelta?.(delta)

    if (part.type === 'tool-call') {
      const name = normalizeToolName(part) || 'tool'
      handlers.onTool?.('start', name)
    }
    if (part.type === 'tool-result') {
      const name = normalizeToolName(part) || 'tool'
      handlers.onTool?.('end', name)
    }
  }

  const text = String(await stream.text || '')
  const rawToolCalls = (await stream.toolCalls) || []
  const rawToolResults = (await stream.toolResults) || []

  const toolCalls = (Array.isArray(rawToolCalls) ? rawToolCalls : []).map((tc: any) => ({
    toolName: normalizeToolName(tc),
    args: tc?.args ?? tc?.input ?? null,
  }))
  const toolResults = (Array.isArray(rawToolResults) ? rawToolResults : []).map((tr: any) => ({
    toolName: normalizeToolName(tr),
    result: normalizeToolResult(tr),
  }))

  return { text, toolCalls, toolResults }
}

export async function runAgentGenerate(
  agent: Agent,
  chatMessages: { role: 'user' | 'assistant'; content: string }[],
  options?: { maxSteps?: number },
) {
  return collectAgentStream(agent, chatMessages, {}, options)
}
