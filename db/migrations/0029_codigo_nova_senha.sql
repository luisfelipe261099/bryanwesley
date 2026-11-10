-- "Esqueci minha senha": código de 6 números mandado no WhatsApp (só o
-- hash fica guardado), válido por 15 minutos e com poucas tentativas.
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `user_id` int NOT NULL,
  `code_hash` varchar(100) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `attempts` int NOT NULL DEFAULT 0,
  `used_at` datetime(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `password_resets_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
