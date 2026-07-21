/**
 * Provider-agnostic LLM client factory. Both clients expose the same surface so
 * the runner never branches on the provider:
 *   completeJSON({ model, system, prompt, schema, params }) → { value, usage }
 *   completeText({ model, system, prompt|messages, params }) → { text, usage }
 *   runToolLoop({ model, system, userText, toolSpecs, params, tokenBudget,
 *                 maxIters, callTool }) → { text, usage }
 * usage is normalized to { input_tokens, output_tokens, cache_read_input_tokens, calls }.
 */
import { createAnthropicClient } from './anthropic.mjs';
import { createOpenAIClient } from './openai.mjs';

export function getLLMClient({ provider, baseURL, apiKey }) {
  if (provider === 'openai') return createOpenAIClient({ baseURL, apiKey });
  return createAnthropicClient({ baseURL, apiKey });
}

const JSON_TYPES = { string: 'string', number: 'number', list: 'array', object: 'object' };

/** Converts a declarative MCP param map ({ name: 'type|optional' }) into a
 *  JSON-Schema properties/required pair. Matches the original claude runner:
 *  every declared param is marked required. */
export function jsonSchemaProps(params = {}) {
  const properties = {};
  for (const [key, type] of Object.entries(params || {})) {
    const base = String(type).split('|')[0].trim();
    properties[key] =
      base === 'list'
        ? { type: 'array', items: { type: 'string' } }
        : { type: JSON_TYPES[base] || 'string', description: String(type) };
  }
  return { properties, required: Object.keys(properties) };
}
