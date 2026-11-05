export const CUBE_BY_STATUS_REGION = `SELECT o.status, c.region, SUM(o.amount) AS total_amount
FROM orders o
JOIN customers c ON c.id = o.customer_id
GROUP BY o.status, c.region
ORDER BY total_amount DESC;`;

export const CUBE_BY_INDUSTRY_CATEGORY = `SELECT c.industry, p.category, SUM(ol.line_amount) AS revenue
FROM order_lines ol
JOIN orders o ON o.id = ol.order_id
JOIN customers c ON c.id = o.customer_id
JOIN products p ON p.id = ol.product_id
GROUP BY c.industry, p.category
ORDER BY revenue DESC;`;

export const initialSql = CUBE_BY_STATUS_REGION;

export const quickQueryTemplates: Record<string, string> = {
  cube_by_status_region: CUBE_BY_STATUS_REGION,
  cube_by_industry_category: CUBE_BY_INDUSTRY_CATEGORY,
  monthly_revenue: `SELECT CAST(date_trunc('month', o.order_date) AS DATE) AS month, c.region, SUM(o.amount) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status <> 'cancelled'
GROUP BY 1, 2
ORDER BY 1;`,
  orders_by_status: `SELECT status, COUNT(*) AS order_count, SUM(amount) AS total_amount
FROM orders
GROUP BY status
ORDER BY total_amount DESC;`,
  revenue_by_region: `SELECT c.region, SUM(o.amount) AS total_amount
FROM customers c
JOIN orders o ON c.id = o.customer_id
GROUP BY c.region
ORDER BY total_amount DESC;`,
  top_customers: `SELECT c.name, SUM(o.amount) AS total_amount
FROM customers c
JOIN orders o ON c.id = o.customer_id
GROUP BY c.name
ORDER BY total_amount DESC
LIMIT 20;`,
  recent_orders: `SELECT o.id, c.name, o.amount, o.status, o.order_date
FROM orders o
JOIN customers c ON c.id = o.customer_id
ORDER BY o.order_date DESC
LIMIT 20;`
};

export const defaultQuickQuery = "cube_by_status_region";
