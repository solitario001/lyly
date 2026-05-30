// lyly-bot/brain/reflectionEngine.js
import { saveUserMemory, saveIdentityMemory } from "../memory/memoryManager.js"
import { shouldSaveLylyMemory } from "../memory/memoryGuardrails.js"

/**
 * Motor de reflexão com filtro editorial rigoroso.
 */
export class ReflectionEngine {
  #queue = []
  #isProcessing = false
  #flushTimer = null
  #FLUSH_INTERVAL_MS = 60_000
  #FLUSH_THRESHOLD = 3

  constructor() {
    this.#scheduleFlush(5000)
  }

  addInteraction(userText, lylyText, userIntent, playful, emotionState) {
    this.#queue.push({
      userText,
      lylyText,
      userIntent,
      playful,
      emotionState, // Estado emocional discreto (ex: happy, sad)
      timestamp: Date.now()
    })
    this.#scheduleFlush()
  }

  #scheduleFlush(delay = null) {
    if (this.#flushTimer) clearTimeout(this.#flushTimer)
    this.#flushTimer = setTimeout(() => this.#processBatch(), delay || this.#FLUSH_INTERVAL_MS)
  }

  async #processBatch() {
    if (this.#isProcessing || this.#queue.length === 0) return
    this.#isProcessing = true

    const promises = this.#queue.map(item => this.#distillAndSave(item))
    await Promise.all(promises)
    this.#queue = []

    this.#isProcessing = false
    if (this.#queue.length > 0) this.#scheduleFlush()
  }

  async #distillAndSave(item) {
    const TAG = "[DistillAndSave]";
    console.log(`${TAG} 🟢 Iniciando destilação | TS: ${new Date(item.timestamp).toISOString()} | User: "${item.userText.slice(0, 50)}..."`);

    try {
      const { generateResponse } = await import("../llm/ollamaClient.js");

      // Prompt atualizado para usar Estado Emocional Discreto (sem VAD)
      const prompt = [
        {
          role: "system",
          content: `Você é o editor de memória da Lyly. Sua função é filtrar e destilar interações para a memória de longo prazo.
          REGRAS RIGOROSAS:
          1. Analise a interação e decida se revela uma DINÂMICA DE RELAÇÃO, PADRÃO COMPORTAMENTAL ou FATO SIGNIFICATIVO.
          2. NUNCA salve cotações brutas, emoções passageiras, reações isoladas ou conversas triviais.
          3. Se relevante, resuma em 3ª pessoa, objetivo e conciso (< 40 palavras).
          4. Retorne APENAS um JSON válido. Se não for relevante, retorne { "should_save": false }.
          5. Se relevante, retorne:
          {
            "should_save": true,
            "type": "fact" | "trait",
            "distilled_summary": "resumo objetivo em 3ª pessoa",
            "confidence": 0.8
          }`
        },
        {
          role: "user",
          content: `INTERAÇÃO:\nUsuário: "${item.userText}"\nLyly: "${item.lylyText}"\nEstado Emocional: ${JSON.stringify(item.emotionState)}\nIntent: ${item.userIntent} | Playful: ${item.playful}`
        }
      ]

      console.log(`${TAG} 📤 Enviando prompt editorial para LLM...`);
      let result = await generateResponse(prompt);
      
      if (typeof result !== 'string') {
        console.warn(`${TAG} ⚠️ Resposta não é string, convertendo. Tipo: ${typeof result}`);
        result = String(result ?? "");
      }

      const start = result.indexOf('{');
      const end = result.lastIndexOf('}');
      if (start === -1 || end === -1) {
        console.warn(`${TAG} ⚠️ JSON não encontrado na resposta do editor. Pulpa.`);
        return;
      }

      const jsonStr = result.substring(start, end + 1).trim();
      const decision = JSON.parse(jsonStr);

      if (!decision.should_save) {
        console.log(`${TAG} 🚫 Item descartado pelo editor (should_save: false)`);
        return;
      }

      const metadata = {
        type: decision.type,
        confidence: decision.confidence ?? 0.5,
        timestamp: Date.now()
      }

      if (decision.type === "fact") {
        await saveUserMemory(decision.distilled_summary, { ...metadata, category: "relationship_fact" });
      } else if (decision.type === "trait") {
        const allowed = shouldSaveLylyMemory(decision.distilled_summary);
        if (allowed) {
          await saveIdentityMemory(decision.distilled_summary, { ...metadata, category: "behavioral_trait" });
        }
      }

    } catch (err) {
      console.error(`${TAG} ❌ Falha crítica ao destilar memória:`, err.message);
    }
  }
}

export const reflectionEngine = new ReflectionEngine()




/**
 * 🧠 Pré-avaliação emocional (Reflexo) — Otimizado para 2B com Contexto
 * @param {string} userText - Mensagem do usuário
 * @param {string} lylyLastMessage - Última mensagem enviada pela Lyly (contexto)
 */
