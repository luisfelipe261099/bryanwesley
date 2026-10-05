ALTER TABLE `plan_services` ADD `monthly_quota` int;
--> statement-breakpoint
UPDATE `plan_services` ps
  JOIN `plans` p ON p.id = ps.plan_id
  JOIN `services` s ON s.id = ps.service_id
  SET ps.monthly_quota = 2
  WHERE p.slug = 'silver' AND s.slug = 'corte' AND ps.monthly_quota IS NULL;
--> statement-breakpoint
INSERT INTO `barber_hours` (`barber_id`, `weekday`, `open_minute`, `close_minute`)
  SELECT b.barber_id, w.d, 0, 0
  FROM (SELECT DISTINCT barber_id FROM `barber_hours`) b
  CROSS JOIN (SELECT 0 AS d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) w
  WHERE NOT EXISTS (
    SELECT 1 FROM `barber_hours` h WHERE h.barber_id = b.barber_id AND h.weekday = w.d
  );
--> statement-breakpoint
UPDATE `users` u
  LEFT JOIN `users` v ON v.phone = CONCAT(LEFT(u.phone, 2), '9', SUBSTRING(u.phone, 3))
  SET u.phone = CONCAT(LEFT(u.phone, 2), '9', SUBSTRING(u.phone, 3))
  WHERE CHAR_LENGTH(u.phone) = 10
    AND SUBSTRING(u.phone, 1, 2) <> '00'
    AND SUBSTRING(u.phone, 3, 1) IN ('6', '7', '8', '9')
    AND v.id IS NULL;
--> statement-breakpoint
UPDATE `appointments`
  SET client_phone = CONCAT(LEFT(client_phone, 2), '9', SUBSTRING(client_phone, 3))
  WHERE CHAR_LENGTH(client_phone) = 10
    AND SUBSTRING(client_phone, 1, 2) <> '00'
    AND SUBSTRING(client_phone, 3, 1) IN ('6', '7', '8', '9');
--> statement-breakpoint
UPDATE `notifications`
  SET phone = CONCAT(LEFT(phone, 2), '9', SUBSTRING(phone, 3))
  WHERE CHAR_LENGTH(phone) = 10
    AND SUBSTRING(phone, 1, 2) <> '00'
    AND SUBSTRING(phone, 3, 1) IN ('6', '7', '8', '9');
