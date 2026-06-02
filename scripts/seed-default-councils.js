import { openDatabase, migrate } from "../backend/db/sqlite.js";
import { CouncilOrchestrator } from "../backend/core/orchestrator.js";
import { EventEmitter } from "node:events";

const db = openDatabase(process.env.DATABASE_URL ?? "./data/synod.sqlite");
migrate(db);
const orchestrator = new CouncilOrchestrator({ db, events: new EventEmitter() });

if (!orchestrator.listCouncils().some((council) => council.name === "Product Launch Review Board")) {
  orchestrator.createCouncil({
    name: "Product Launch Review Board",
    description: "A reusable static council for launch, risk, and market-readiness decisions.",
    role_manifest: [
      { role_type: "SYNTHESIST", display_name: "Lead Synthesist", priority: 1, knowledge_source_type: "HYBRID", confidence_weight: 1 },
      { role_type: "DOMAIN_EXPERT", display_name: "Domain Expert", priority: 2, knowledge_source_type: "RAG", confidence_weight: 1.2 },
      { role_type: "SKEPTIC", display_name: "Skeptic", priority: 3, knowledge_source_type: "TRAINING", confidence_weight: 1 },
      { role_type: "ETHICIST", display_name: "Ethics Veto Reviewer", priority: 4, knowledge_source_type: "TRAINING", confidence_weight: 1 }
    ],
    hierarchy: { speaking_order: ["SYNTHESIST", "DOMAIN_EXPERT", "SKEPTIC", "ETHICIST"], veto_roles: ["ETHICIST"] },
    model_overrides: { DOMAIN_EXPERT: "mock-deep" },
    default_config: { max_rounds: 4 }
  });
}if (!orchestrator.listCouncils().some((council) => council.name === "AnythingLLM Full Council")) {
  orchestrator.createCouncil({
    name: "AnythingLLM Full Council",
    description: "Fully integrated council using the 4 local AnythingLLM workspaces.",
    role_manifest: [
      { role_type: "SYNTHESIST", display_name: "Lead Synthesist", priority: 1, knowledge_source_type: "HYBRID", workspace_id: "llm-council-lead-synthesist", confidence_weight: 1.2 },
      { role_type: "DOMAIN_EXPERT", display_name: "Domain Expert", priority: 2, knowledge_source_type: "RAG", workspace_id: "llm-council-domain-expert", confidence_weight: 1 },
      { role_type: "ETHICIST", display_name: "Policy Reviewer", priority: 3, knowledge_source_type: "RAG", workspace_id: "llm-council-policy-reviewer", confidence_weight: 1 },
      { role_type: "RISK_OFFICER", display_name: "Risk Officer", priority: 4, knowledge_source_type: "RAG", workspace_id: "llm-council-risk-officer", confidence_weight: 1 }
    ],
    hierarchy: { speaking_order: ["SYNTHESIST", "DOMAIN_EXPERT", "ETHICIST", "RISK_OFFICER"], veto_roles: [] },
    model_overrides: { SYNTHESIST: "anythingllm", DOMAIN_EXPERT: "anythingllm", ETHICIST: "anythingllm", RISK_OFFICER: "anythingllm" },
    default_config: { max_rounds: 4 }
  });
}

console.log("Default councils seeded.");
