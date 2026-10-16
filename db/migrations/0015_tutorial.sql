-- Tutorial de primeiro acesso: quais telas a pessoa já percorreu
-- ("admin", "barbeiro", "cliente"). Nulo = nunca viu nenhum.
ALTER TABLE `users` ADD `tutoriais` json;
