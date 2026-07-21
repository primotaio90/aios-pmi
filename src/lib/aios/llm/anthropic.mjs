/**
 * Anthropic-protocol client (@anthropic-ai/sdk). Works against the official API
 * and any Anthropic-compatible endpoint via a custom baseURL. Preserves the
 * original runner behavior: adaptive extended thinking + json_schema structured
 * output. temperature is only sent when thinking is disabled (the API pins
 * temperature while thinking).
 */
import { jsonSchemaProps } from './index.mjs';

let AnthropicCtor = null;

function usageOf(response) {
  const u = response?.usage || {};
  return {
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_read_input_tokens: u.cache_read_input_tokens || 0,
    calls: 1,
  };
}

export function createAnthropicClient({ baseURL, apiKey }) {
  const clientPromise = (async () => {
    if (!AnthropicCtor) ({ default: AnthropicCtor } = await import('@anthropic-ai/sdk'));
    const opts = {};
    if (apiKey) opts.apiKey = apiKey;
    if (baseURL) opts.baseURL = baseURL;
    return new AnthropicCtor(opts);
  })();

  const thinking = (params) => (params?.thinking === false ? null : { type: 'adaptive' });
  const applyTemp = (req, params) => {
    if (!req.thinking && params?.temperature != null) req.temperature = params.temperature;
  };

  return {
    kind: 'anthropic',

    async completeJSON({ model, system, prompt, schema, params }) {
      const client = await clientPromise;
      const req = {
        model,
        max_tokens: params?.maxTokens || 4096,
        system,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: prompt }],
      };
      const t = thinking(params);
      if (t) req.thinking = t;
      applyTemp(req, params);
      const response = await client.messages.create(req);
      const text = response.content.find((b) => b.type === 'text')?.text || '{}';
      return { value: JSON.parse(text), usage: usageOf(response) };
    },

    async completeText({ model, system, prompt, messages, params }) {
      const client = await clientPromise;
      const req = {
        model,
        max_tokens: params?.maxTokens || 8192,
        system,
        messages: messages || [{ role: 'user', content: prompt }],
      };
      const t = thinking(params);
      if (t) req.thinking = t;
      applyTemp(req, params);
      const response = await client.messages.create(req);
      return { text: response.content.find((b) => b.type === 'text')?.text || '', usage: usageOf(response) };
    },

    async runToolLoop({ model, system, userText, toolSpecs, params, tokenBudget, maxIters = 8, callTool, history = [] }) {
      const client = await clientPromise;
      const tools = toolSpecs.map((s) => {
        const { properties, required } = jsonSchemaProps(s.params);
        return {
          // Anthropic tool names cannot contain dots.
          name: s.qualified.replace('.', '__'),
          description: s.description || s.qualified,
          input_schema: { type: 'object', properties, required },
        };
      });
      const messages = [
        ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
        { role: 'user', content: userText },
      ];
      let spentOut = 0;
      let lastInput = 0;
      let cacheRead = 0;
      let calls = 0;
      let finalText = '';
      for (let i = 0; i < maxIters; i++) {
        const req = { model, max_tokens: params?.maxTokens || 4096, system, messages };
        if (tools.length) req.tools = tools;
        const t = thinking(params);
        if (t) req.thinking = t;
        applyTemp(req, params);
        const response = await client.messages.create(req);
        calls += 1;
        spentOut += response.usage?.output_tokens || 0;
        lastInput = response.usage?.input_tokens || 0; // full context of the last turn
        cacheRead += response.usage?.cache_read_input_tokens || 0;
        finalText = response.content.find((b) => b.type === 'text')?.text || finalText;

        if (response.stop_reason !== 'tool_use' || spentOut >= tokenBudget) break;

        messages.push({ role: 'assistant', content: response.content });
        const results = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const qualified = block.name.replace('__', '.');
          const res = await callTool(qualified, block.input);
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(res.ok ? res.result : { error: res.error }),
            is_error: !res.ok,
          });
        }
        messages.push({ role: 'user', content: results });
      }
      return {
        text: finalText,
        usage: { input_tokens: lastInput, output_tokens: spentOut, cache_read_input_tokens: cacheRead, calls },
      };
    },
  };
}
