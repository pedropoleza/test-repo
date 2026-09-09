-- 0009_contact_documents.sql
-- Documentos do cliente na ficha (F2).
--
-- A queixa central dela: os arquivos vivem espalhados por quatro
-- computadores, e achar o documento de um cliente é garimpo. Aqui cada
-- arquivo passa a morar na ficha do contato, com categoria e serviço.
--
-- Reaproveita workspace_files: já guarda o arquivo no bucket e a
-- metadata. Só faltavam duas colunas — a categoria (recebido do cliente,
-- emitido pelo escritório, contrato, recibo) e o código de serviço que
-- amarra o arquivo ao caso.
--
-- O contato já cabe em source_external_id; source vira 'contact_doc'.

alter table workspace_files
  add column if not exists category     text,
  add column if not exists service_code text;

-- Achar rápido os arquivos de um contato: é a consulta que a ficha faz
-- a cada abertura.
create index if not exists idx_workspace_files_contact
  on workspace_files(workspace_id, source, source_external_id)
  where source = 'contact_doc';
