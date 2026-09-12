import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssistantReasoningContent } from '../message-utils.mjs';

test('preserves OpenAI reasoning_content first', () => {
  assert.equal(
    getAssistantReasoningContent({ reasoning_content: 'hidden chain', reasoning: 'legacy' }),
    'hidden chain',
  );
});

test('supports legacy reasoning and content blocks', () => {
  assert.equal(getAssistantReasoningContent({ reasoning: 'legacy' }), 'legacy');
  assert.equal(
    getAssistantReasoningContent({
      content: [
        { type: 'reasoning', text: 'first ' },
        { type: 'text', text: 'visible' },
        { type: 'thinking', thinking: 'second' },
      ],
    }),
    'first second',
  );
});

test('returns an empty string when reasoning is absent', () => {
  assert.equal(getAssistantReasoningContent({ role: 'assistant', content: 'visible' }), '');
  assert.equal(getAssistantReasoningContent(null), '');
});
