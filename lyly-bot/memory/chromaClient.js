import { ChromaClient } from "chromadb"

// -----------------------------
// CLIENTES
// -----------------------------


const chroma = new ChromaClient({
  host: "127.0.0.1",
  port: 8000
})

export const chromaOld = new ChromaClient({
  host: "127.0.0.1",
  port: 8000
})


// -----------------------------
// NOMES DAS COLEÇÕES
// -----------------------------

const COLLECTIONS = {
  USER: "lyly_user_memory",
  IDENTITY: "lyly_identity_memory",
  DIARY: "lyly_diary_memory",
  LEGACY: "lyly_final_v100"
}


// -----------------------------
// LEGACY
// -----------------------------

export async function getLegacyCollection(){
  return await chromaOld.getCollection({
    name: COLLECTIONS.LEGACY
  })
}


// -----------------------------
// USER
// -----------------------------

export async function getUserMemoryCollection(){
  return await chroma.getOrCreateCollection({
    name: COLLECTIONS.USER
  })
}


// -----------------------------
// IDENTITY
// -----------------------------

export async function getIdentityMemoryCollection(){
  return await chroma.getOrCreateCollection({
    name: COLLECTIONS.IDENTITY
  })
}


// -----------------------------
// DIARY
// -----------------------------

export async function getDiaryMemoryCollection(){
  return await chroma.getOrCreateCollection({
    name: COLLECTIONS.DIARY
  })
}