export async function analyzePreEmotion(userText, lylyLastMessage = "") {
  const TAG = "[PreEmotion-2B]";
  
  try {
    const { generateResponse } = await import("../llm/ollamaClient.js");
    
    const result = await generateResponse([
      { 
        role: "system", 
        content: `Você define a REAÇÃO IMEDIATA da Lyly ao texto do usuário.
      Retorne APENAS JSON válido. Sem markdown, sem explicações.
      
      📏 GUIA DE INTENSIDADE (0.0 a 1.0):
        - happy: 0.2 (leve) | 0.5 (feliz) | >0.6 (muito feliz/riso)
        - sad: 0.3 (melancólico) | 0.5 (triste) | >0.5 (muito triste/chorando)
        - angry: 0.5 (irritado) | 0.7 (raiva) | >0.7 (muita raiva/fúria/olhar fixo)
        - surprised: Algo INESPERADO, REPENTINO ou CHOQUE. Olhos arregalados, boca aberta. Use quando houver surpresa, susto ou revelação súbita.
        - relaxed/thinking/embarrassed: 0.3-0.7 conforme contexto

      REGRAS DE DECISÃO:
        1. happy: Alegria genuína, satisfação, riso, felicidade esperada.
        2. surprised: Algo INESPERADO, REPENTINO ou CHOQUE. Use apenas para revelações súbitas ou sustos reais.
        3. sad: Tristeza, perda, melancolia, choro.
        4. angry: Raiva, irritação, confronto, olhar fixo e intenso.
        5. relaxed: Calmo, neutro, natural, ouvindo.
        6. thinking: Pensando, confusa, processando informação.
        7. embarrassed: Vergonha, constrangimento, blush, timidez.

      ⚠️ REGRAS CRÍTICAS DE FILTRO (OBRIGATÓRIO):
        1. IGNORAR RUÍDO: Se o input for 1 caractere, números soltos, símbolos ou palavras sem sentido (ex: "x", "6", "$", "a", "kk"), retorne: {"emotion":"relaxed","intensity":0.2,"modifier":null,"focus":"center"}
        2. CONTEXTO É TUDO: Para respostas curtas ("sim", "não", "ok", "haha", "tá"), USE O CONTEXTO DA LYLY abaixo para decidir.
           - Ex: Lyly pergunta feliz e usuário diz "não" → relaxed/sad (não angry)
           - Ex: Lyly conta piada e usuário diz "haha" → happy
        3. NUNCA force "surprised" para inputs neutros ou curtos.

      CONTEXTO DA ÚLTIMA MENSAGEM DA LYLY: "${lylyLastMessage}"

      MODIFICADORES (use APENAS quando fizer sentido):
        - crying: Só para 'sad' intensa.
        - shouting: Só para 'angry' ou 'happy' extrema.
        - whispering: Para segredos ou momentos íntimos.
        - wink: Para brincadeiras ou 'happy'/'embarrassed'.
        - blush: Para 'surprised' por carinho/beijo, ou 'embarrassed'.

      FOCO DO OLHAR:
        - center: Padrão.
        - up: Pensando ou recordando.
        - down: Triste, envergonhada ou submissa.
        - left/right: Desviando o olhar (vergonha, nervosismo).

      ⚠️ FORMATO DE SAÍDA (OBRIGATÓRIO):
      Retorne APENAS um JSON válido. SEM explicações, SEM markdown, SEM texto adicional.
      Exemplo: {"emotion":"happy","intensity":0.5,"modifier":null,"focus":"center"}` 
      },
      { role: "user", content: userText }
    ], "gemma-2-2b-it");

    // Extração robusta de JSON
    const start = result.indexOf('{');
    const end = result.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error("JSON não encontrado");

    const parsed = JSON.parse(result.substring(start, end + 1).trim());
    
    const validEmotions = ['happy','sad','angry','surprised','relaxed','thinking','embarrassed'];
    const validFocus = ['center','up','down','left','right'];
    
    return {
      emotion: validEmotions.includes(parsed.emotion) ? parsed.emotion : 'relaxed',
      intensity: Math.max(0.1, Math.min(1.0, Number(parsed.intensity) || 0.5)),
      focus: validFocus.includes(parsed.focus) ? parsed.focus : 'center',
      modifier: null, // Pré-emoção não usa modificadores complexos
      isPreEmotion: true
    };

  } catch (err) {
    console.warn(`${TAG} ⚠️ Fallback para relaxed:`, err.message);
    return { emotion: 'relaxed', intensity: 0.3, focus: 'center', modifier: null, isPreEmotion: true };
  }
}


// -----------------------------
// Funções de Interpretação
// -----------------------------

export function interpretUserMessage(text) {
  return { intent: "chat", playful: false };
}




/**
 * 🧠 NOVO: Analisa estado emocional discreto para animação facial (com Contexto)
 * Retorna: { emotion, intensity, modifier, focus } ou { emotion: 'skip' }
 */
