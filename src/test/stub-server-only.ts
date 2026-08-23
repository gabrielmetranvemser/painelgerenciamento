// Substitui o pacote `server-only` durante os testes.
//
// `server-only` só expõe um módulo inofensivo sob a condição de resolução
// `react-server`, que o Next define no build mas o Vitest não. Sem este stub,
// qualquer módulo de servidor (ex.: src/lib/hmac.ts) explodiria ao ser
// importado no teste. A proteção real continua valendo no build do Next.
export {};
