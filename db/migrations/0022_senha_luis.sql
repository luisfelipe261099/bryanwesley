-- Senha escolhida pelo Luis para a conta de administrador dele (só o hash).
UPDATE `users` SET `password_hash` = '$2b$10$RpSLWcSptJB9bmz3g4wgz.GRK7BV.2oGKiDbHAwwTauJyFaFupZJa', `token_version` = `token_version` + 1, `failed_logins` = 0, `locked_until` = NULL
WHERE `email` = 'luisfelipedasilvamachadoo@gmail.com';
