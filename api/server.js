// api/server.js — OpenAI to NVIDIA NIM API Proxy for Vercel Serverless
import axios from "axios";
import { parse } from "url";

const NIM_API_BASE = process.env.NIM_API_BASE || "https://integrate.api.nvidia.com/v1";
const NIM_API_KEY = process.env.NIM_API_KEY;

const SHOW_REASONING = false;
const ENABLE_THINKING_MODE = false;

const MODEL_MAPPING = {
  "gpt-3.5-turbo": "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  "gpt-4": "qwen/qwen3-coder-480b-a35b-instruct",
  "gpt-4-turbo": "moonshotai/kimi-k2-instruct-0905",
  "deepseek-v3.1": "deepseek-ai/deepseek-v3.1",
  "claude-3-opus": "openai/gpt-oss-120b",
  "claude-3-sonnet": "openai/gpt-oss-20b",
  "gemini-pro": "qwen/qwen3-next-80b-a3b-thinking",
  "deepseek-3.1-terminus": "deepseek-ai/deepseek-v3.1-terminus"
};

// ---- Main handler for all API routes ----
export default async function handler(req, res) {
  const { method } = req;
  const { pathname } = parse(req.url || "", true);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (method === "OPTIONS") return res.status(200).end();

  // ---- Health Check ----
  if (pathname === "/api/health") {
    return res.json({
      status: "ok",
      service: "OpenAI → NVIDIA NIM Proxy",
      reasoning_display: SHOW_REASONING,
      thinking_mode: ENABLE_THINKING_MODE
    });
  }

  // ---- List Models ----
  if (pathname === "/api/v1/models") {
    const models = Object.keys(MODEL_MAPPING).map((id) => ({
      id,
      object: "model",
      created: Date.now(),
      owned_by: "nvidia-nim-proxy"
    }));
    return res.json({ object: "list", data: models });
  }

  // ---- Chat Completions ----
  if (pathname === "/api/v1/chat/completions" && method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { model, messages, temperature, max_tokens } = body;

      const nimModel = MODEL_MAPPING[model] || "meta/llama-3.1-8b-instruct";
      const nimRequest = {
        model: nimModel,
        messages,
        temperature: temperature || 0.8,
        max_tokens: max_tokens || 8192,
        extra_body: ENABLE_THINKING_MODE
          ? { chat_template_kwargs: { thinking: true } }
          : undefined
      };

      const response = await axios.post(`${NIM_API_BASE}/chat/completions`, nimRequest, {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          "Content-Type": "application/json"
        }
      });

      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: response.data.choices.map((choice) => {
          let content = choice.message?.content || "";
          if (SHOW_REASONING && choice.message?.reasoning_content) {
            content = `<think>\n${choice.message.reasoning_content}\n</think>\n\n${content}`;
          }
          return {
            index: choice.index,
            message: { role: choice.message.role, content },
            finish_reason: choice.finish_reason
          };
        }),
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };

      return res.status(200).json(openaiResponse);
    } catch (err) {
      console.error("Proxy error:", err.message);
      return res.status(err.response?.status || 500).json({
        error: {
          message: err.response?.data?.error?.message || err.message,
          type: "invalid_request_error",
          code: err.response?.status || 500
        }
      });
    }
  }

  // ---- Fallback for unknown endpoints ----
  return res.status(404).json({
    error: {
      message: `Endpoint ${pathname} not found`,
      type: "invalid_request_error",
      code: 404
    }
  });
}
