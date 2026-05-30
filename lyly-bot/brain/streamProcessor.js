// lyly-bot/brain/streamProcessor.js
import { spawn } from 'child_process';

/**
 * 🧠 StreamProcessor com Pipeline de TTS em Memória RAM (Corrigido)
 * 
 * ✅ Fatiamento Dinâmico: Captura mini-frases em tempo real.
 * ✅ Limpeza Fonética: Remove onomatopeias e ruídos que quebram o TTS.
 * ✅ Fila Global Sequencial: Garante reprodução ordenada mesmo com interrupções/concorrência.
 */

export class StreamProcessor {
  // 🌍 Estado Global de Áudio
  static audioQueue = [];
  static isPlaying = false;
  static currentPlayer = null;
  static currentProcessor = null; // 👈 ADICIONAR ESTA LINHA
  
  constructor(onTextChunk, onAvatarStateUpdate, onVisemeStart, onVisemeEnd) {
    this.onTextChunk = onTextChunk;
    this.onAvatarStateUpdate = onAvatarStateUpdate;
    this.onVisemeStart = onVisemeStart; 
    this.onVisemeEnd = onVisemeEnd;
    
    // 🔧 FIX: Armazena a instância atual na referência estática para callbacks globais
    StreamProcessor.currentProcessor = this; 
    
    this.buffer = "";
    this.isAborted = false;
    this.chunkIdCounter = 0;
    this.pendingChunks = new Map(); 
    this.nextExpectedId = 0;
    this.totalStartTime = 0;
    this.gpuQueue = [];
    this.isGPUProcessing = false;
  }


  async processStream(llmStream) {
    this.totalStartTime = performance.now();
    try {
      for await (const chunk of llmStream) {
        if (this.isAborted) break;
        
        const text = chunk.choices?.[0]?.delta?.content || 
                     chunk.message?.content || "";
        if (!text) continue;

        this.buffer += text;
        this.onTextChunk(text); // Stream para UI
        
        this._processBufferRealtime();
      }
    } catch (err) {
      console.warn("[StreamProcessor] Stream interrompido:", err.message);
      throw err;
    } finally {
      if (this.buffer.trim()) {
        this._enqueueSentence(this.buffer.trim());
      }
      this.buffer = "";
      this._finalizeStream();
    }
  }

  _processBufferRealtime() {
    const match = this.buffer.match(/^[^.!?\n]*[.!?\n]+/);
    
    if (match) {
      const sentence = match[0].trim();
      
      if (/[a-zA-ZÀ-ÿ0-9]/.test(sentence)) {
        this._enqueueSentence(sentence);
        this.buffer = this.buffer.slice(match[0].length).trimStart();
      } else {
        this.buffer = this.buffer.slice(match[0].length).trimStart();
      }
    }
  }

  _enqueueSentence(sentence) {
    // 🧹 Limpeza de Onomatopeias e Ruídos Fonéticos para TTS
    const cleanText = StreamProcessor.cleanTextForTTS(sentence);
    
    if (!cleanText.trim()) return; // Ignora se só tinha onomatopeias

    const id = this.chunkIdCounter++;
    const startTime = performance.now();

    // 🎭 Atualização imediata de expressão facial (Reflexo)
    if (this.onAvatarStateUpdate) {
      this.onAvatarStateUpdate(cleanText);
    }

    // 🟢 Empilha na fila de controle sequencial
    this.gpuQueue.push({ text: cleanText, id, startTime });
    
    // 🟢 Inicia o worker se estiver ocioso
    this._processGPUQueue();
  }

    // 🧹 Filtro Regex "Inteligente" (Regex 2.8 - Produção)
  static cleanTextForTTS(text) {
    if (!text) return '';
    
    let cleaned = text;

    // 1. Risadas e vocalizações mistas (hahaha, haahahaha, ooh, ahh, kkkk...)
    const laughPattern = /\b(?:[hao]{4,}|[aoe]?(?:ha|he){2,}|k{3,}|xixi|mua|hmm)\b/gi;
    cleaned = cleaned.replace(laughPattern, '');

    // 2. Interjeições repetidas (Oh, oh / Ah, ah)
    const repeatInterjection = /\b(?:[Oo][Hh]|[Aa][Hh])\s*,?\s*(?:\s*(?:[Oo][Hh]|[Aa][Hh])\s*,?\s*)+/g;
    cleaned = cleaned.replace(repeatInterjection, '');

    // 3. Esticamentos vocálicos/consoantes (heee, ooooh, uuuuh, aamm, mmmm)
    const vocalStretch = /(?:^|[\s.,!?;:\-]+)(?:[bcdfghjklmnpqrstvwxyz]?[aeiou]{3,}[bcdfghjklmnpqrstvwxyz]?|[aeiou][mnrs]{2,}|[aoeui][hwv]{2})\b/gi;
    cleaned = cleaned.replace(vocalStretch, '');

    // 4. Reduz palavras repetidas 2+ vezes para UMA única instância (preserva sentido)
    // 🔒 FIX: \s+ exige separador real entre repetições. Impede colapso em nomes como "Lyly"
    const repeatedWords = /\b(\w{2,})\s+(?:[.,!?;:\-]?\s+\1)+/gi;
    cleaned = cleaned.replace(repeatedWords, '$1');

    // 5. Normalização de caracteres consecutivos idênticos (segurança máxima para TTS)
    // 🔒 FIX: \1{3,} só colapsa 4+ letras iguais seguidas. Preserva palavras válidas e nomes alternados
    cleaned = cleaned.replace(/([a-zA-Z])\1{3,}/g, '$1$1');

    // 6. Limpeza final de pontuação/espacos órfãos no início da frase
    cleaned = cleaned
      .replace(/\s+/g, ' ')                      
      .replace(/^[,\.\-\!\?\;\:\s]+/, '')       
      .trim();

    return cleaned;
  }
   

