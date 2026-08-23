-- Foto do atendente. Opcional: sem ela o painel usa as iniciais, com uma cor
-- derivada do nome (a mesma pessoa tem sempre a mesma cor).
--
-- É URL, e não upload: um avatar de 40px não justifica montar armazenamento,
-- política de bucket e rotina de limpeza no meio de uma campanha.
alter table public.usuarios add column if not exists foto_url text;
