# Query engine

Contains Trino deployment configuration and the semantic model definition.

## Trino configuration

Configuration files are mounted into the Trino Docker container at `/etc/trino`:

```
trino/
  etc/
    config.properties     Coordinator settings (port 8080, 1GB query memory)
    jvm.config            JVM flags (1GB heap, G1GC)
    node.properties       Node identity and data dir
    catalog/
      postgres.properties JDBC connector for the local Postgres instance
```

## Semantic model

`semantic.yml` defines a Cube-style OLAP model over the seeded `customers`/`orders` tables. The API reads this file at startup and exposes it at `GET /api/v1/semantic`.

### Model structure

```yaml
cubes:
  - name: orders
    sql: SELECT * FROM orders
    joins:
      - name: customers
        sql: "{orders.customer_id} = {customers.id}"
        relationship: many_to_one
    measures:
      - name: total_amount
        sql: amount
        type: sum
      - name: order_count
        sql: id
        type: count
    dimensions:
      - name: status
        sql: status
        type: string
      - name: order_date
        sql: order_date
        type: time
      - name: customer_name
        sql: "{customers.name}"
        type: string
      - name: region
        sql: "{customers.region}"
        type: string
```

## Extending the model

1. Add a new cube or dimension to `semantic.yml`.
2. Restart the API — it re-reads the file on startup.
3. The visual builder in the web UI will automatically reflect new measures and dimensions.