export async function analyzeEmotionalState(text, lylyLastMessage = "") {
  const TAG = "[AnalyzeEmotionalState]";

  try {
    const { generateResponse } = await import("../llm/ollamaClient.js");
    
    let result = await generateResponse([
      { 
        role: "system", 
        content: `Você é o controlador de expressões faciais da Lyly.
        Sua função é definir a expressão facial com base no significado real e natural da frase.

        🚨 [REGRA DE OURO CONTRA BIPOLARIDADE E PALAVRAS ISOLADAS]:
        - Palavras isoladas, conceitos soltos ou listas (Ex: "amor", "tristeza", "felicidade", "raiva", "carinho") NÃO representam o estado emocional atual da Lyly. São apenas palavras. Se o texto for apenas uma palavra ou conceito solto, retorne obrigatoriamente {"emotion":"skip"...}.
        - Interjeições e reações curtas sem contexto (Ex: "ahh", "sigh", "kkk", "Woo!", "entendi") também devem retornar {"emotion":"skip"...}.
        - Mude a expressão APENAS se o texto expressar uma ação, um desabafo ou um sentimento direcionado e contextualizado.

        MATRIZ DE DECISÃO PARA O MODELO:
        - Texto: "Amor" ou "Felicidade" (Palavra solta) → ❌ RETORNE "skip"
        - Texto: "ahh" ou "sigh" (Interjeição curta) → ❌ RETORNE "skip"
        - Texto: "Estou com muita raiva" (Curto, mas com sentido claro) →  RETORNE "angry"
        - Texto: "Eu te amo tanto!" (Curto, mas com sentido claro) →  RETORNE "happy" ou "embarrassed"

        Nunca usar 'surprised'.

        📏 GUIA DE INTENSIDADE (0.0 a 1.0):
        - happy: 0.2 (leve) | 0.5 (feliz) | >0.6 (muito feliz/riso)
        - sad: 0.3 (melancólico) | 0.5 (triste) | >0.5 (muito triste/chorando)
        - angry: 0.5 (irritado) | 0.7 (raiva) | >0.7 (muita raiva/fúria)
        - relaxed/thinking/embarrassed: 0.3-0.7 conforme contexto

        REGRAS DE DECISÃO SEMÂNTICA:
        1. happy: Alegria genuína, satisfação, riso, felicidade esperada na frase.
        2. sad: Tristeza, perda, melancolia, choro expresso.
        3. angry: Raiva, irritação, confronto direto.
        4. relaxed: Calmo, neutro, natural, apenas conversando sem forte carga emocional.
        5. thinking: Pensando, confusa, processando informação.
        6. embarrassed: Vergonha, constrangimento, timidez, declarações de afeto recebidas/feitas.

        MODIFICADORES:
        - crying (sad intensa) | shouting (angry/happy extrema) | whispering (segredos) | wink (brincadeiras).
        
        FOCO DO OLHAR:
        - center: Padrão.
        - up: Pensando ou recordando.
        - down: Triste, envergonhada ou submissa.
        - left/right: Desviando o olhar (vergonha, nervosismo).

        ⚠️ FORMATO DE SAÍDA (OBRIGATÓRIO):
        Retorne APENAS o JSON válido. SEM explicações, SEM markdown, SEM texto adicional.

        - Se o texto NÃO tiver uma frase completa com sentido emocional ativo (palavras soltas, interjeições, textos sem contexto), retorne exatamente:
        {"emotion":"skip","intensity":0,"modifier":null,"focus":"center"}

        - Se o texto tiver uma frase com sentido emocional claro (mesmo que curta, ex: "Estou com muita raiva"), retorne o formato padrão baseado na análise real:
        {"emotion":"happy","intensity":0.5,"modifier":null,"focus":"center"}` 
      },
      { role: "user", content: `CONTEXTO DA ÚLTIMA MENSAGEM DA LYLY: "${lylyLastMessage}"\n\nAnalise a expressão para este texto do usuário:\n"${text}"` }
    ]);




    if (typeof result !== 'string') result = String(result ?? "{}");
    let jsonStr = result;
    const start = result.indexOf('{');
    const end = result.lastIndexOf('}');
    if (start !== -1 && end !== -1) jsonStr = result.substring(start, end + 1);
    
    const parsed = JSON.parse(jsonStr.trim());
    const validEmotions = ['happy','sad','angry','surprised','relaxed','thinking','embarrassed'];
    const validFocus = ['center','up','down','left','right'];
    const validModifiers = ['crying','shouting','whispering','wink','blush'];
    
    return {
      emotion: (parsed.emotion === 'skip') ? 'skip' : (validEmotions.includes(parsed.emotion) ? parsed.emotion : 'relaxed'),
      intensity: Math.max(0, Math.min(1, Number(parsed.intensity) || 0.5)),
      modifier: validModifiers.includes(parsed.modifier) ? parsed.modifier : null,
      focus: validFocus.includes(parsed.focus) ? parsed.focus : 'center'
    };

  } catch (err) {
    console.error(`${TAG} ❌ Falha na análise emocional:`, err.message);
    return { emotion: 'relaxed', intensity: 0.5, modifier: null, focus: 'center' };
  }
}