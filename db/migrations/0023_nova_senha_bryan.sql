-- Nova senha do Bryan (só o hash; a senha em texto foi passada por fora).
-- Encerra as sessões abertas com a senha antiga e zera o freio de tentativas.
UPDATE `users` SET `password_hash` = '$2b$10$8ok7I7I40crMJrnoD3MhC.qC4nbEnU.wDgIxUS.bPT9U7PLKKkIgS', `token_version` = `token_version` + 1, `failed_logins` = 0, `locked_until` = NULL
WHERE `email` = 'bryan@bryanwesley.com.br';
