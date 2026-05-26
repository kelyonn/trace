-- Large demo seed: ~10k customers, ~500 products, ~1M orders, ~2.5M order lines
-- Idempotent: truncates and reloads. Run via infra/scripts/seed-postgres.sh

\set ON_ERROR_STOP on
SET client_min_messages TO WARNING;

TRUNCATE order_lines, orders, products, customers RESTART IDENTITY CASCADE;

-- Lookup arrays for realistic labels (session temp tables)
CREATE TEMP TABLE seed_regions (region TEXT);
INSERT INTO seed_regions VALUES
  ('North America'), ('Europe'), ('APAC'), ('Latin America'), ('Middle East'), ('Africa');

CREATE TEMP TABLE seed_industries (industry TEXT);
INSERT INTO seed_industries VALUES
  ('Retail'), ('Manufacturing'), ('Healthcare'), ('Technology'), ('Finance'),
  ('Energy'), ('Logistics'), ('Media'), ('Education'), ('Government');

CREATE TEMP TABLE seed_categories (category TEXT);
INSERT INTO seed_categories VALUES
  ('Electronics'), ('Apparel'), ('Home'), ('Industrial'), ('Pharma'),
  ('Software'), ('Food'), ('Automotive'), ('Office'), ('Sports'),
  ('Beauty'), ('Garden');

CREATE TEMP TABLE seed_statuses (status TEXT);
INSERT INTO seed_statuses VALUES
  ('shipped'), ('pending'), ('cancelled'), ('processing');

-- ~10,000 customers
INSERT INTO customers (name, industry, region)
SELECT
  'Customer ' || gs::TEXT,
  (SELECT industry FROM seed_industries ORDER BY random() LIMIT 1),
  (SELECT region FROM seed_regions ORDER BY random() LIMIT 1)
FROM generate_series(1, 10000) AS gs;

-- ~500 products
INSERT INTO products (sku, category, unit_price)
SELECT
  'SKU-' || lpad(gs::TEXT, 6, '0'),
  (SELECT category FROM seed_categories ORDER BY random() LIMIT 1),
  round((5 + random() * 995)::numeric, 2)
FROM generate_series(1, 500) AS gs;

-- ~1,000,000 orders (amount set from lines after insert)
INSERT INTO orders (customer_id, order_date, amount, status)
SELECT
  1 + floor(random() * 10000)::INT,
  (DATE '2023-01-01' + (floor(random() * 1095))::INT),
  0,
  (SELECT status FROM seed_statuses ORDER BY random() LIMIT 1)
FROM generate_series(1, 1000000) AS gs;

-- ~2.5M order lines (2–3 lines per order on average)
INSERT INTO order_lines (order_id, product_id, quantity, line_amount)
SELECT
  1 + floor(random() * 1000000)::INT,
  1 + floor(random() * 500)::INT,
  1 + floor(random() * 8)::INT,
  0
FROM generate_series(1, 2500000) AS gs;

UPDATE order_lines ol
SET line_amount = round((ol.quantity * p.unit_price)::numeric, 2)
FROM products p
WHERE p.id = ol.product_id;

UPDATE orders o
SET amount = sub.total
FROM (
  SELECT order_id, round(sum(line_amount)::numeric, 2) AS total
  FROM order_lines
  GROUP BY order_id
) sub
WHERE o.id = sub.order_id;

UPDATE orders SET amount = round((10 + random() * 500)::numeric, 2) WHERE amount = 0 OR amount IS NULL;

ANALYZE customers;
ANALYZE products;
ANALYZE orders;
ANALYZE order_lines;

DO $$
DECLARE
  c_customers BIGINT;
  c_products BIGINT;
  c_orders BIGINT;
  c_lines BIGINT;
BEGIN
  SELECT COUNT(*) INTO c_customers FROM customers;
  SELECT COUNT(*) INTO c_products FROM products;
  SELECT COUNT(*) INTO c_orders FROM orders;
  SELECT COUNT(*) INTO c_lines FROM order_lines;
  RAISE NOTICE 'Seed complete: % customers, % products, % orders, % order_lines',
    c_customers, c_products, c_orders, c_lines;
END $$;
