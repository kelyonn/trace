CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT NOT NULL,
  region TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  order_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL
);

INSERT INTO customers (name, industry, region) VALUES
  ('Northwind Co', 'Retail', 'North America'),
  ('Contoso Ltd', 'Manufacturing', 'Europe'),
  ('Blue Ocean', 'Healthcare', 'APAC'),
  ('Apex Systems', 'Technology', 'North America'),
  ('Summit Labs', 'Finance', 'Europe')
ON CONFLICT DO NOTHING;

INSERT INTO orders (customer_id, order_date, amount, status) VALUES
  (1, '2026-05-01', 12000.50, 'shipped'),
  (1, '2026-05-10', 8400.00, 'pending'),
  (2, '2026-04-22', 15250.75, 'shipped'),
  (3, '2026-05-14', 6200.00, 'cancelled'),
  (4, '2026-03-05', 9100.25, 'shipped'),
  (5, '2026-02-18', 4700.00, 'pending')
ON CONFLICT DO NOTHING;
