# Demo Data Guide

The pilot uses the sample customers and orders tables seeded in Postgres.

Sample queries:
- SELECT * FROM customers LIMIT 10;
- SELECT status, COUNT(*) FROM orders GROUP BY status;
- SELECT c.region, SUM(o.amount) FROM customers c JOIN orders o ON c.id = o.customer_id GROUP BY c.region;
