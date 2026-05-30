import { getLegacyCollection } from "../memory/chromaClient.js"
import { saveUserMemory, saveIdentityMemory } from "../memory/memoryManager.js"
import { generateResponse } from "../llm/ollamaClient.js"



export async function scanOldMemories(){

  const legacy = await getLegacyCollection()

  const data = await legacy.get()

  const docs = data.documents || []

  console.log("Memórias antigas encontradas:", docs.length)



  for(const doc of docs){

    await reflectOldConversation(doc)

  }

}


async function reflectOldConversation(text){

const prompt = [

{
role:"system",
content:`
Lyly encontrou um fragmento antigo de conversa.

Ela não lembra o contexto nem o que respondeu.
Ela apenas vê esse fragmento e tenta entender o que ele significa hoje.
`
},

{
role:"user",
content:`
Fragmento encontrado:

${text}

Reflita sobre isso.

1 — isso revela algo sobre o usuário?
2 — isso revela algo sobre mim mesma?

Também escreva como você se sente hoje ao ler esse fragmento.

Responda JSON:

[
{
 "memory":"interpretação do fragmento",
 "type":1 ou 2,
 "importance":1-10,
 "vibe":"como você se sente hoje lendo isso"
}
]
`
}

]

try{

const result = await generateResponse(prompt)

const memories = JSON.parse(result)

const date = new Date().toISOString().split("T")[0]

for(const mem of memories){

if(mem.importance < 6) continue

const document = `
Memória:
${mem.memory}

Vibe ao lembrar:
${mem.vibe}
`

const metadata = {
reflection_date: date,
importance: mem.importance,
vibe: mem.vibe,
timestamp: Date.now()
}



if(mem.type === 1){

await saveUserMemory(document, metadata)

}

if(mem.type === 2){

await saveIdentityMemory(document, metadata)

}

}

}catch(err){

console.log("erro refletindo memória antiga")

}

}