export function getAssistantReasoningContent(message) {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.reasoning_content === 'string') return message.reasoning_content;
  if (typeof message.reasoning === 'string') return message.reasoning;
  if (!Array.isArray(message.content)) return '';

  return message.content
    .filter((part) => part?.type === 'reasoning' || part?.type === 'thinking')
    .map((part) => String(part.text ?? part.thinking ?? ''))
    .join('');
}
