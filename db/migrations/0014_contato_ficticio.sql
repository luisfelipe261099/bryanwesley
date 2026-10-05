UPDATE `settings` SET `shop_phone` = '' WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`shop_phone`, ' ', ''), '(', ''), ')', ''), '-', ''), '+', '') IN ('41999990000', '5541999990000');
