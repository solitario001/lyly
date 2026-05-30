// main.js
import { app, BrowserWindow, screen, globalShortcut } from "electron"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { ipcMain } from 'electron'
import { createRequire } from 'module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ✅ Caminhos normalizados
const BRAIN_DIR = path.join(__dirname, "lyly-bot", "brain")
const LYLY_BRAIN_PATH = path.join(BRAIN_DIR, "lylyBrain.js")

let aiWindow
let chatWindow
let isIgnoringMouse = false 

// ✅ Cache de módulos para evitar múltiplas instâncias
let cachedBrainModule = null
let cachedOllamaClient = null
let cachedStreamProcessor = null
let cachedReflectionEngine = null

async function getBrainModule() {
  if (!cachedBrainModule) {
    console.log("🧠 Carregando lylyBrain.js (primeira vez)...")
    cachedBrainModule = await import(pathToFileURL(LYLY_BRAIN_PATH).href)
    console.log("✅ lylyBrain.js carregado e cacheado")
  }
  return cachedBrainModule
}

async function getOllamaClient() {
  if (!cachedOllamaClient) {
    cachedOllamaClient = await import(path.join(__dirname, "lyly-bot", "llm", "ollamaClient.js"))
  }
  return cachedOllamaClient
}

async function getStreamProcessor() {
  if (!cachedStreamProcessor) {
    cachedStreamProcessor = await import(path.join(__dirname, "lyly-bot", "brain", "streamProcessor.js"))
  }
  return cachedStreamProcessor
}

async function getReflectionEngine() {
  if (!cachedReflectionEngine) {
    cachedReflectionEngine = await import(path.join(__dirname, "lyly-bot", "brain", "reflectionEngine.js"))
  }
  return cachedReflectionEngine
}

ipcMain.on('start-drag', (event) => {
    const win = event.sender.getOwnerBrowserWindow();
    if (win) win.startDragging(event);
});

ipcMain.handle('get-bounds', (event) => {
    const win = event.sender.getOwnerBrowserWindow();
    return win ? win.getBounds() : null;
});

function createAIWindow() {
    aiWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        hasShadow: false,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    aiWindow.loadFile(path.join(__dirname, 'index.html'))
    aiWindow.setIgnoreMouseEvents(true, { forward: true })
}

ipcMain.on('resize-window', (event, { direction, delta }) => {
    const win = event.sender.getOwnerBrowserWindow();
    if (!win) return;
    let { width, height, x, y } = win.getBounds();
    let newWidth = width, newHeight = height, newX = x, newY = y;

    if (direction.includes('right')) newWidth = Math.max(200, width + delta.x);
    if (direction.includes('left')) { 
        newWidth = Math.max(200, width - delta.x); 
        newX = x + delta.x; 
    }
    if (direction.includes('bottom')) newHeight = Math.max(400, height + delta.y);
    if (direction.includes('top')) { 
        newHeight = Math.max(400, height - delta.y); 
        newY = y + delta.y; 
    }

    win.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
});

