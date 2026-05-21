# Kubernetes manifests (deferred)

Kubernetes deployment is deferred past the MVP milestone. The current recommended way to run Trace is Docker Compose (`infra/docker/docker-compose.yml`).

When Kubernetes support is added, this directory will contain:

- `namespace.yaml`
- `postgres/` — StatefulSet, PVC, Service
- `trino/` — Deployment, ConfigMap, Service
- `keycloak/` — Deployment, Secret, Service
- `opa/` — Deployment, ConfigMap (policies), Service
- `api/` — Deployment, Service, HPA
- `web/` — Deployment, Service, Ingress
- `helmfile.yaml` or top-level Helm chart

Track issue: _add K8s manifests when moving to a shared environment_.
