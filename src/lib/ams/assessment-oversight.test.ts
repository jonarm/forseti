/** Assessment defaults must describe the assessed system/use-case pairing. */
import { expect, it } from "vitest";
import { fixtureWorkspace } from "./fixture-workspace";
import { workspace } from "./workspace";
import { seedAnswers } from "./fixtures/assessments";

it("prefills the system override while preserving an assessor's recorded answer", () => {
  const original = fixtureWorkspace();
  const assessment = original.assessments.find((a) => a.useCaseId)!;
  expect(assessment).toBeDefined();
  const ws = workspace({
    ...original,
    useCases: original.useCases.map((u) => u.id !== assessment.useCaseId ? u : {
      ...u,
      oversightLevel: "human_in_the_loop",
      systemOverrides: [{
        systemId: assessment.systemId, oversightLevel: "human_in_command",
        oversightSummary: "Pair-specific supervision", riskTier: null,
      }],
    }),
  });
  expect(seedAnswers(ws, { ...assessment, answers: {} }).oversight_level)
    .toBe("human_in_command");
  expect(seedAnswers(ws, { ...assessment, answers: { oversight_level: "human_on_the_loop" } }).oversight_level)
    .toBe("human_on_the_loop");
});
