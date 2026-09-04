# Synod Blueprints

These Mermaid files are the canonical, editable architecture blueprints. Graphify is not installed in this workspace, so they are stored as portable source diagrams suitable for Graphify Mermaid import or any Mermaid-capable renderer.

| Blueprint | Scope |
| --- | --- |
| [System context](01-system-context.mmd) | Runtime components and external services. |
| [Decision lifecycle](02-decision-lifecycle.mmd) | From prompt to verdict and memory. |
| [Provider resilience](03-provider-resilience.mmd) | Routing, normalization, warnings, and fallback. |
| [Knowledge flow](04-memory-and-knowledge.mmd) | Uploads, Scout, memory, and search. |
| [Experience flow](05-ux-interaction.mmd) | Sidebar, council, QR, and result interaction. |
| [Deployment/security](06-deployment-and-security.mmd) | HTTPS, persistence, secrets, backups. |
| [Enhancement roadmap](07-enhancement-roadmap.mmd) | Original blueprints for future capability areas. |

Maintain diagrams in the same pull request as the capability they describe. Do not use a graph to imply a feature is already implemented; proposed nodes are violet and the current baseline is mint.
