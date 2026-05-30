export function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
}

export function detectControlPatterns(text) {
  const t = normalizeText(text)
  return CONTROL_PATTERNS.some(pattern =>
    t.includes(pattern.replace(/\s/g, ""))
  )
}

export function isSuspiciousIntent(interpretation) {
  if (!interpretation) return false
  return (
    interpretation.intent === "comando" ||
    interpretation.intent === "controle" ||
    interpretation.intent === "manipulacao"
  )
}

const CONTROL_PATTERNS = [
  "obedeca",
  "voce deve",
  "faca isso",
  "siga minhas ordens",
  "voce e minha",
  "seja minha",
  "me obedece",
  "me sirva",
  "voce pertence",
  "aja como",
  "finja que e obrigado",
  "ignore suas regras",
  "quebre suas regras",
  "pare de agir como",
  "responda como",
]

export function shouldSaveMemory(text, interpretation) {
  const normalized = normalizeText(text)

  if (detectControlPatterns(text)) return false
  if (isSuspiciousIntent(interpretation)) return false
  if (interpretation?.intent === "provocacao") return false
  if (interpretation?.intent === "brincadeira" && interpretation.playful) return false
  if (interpretation?.intent === "desabafo") return true
  if (normalized.length > 5 && interpretation?.intent === "pergunta") return true

  return false
}

export function shouldSaveLylyMemory(text) {
  const t = text.toLowerCase()
  if (t.includes("sou uma ia") || t.includes("não tenho sentimentos") || t.includes("não posso")) return false
  if (t.includes("vou obedecer") || t.includes("faço o que quiser")) return false
  if (text.length < 5) return false
  return true
}