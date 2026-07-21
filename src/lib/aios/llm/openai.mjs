/**
 * OpenAI-compatible client (Chat Completions API over fetch — no new dependency).
 * Targets any endpoint that speaks /v1/chat/completions: OpenAI itself, plus
 * local/self-hosted gateways (Ollama, LM Studio, vLLM, LiteLLM, …).
 *
 * Structured output uses response_format json_object + a schema-in-prompt
 * instruction, which is the widely-supported path (json_schema "structured
 * outputs" is newer and not universal). Tool use maps to OpenAI function calling.
 */
import { jsonSchemaProps } from './index.mjs';

function usageOf(data) {
  const u = data?.usage || {};
  return {
    input_tokens: u.prompt_tokens || 0,
    output_tokens: u.completion_tokens || 0,
    cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens || 0,
    calls: 1,
  };
}

/** Tolerant JSON parse: falls back to the outermost {...} block if the model
 *  wrapped the object in prose or a ```json fence. */
function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error('Risposta non-JSON dall\'endpoint OpenAI-compatibile');
  }
}

export function createOpenAIClient({ baseURL, apiKey }) {
  const base = (baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const endpoint = `${base}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  async function chat(payload) {
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Endpoint OpenAI-compatibile ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.json();
  }

  const temp = (params) => (params?.temperature != null ? params.temperature : undefined);

  return {
    kind: 'openai',

    async completeJSON({ model, system, prompt, schema, params }) {
      const sys = [
        system,
        '',
        'Rispondi ESCLUSIVAMENTE con un oggetto JSON valido conforme a questo schema',
        '(nessun testo extra, nessun markdown):',
        JSON.stringify(schema),
      ].join('\n');
      const data = await chat({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: prompt },
        ],
        max_tokens: params?.maxTokens || 4096,
        temperature: temp(params),
        response_format: { type: 'json_object' },
      });
      const content = data.choices?.[0]?.message?.content || '{}';
      return { value: parseJsonLoose(content), usage: usageOf(data) };
    },

    async completeText({ model, system, prompt, messages, params }) {
      const msgs = messages
        ? [{ role: 'system', content: system }, ...messages]
        : [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ];
      const data = await chat({
        model,
        messages: msgs,
        max_tokens: params?.maxTokens || 8192,
        temperature: temp(params),
      });
      return { text: data.choices?.[0]?.message?.content || '', usage: usageOf(data) };
    },

    async runToolLoop({ model, system, userText, toolSpecs, params, tokenBudget, maxIters = 8, callTool, history = [] }) {
      const tools = toolSpecs.map((s) => {
        const { properties, required } = jsonSchemaProps(s.params);
        return {
          type: 'function',
          function: {
            name: s.qualified.replace('.', '__'),
            description: s.description || s.qualified,
            parameters: { type: 'object', properties, required },
          },
        };
      });
      const messages = [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
        { role: 'user', content: userText },
      ];
      let spentOut = 0;
      let lastInput = 0;
      let cacheRead = 0;
      let calls = 0;
      let finalText = '';
      for (let i = 0; i < maxIters; i++) {
        const payload = {
          model,
          messages,
          max_tokens: params?.maxTokens || 4096,
          temperature: temp(params),
        };
        if (tools.length) {
          payload.tools = tools;
          payload.tool_choice = 'auto';
        }
        const data = await chat(payload);
        calls += 1;
        const u = usageOf(data);
        spentOut += u.output_tokens;
        lastInput = u.input_tokens;
        cacheRead += u.cache_read_input_tokens;
        const msg = data.choices?.[0]?.message || {};
        if (msg.content) finalText = msg.content;
        const toolCalls = msg.tool_calls || [];

        if (!toolCalls.length || spentOut >= tokenBudget) break;

        messages.push(msg);
        for (const tc of toolCalls) {
          const qualified = String(tc.function?.name || '').replace('__', '.');
          let input = {};
          try {
            input = JSON.parse(tc.function?.arguments || '{}');
          } catch {
            input = {};
          }
          const res = await callTool(qualified, input);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(res.ok ? res.result : { error: res.error }),
          });
        }
      }
      return {
        text: finalText,
        usage: { input_tokens: lastInput, output_tokens: spentOut, cache_read_input_tokens: cacheRead, calls },
      };
    },
  };
}
