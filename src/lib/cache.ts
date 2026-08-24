/**
 * Etiquetas do cache de dados.
 *
 * Vivem num arquivo só porque quem GRAVA e quem LÊ estão longe um do outro: a
 * página pública do candidato guarda a consulta, e são as ações de
 * Gestor → Candidatos que precisam derrubá-la ao salvar. Etiqueta escrita à mão
 * nos dois lugares é etiqueta que um dia diverge, e o sintoma seria o pior tipo:
 * o gestor edita a página, olha, e não vê a mudança.
 */

/** Tudo que a página pública de um candidato mostra: dados, materiais, imagens. */
export const ETIQUETA_CANDIDATOS = 'candidatos';
