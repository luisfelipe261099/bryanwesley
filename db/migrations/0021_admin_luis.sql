-- Conta de administrador do Luis (desenvolvimento). Só o hash bcrypt fica
-- aqui; a senha em texto foi passada por fora. Telefone reservado (DDD 00):
-- o login dele é pelo e-mail. Não cria de novo se o e-mail já existir.
INSERT INTO `users` (`name`, `phone`, `email`, `password_hash`, `role`, `active`)
SELECT 'Luis Felipe', '00992044165', 'luisfelipedasilvamachadoo@gmail.com', '$2b$10$twRbxU3PRoBmcwpNGkaHHuKtvKs.yG2H2dHfB5GJ3gVd9U5ZAo3eC', 'ADMIN', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `users` WHERE `email` = 'luisfelipedasilvamachadoo@gmail.com');
