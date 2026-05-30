import { shouldSaveMemory } from "./memoryGuardrails.js"
import {
  getUserMemoryCollection,
  getIdentityMemoryCollection,
  getDiaryMemoryCollection
} from "./chromaClient.js"

function extractDocs(results) {
  return results?.documents?.[0]?.map(d => typeof d === "string" ? d : (d?.document ?? "")) ?? []
}

export async function searchUserMemories(text) {
  const collection = await getUserMemoryCollection()
  const results = await collection.query({ queryTexts: [text], nResults: 5 })
  const docs = extractDocs(results)
  return docs.length ? docs.join("\n") : ""
}

export async function searchIdentityMemories(text) {
  const collection = await getIdentityMemoryCollection()
  const results = await collection.query({ queryTexts: [text], nResults: 5 })
  const docs = extractDocs(results)
  return docs.length ? docs.join("\n") : ""
}

export async function searchDiaryMemories(text) {
  const collection = await getDiaryMemoryCollection()
  const results = await collection.query({ queryTexts: [text], nResults: 3 })
  const docs = extractDocs(results)
  return docs.length ? docs.join("\n") : ""
}

export async function searchMemories(text) {
  const [user, identity, diary] = await Promise.all([
    searchUserMemories(text),
    searchIdentityMemories(text),
    searchDiaryMemories(text)
  ])
  return { user, identity, diary }
}

// Salva apenas resumos destilados (Fatos/Padrões)
export async function saveUserMemory(distilledSummary, metadata = {}) {
  const collection = await getUserMemoryCollection()
  await collection.add({
    ids: [crypto.randomUUID()],
    documents: [distilledSummary],
    metadatas: [{ ...metadata, type: "user_pattern" }]
  })
}

// Salva apenas traços de comportamento/identidade validados
export async function saveIdentityMemory(distilledSummary, metadata = {}) {
  const collection = await getIdentityMemoryCollection()
  await collection.add({
    ids: [crypto.randomUUID()],
    documents: [distilledSummary],
    metadatas: [{ ...metadata, type: "lyly_behavior" }]
  })
  if (process.env.NODE_ENV !== "production") {
    console.log(`💾 [LYLY MEMORY] Trait salvo: ${distilledSummary.slice(0, 150)}...`)
  }
}

export async function saveDiaryMemory(memory) {
  const collection = await getDiaryMemoryCollection()
  const today = new Date().toISOString().split("T")[0]
  await collection.add({
    ids: [crypto.randomUUID()],
    documents: [[`[${today}] ${memory}`]],
    metadatas: [{ type: "diary", date: today }]
  })
}

// AGORA APENAS ATIVA O GUARDRAIL. A persistência no ChromaDB é 100% controlada pelo ReflectionEngine.
export async function saveInteractionMemories(userMessage, lylyReply, userInterpretation, messageId) {
  if (!shouldSaveMemory(userMessage, userInterpretation || {})) return
  // A lógica de salvar no ChromaDB foi removida para evitar poluição.
  // O ReflectionEngine atuará como editor único para salvar apenas o essencial.
}

export async function compactCollection(collectionName) {
  let collection
  try {
    switch (collectionName) {
      case "identity": collection = await getIdentityMemoryCollection(); break
      case "diary": collection = await getDiaryMemoryCollection(); break
      default: return
    }

    const results = await collection.get()
    const toDelete = []

    for (let i = 0; i < results.ids.length; i++) {
      const meta = results.metadatas?.[i] || {}
      const importance = meta.importance ?? 5
      const confidence = meta.confidence ?? 0.5
      const age = Date.now() - (meta.timestamp ?? Date.now())
      const daysOld = age / (1000 * 60 * 60 * 24)

      // Remove memórias de baixa confiança ou importância após 14 dias
      if ((importance < 3 || confidence < 0.6) && daysOld > 14) {
        toDelete.push(results.ids[i])
      }
    }

    if (toDelete.length > 0) {
      await collection.delete({ ids: toDelete })
      console.log(`🧹 [COMPACT] ${toDelete.length} documentos removidos de ${collectionName}`)
    }
  } catch (err) {
    console.error(`[COMPACT] Falha ao compactar ${collectionName}:`, err.message)
  }
}

export async function debugUserMemories() {
  const collection = await getUserMemoryCollection()
  const results = await collection.get()
  console.table(results.documents.map((d, i) => ({ id: results.ids[i], doc: d[0]?.slice(0, 80) })))
}