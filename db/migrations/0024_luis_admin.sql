-- O e-mail do Luis já tinha um cadastro de cliente: a 0021 não criou outro
-- e a conta seguiu como cliente. Aqui ela vira administrador.
UPDATE `users` SET `role` = 'ADMIN', `active` = 1, `token_version` = `token_version` + 1
WHERE `email` = 'luisfelipedasilvamachadoo@gmail.com';
