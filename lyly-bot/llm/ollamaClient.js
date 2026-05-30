// lyly-bot/llm/ollamaClient.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "not-needed",
  baseURL: "http://localhost:1234/v1",
  timeout: 60000,
});

const BASE_CONFIG = {
  model: "meta-llama-3.1-8b-instruct-abliterated",
  temperature: 0.8,
  max_tokens: 2048,
  stop: ["*", " * ", "(", "[", "\n*"]
};

export async function* generateStreamingResponse(messages) {
  const completion = await client.chat.completions.create({
    ...BASE_CONFIG,
    messages,
    stream: true,
  });
  yield* completion;
}

// ✅ Aceita override de modelo para tarefas leves (ex: 1B)
export async function generateResponse(messages, modelOverride = null) {
  const config = { ...BASE_CONFIG };
  if (modelOverride) config.model = modelOverride;
  
  const completion = await client.chat.completions.create({
    ...config,
    messages,
    stream: false,
  });
  
  return completion.choices?.[0]?.message?.content || "";
}