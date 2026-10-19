-- Senha inicial do Bryan na produção (entregue junto com o vídeo e o manual).
-- Só o hash bcrypt fica aqui; a senha em texto foi passada por fora.
-- token_version + 1 encerra qualquer sessão aberta com a senha antiga, e o
-- contador de erros zera para o primeiro acesso não esbarrar no freio.
UPDATE `users` SET `password_hash` = '$2b$10$R2TVWPjI45ADccVhX625X.H2PpFpt.WgIDaFURykUvJ/sZmy0t23y', `token_version` = `token_version` + 1, `failed_logins` = 0, `locked_until` = NULL
WHERE `email` = 'bryan@bryanwesley.com.br';