function createChatWindow() {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: workWidth, height: workHeight } = primaryDisplay.workAreaSize

    const chatWidth = 380
    const chatHeight = 520
    const x = Math.max(0, workWidth - chatWidth)
    const y = Math.max(0, workHeight - chatHeight)

    chatWindow = new BrowserWindow({
        x, y,
        width: chatWidth,
        height: chatHeight,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        hasShadow: false,
        resizable: true,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    chatWindow.loadFile(path.join(__dirname, 'chat', 'chat.html'))
}

// Handler principal que liga o Chat ao Brain (STREAMING)
ipcMain.on("chat:start-stream", async (event, payload) => {
  const { text, sessionId } = payload;
  
  try {
    const brainModule = await getBrainModule();
    const ollamaClient = await getOllamaClient();
    const streamProcessorModule = await getStreamProcessor();
    const reflectionEngineModule = await getReflectionEngine();

    const { prepareStreamingPrompt, finalizeInteraction, chatContext } = brainModule;
    const { generateStreamingResponse } = ollamaClient;
    const { StreamProcessor } = streamProcessorModule;
    const { analyzeEmotionalState, analyzePreEmotion } = reflectionEngineModule;

    // 🧠 Extrai última mensagem da Lyly para contexto da pré-emoção
    const history = chatContext.get(sessionId) || [];
    const lastLylyMsg = history.filter(m => m.role === 'assistant').pop()?.content || "";

    // 🟢 PARALELO: Busca de memórias + Pré-emoção (2B com contexto)
    const [messages, preEmotion] = await Promise.all([
      prepareStreamingPrompt(text, sessionId),
      analyzePreEmotion(text, lastLylyMsg)
    ]);

    // ⚡ Envia reação imediata ao avatar (Reflexo) - LOG COLORIDO PARA DEBUG
    console.log("%c[IPC] ⚡ PRE-EMOTION SET:", "color: cyan; font-weight:bold;", preEmotion);
    aiWindow?.webContents.send("avatar:state-update", preEmotion);

     // 🌊 Streaming da resposta (8B)
    const llmStream = generateStreamingResponse(messages);
    let fullReply = "";

    // 🔥 NOVO: Cache de Emoções para Sincronizar com Áudio (Resolve o flickering final)
    const emotionCache = new Map(); 

    // 🎯 Injeta callbacks para UI e Avatar
    const processor = new StreamProcessor(
      (chunk) => {
        fullReply += chunk;
        event.sender.send("chat:stream-text", chunk);
      },
      
      // 1. Frase extraída -> Analisa emoção com contexto e armazena no cache (Assíncrono)
      async (sentence) => {
        try {
          // Recupera o histórico atualizado para pegar a última frase da Lyly se necessário, 
          // ou usa o mesmo contexto base. Para precisão máxima, usamos o snapshot de history.
          const currentLastLylyMsg = (chatContext.get(sessionId) || []).filter(m => m.role === 'assistant').pop()?.content || lastLylyMsg;

          const emotionTarget = await analyzeEmotionalState(sentence, currentLastLylyMsg);
          
          // Se for skip, não faz sentido cachear para alterar a UI/Avatar (manter estado atual)
          if (emotionTarget.emotion !== 'skip') {
             emotionCache.set(sentence, emotionTarget);
             console.log(`[Analysis] ✅ Cached Emotion: ${emotionTarget.emotion} | "${sentence.slice(0,20)}..."`); 
          } else {
             // console.log(`[Analysis] ⏭️ Skipped Analysis for: "${sentence}"`);
          }

        } catch (e) {
          console.warn("[Analysis] ⚠️ Failed to analyze sentence:", e.message);
        }
      },

      // 2. Áudio iniciando -> Busca emoção no cache e envia junto com o viseme
      (text, duration) => {
        const cachedEmotion = emotionCache.get(text);
        
        if (cachedEmotion) {
          console.log("%c[IPC] 🎭 SYNCED EMOTION:", "color: magenta;", cachedEmotion); 
          aiWindow?.webContents.send("avatar:state-update", cachedEmotion);
        } else {
           // Fallback silencioso se a análise não estiver pronta ou foi 'skip'
        }

        // Dispara o início do áudio (aciona reset de idle timer no renderer)
        aiWindow?.webContents.send("avatar:viseme-start", { text, duration });
      },
      
      // 3. Áudio terminando (dispara start do idle timer no renderer)
      () => {
        aiWindow?.webContents.send("avatar:viseme-end");
      }
    );

    await processor.processStream(llmStream);
    
    // 🎯 Emoção final (8B) — sobrescreve suavemente a pré-emoção ao fim de tudo
    const emotionTarget = await analyzeEmotionalState(fullReply.trim(), lastLylyMsg);
    emotionTarget.isPreEmotion = false; 
     
    console.log("%c[IPC] 🏁 FINAL EMOTION:", "color: yellow;", emotionTarget);
    
    // Só envia se não for skip, para respeitar a lógica de persistência do renderer
    if (emotionTarget.emotion !== 'skip') {
        aiWindow?.webContents.send("avatar:state-update", emotionTarget);
    }

    finalizeInteraction(text, fullReply.trim(), sessionId).catch(console.error);
    event.sender.send("chat:stream-end");

  } catch (err) {
    console.warn("[IPC] Stream falhou, ativando fallback síncrono:", err.message);
    try {
      const brainModule = await getBrainModule();
      const { processMessage } = brainModule;
      const reply = await processMessage({ text, sessionId });
      
      event.sender.send("chat:stream-text", reply);
      aiWindow?.webContents.send("avatar:state-update", { 
        emotion: "relaxed", intensity: 0.5, modifier: null, focus: "center", isPreEmotion: false 
      });
    } catch (syncErr) {
      console.error("[IPC] Fallback também falhou:", syncErr);
      event.sender.send("chat:stream-text", "⚠️ Erro ao conectar com a IA.");
    } finally {
      event.sender.send("chat:stream-end");
    }
  }
});

app.whenReady().then(() => {
    createAIWindow()
    createChatWindow()

    globalShortcut.register('CommandOrControl+X', () => {
        if (chatWindow) {
            chatWindow.isVisible() ? chatWindow.hide() : chatWindow.show();
        }
    });

    globalShortcut.register('CommandOrControl+Z', () => {
        if (chatWindow) {
            isIgnoringMouse = !isIgnoringMouse;
            chatWindow.setIgnoreMouseEvents(isIgnoringMouse, { forward: true });
        }
    });
})

app.on('will-quit', () => {
    globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createAIWindow()
        createChatWindow()
    }
})