  async _processGPUQueue() {
    if (this.isGPUProcessing || this.gpuQueue.length === 0) return;
    this.isGPUProcessing = true;

    const task = this.gpuQueue.shift();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch('http://localhost:8005/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: task.text.toLowerCase() }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error(`TTS HTTP Error: ${response.status}`);
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const latency = (performance.now() - task.startTime) / 1000;
      
      this.pendingChunks.set(task.id, { buffer, text: task.text, latency, id: task.id });
      console.log(`📦 [TTS CHUNK ${task.id}] Calculado em ${latency.toFixed(2)}s e guardado na RAM.`);
      
      // 🔁 Verifica se podemos liberar chunks em ordem para a fila GLOBAL
      this._flushOrderedQueue();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(`[TTS] Fetch failed for chunk ${task.id}:`, err.message);
      }
    } finally {
      this.isGPUProcessing = false;
      // 🔁 Chama a si mesmo para processar o próximo bloco se houver
      if (this.gpuQueue.length > 0) {
        this._processGPUQueue();
      }
    }
  }

  _flushOrderedQueue() {
    while (this.pendingChunks.has(this.nextExpectedId)) {
      const chunk = this.pendingChunks.get(this.nextExpectedId);
      this.pendingChunks.delete(this.nextExpectedId);
      
      // 🌍 Enfileira na FILA GLOBAL estática (respeita ordem absoluta)
      StreamProcessor.audioQueue.push(chunk);
      this.nextExpectedId++;
    }

    // 🔁 Dispara playback global se necessário e houver itens na fila
    if (!StreamProcessor.isPlaying && StreamProcessor.audioQueue.length > 0) {
      StreamProcessor._playNext();
    }
  }

  // 🎵 Gerenciador Global de Reprodução (Estático) - VERSÃO ORIGINAL FUNCIONAL
  static _playNext() {
    if (this.isPlaying || this.audioQueue.length === 0) return;
    
    this.isPlaying = true;
    const chunk = this.audioQueue.shift();
    
    console.log(`🔊 [AUDIO PLAY] Chunk ${chunk.id}: '${chunk.text}'`);
    
    // 👄 Dispara START do lip-sync no exato momento da reprodução
    if (this.currentProcessor?.onVisemeStart) {
      // Cálculo original simples baseado no buffer PCM 16-bit @ 24kHz
      const durationSec = chunk.buffer.byteLength / (2 * 24000); 
      
      this.currentProcessor.onVisemeStart(chunk.text, Math.max(0.1, durationSec));
    }

    console.log(`\n📊 [TELEMETRIA CHUNK ${chunk.id}]:`);
    console.log(`   ⚡ Latência RAM Pura (TTFB): ${chunk.latency.toFixed(2)}s`);
    console.log(`🔊 Falando agora: '${chunk.text}'`);
    
    this._spawnFfplay(chunk.buffer, () => {
      // 👄 Dispara END do lip-sync quando o áudio termina
      if (this.currentProcessor?.onVisemeEnd) {
        this.currentProcessor.onVisemeEnd();
      }

      this.isPlaying = false;
      if (this.audioQueue.length > 0) this._playNext();
    });
  }


  static _spawnFfplay(buffer, onAudioComplete) {
    try {
      this.currentPlayer = spawn('ffplay', ['-nodisp', '-autoexit', '-i', 'pipe:0']);
      
      this.currentPlayer.on('close', () => {
        onAudioComplete(); // 🔁 Chama o callback de fim de áudio + queue next
      });

      this.currentPlayer.on('error', (err) => {
        console.error("[TTS] ffplay error:", err.message);
        onAudioComplete();
      });

      this.currentPlayer.stdin.write(buffer);
      this.currentPlayer.stdin.end();
    } catch (err) {
      console.error("[TTS] ffplay spawn failed:", err.message);
      onAudioComplete();
    }
  }

  _finalizeStream() {
    const totalTime = ((performance.now() - this.totalStartTime) / 1000).toFixed(2);
    console.log(`\n🏁 [TTS] Fim da Stream Dinâmica! Tempo total da live: ${totalTime}s`);
  }

  abort() {
    this.isAborted = true;
    if (this.buffer.trim()) this.onTextChunk(this.buffer);
    this.buffer = "";
    this.gpuQueue = []; // Limpa fila GPU pendente local
    this.pendingChunks.clear();
    // ⚠️ Não limpa StreamProcessor.audioQueue: o áudio já gerado deve tocar até o fim
  }
}