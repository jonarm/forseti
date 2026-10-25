/**
 * The demo organisation, assembled from the fixture modules.
 *
 * This is the one remaining place that imports every fixture file, and it earns
 * that by being the seed's input and the tests' expected value rather than
 * something a screen reaches for. `seedAiManagementSystem` writes exactly this
 * into Postgres, so a test can seed an organisation, read its workspace back
 * through the store, and assert the derived figures match the ones computed
 * here — which is what "the mockup is the spec" means once the mockup is gone.
 *
 * Server-only by intent. Pulling it into a client bundle would ship every
 * fixture to the browser and re-create exactly the coupling the workspace was
 * introduced to remove.
 */
import { PEOPLE, BUSINESS_UNITS } from "./fixtures/people";
import { SYSTEMS } from "./fixtures/systems";
import { USE_CASES } from "./fixtures/use-cases";
import { REQUESTS } from "./fixtures/requests";
import { ISO_42001, ISO_42001_NODES, ISO_42001_CONTROLS } from "./fixtures/framework-iso-42001";
import { APPLICABILITY } from "./fixtures/applicability";
import { POLICIES, EVIDENCE } from "./fixtures/documents";
import { ASSESSMENTS } from "./fixtures/assessments";
import { RISKS, FINDINGS, FINDING_RISK_LINKS } from "./fixtures/registers";
import { ACTIVITY } from "./fixtures/activity";
import { QUESTIONNAIRES } from "./fixtures/questionnaires";
import { SUGGESTIONS } from "./fixtures/ai";
import { workspace, type Workspace, type WorkspaceData } from "./workspace";

export function fixtureWorkspaceData(): WorkspaceData {
  return {
    people: [...PEOPLE],
    /* Empty, and it has to be: an account-to-person link names a Better Auth
     * user id, and the fixtures describe an organisation rather than a set of
     * sign-ins. `scripts/seed.ts` adds the links once the demo accounts exist. */
    accountPeople: [],
    businessUnits: [...BUSINESS_UNITS],
    systems: [...SYSTEMS],
    useCases: [...USE_CASES],
    requests: [...REQUESTS],
    framework: ISO_42001,
    nodes: [...ISO_42001_NODES],
    controls: [...ISO_42001_CONTROLS],
    applicability: [...APPLICABILITY],
    policies: [...POLICIES],
    evidence: [...EVIDENCE],
    assessments: [...ASSESSMENTS],
    risks: [...RISKS],
    findings: [...FINDINGS],
    findingRiskLinks: [...FINDING_RISK_LINKS],
    activity: [...ACTIVITY],
    questionnaires: [...QUESTIONNAIRES],
    suggestions: [...SUGGESTIONS],
    /* No fixture notes: a note is written on the screen, not seeded. */
    intakeNotes: [],
  };
}

export function fixtureWorkspace(): Workspace {
  return workspace(fixtureWorkspaceData());
}
