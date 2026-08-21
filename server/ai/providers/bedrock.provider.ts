import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AiProvider, GenerateStructuredParams } from "./types";

// ---------------------------------------------------------------------------
// Provider Claude via Amazon Bedrock
//
// Diferente do Gemini, o Bedrock/Claude não tem um campo "responseSchema"
// nativo para forçar JSON. A forma confiável de obter saída estruturada é
// "tool use forçado": declara uma única ferramenta cujo schema de entrada É
// o formato de resposta desejado, e força o modelo a chamá-la
// (tool_choice: {tool: {name}}) em vez de responder em texto livre. O
// resultado sai como argumentos de chamada de ferramenta, já em JSON.
//
// O mesmo `schema` (formato Type.OBJECT/Type.STRING do SDK do Gemini) usado
// pelos outros endpoints é reaproveitado aqui, convertido para JSON Schema
// padrão — assim cada rota continua declarando o schema uma única vez,
// independente de qual provider acabar processando a chamada.
// ---------------------------------------------------------------------------

// Modelo Claude Haiku 4.5, mesmo já usado no projeto irmão ms-crm-agent —
// mantém consistência entre os dois. Modelos recentes no Bedrock exigem um
// "inference profile" (prefixo de geografia) em vez do ID puro do modelo;
// "us." cobre as regiões dos EUA, que é onde este projeto está hospedado.
export const BEDROCK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const TOOL_NAME = "emit_structured_response";

/**
 * Converte o schema no formato do SDK do Gemini (Type.OBJECT, Type.STRING,
 * campos em maiúsculas) para JSON Schema padrão (object, string, minúsculas)
 * — os dois formatos são estruturalmente quase idênticos, só a
 * capitalização do campo "type" muda, então a conversão é uma travessia
 * recursiva simples.
 */
function toJsonSchema(node: any): any {
  if (node === null || typeof node !== "object") return node;

  if (Array.isArray(node)) {
    return node.map(toJsonSchema);
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" && typeof value === "string") {
      result.type = value.toLowerCase();
    } else if (key === "properties" && typeof value === "object") {
      result.properties = Object.fromEntries(
        Object.entries(value as Record<string, any>).map(([k, v]) => [k, toJsonSchema(v)])
      );
    } else if (key === "items") {
      result.items = toJsonSchema(value);
    } else {
      result[key] = toJsonSchema(value);
    }
  }
  return result;
}

export function createBedrockProvider(client: BedrockRuntimeClient): AiProvider {
  return {
    name: "bedrock",
    async generateStructured<T = any>({ prompt, schema, logLabel }: GenerateStructuredParams): Promise<T | null> {
      try {
        const jsonSchema = toJsonSchema(schema);

        const command = new ConverseCommand({
          modelId: BEDROCK_MODEL_ID,
          messages: [{ role: "user", content: [{ text: prompt }] }],
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: TOOL_NAME,
                  description: "Emite a resposta estruturada no formato exigido.",
                  inputSchema: { json: jsonSchema },
                },
              },
            ],
            toolChoice: { tool: { name: TOOL_NAME } },
          },
        });

        const response = await client.send(command);
        const content = response.output?.message?.content || [];
        const toolUseBlock = content.find((block) => "toolUse" in block);

        if (toolUseBlock && "toolUse" in toolUseBlock && toolUseBlock.toolUse?.input) {
          return toolUseBlock.toolUse.input as T;
        }

        console.warn(`[Bedrock ${logLabel} Warning] Resposta sem bloco de tool use (formato inesperado).`);
        return null;
      } catch (err: any) {
        const errorDetail = err?.message || err?.name || String(err);
        console.error(`[Bedrock ${logLabel} ALERT] Chamada ao Bedrock falhou: ${errorDetail}`);
        return null;
      }
    },
  };
}
