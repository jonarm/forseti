import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  aiActivityEvent,
  aiApplicability,
  aiApplicabilitySystem,
  aiAssessment,
  aiAssessmentAnswer,
  aiControl,
  aiEvidence,
  aiEvidenceLink,
  aiFinding,
  aiFindingRisk,
  aiFramework,
  aiFrameworkNode,
  aiIntakeRequest,
  aiPerson,
  aiPolicy,
  aiQuestionnaire,
  aiQuestionnaireQuestion,
  aiRisk,
  aiRiskControl,
  aiSuggestion,
  aiSystem,
  aiUseCase,
  aiUseCaseSystem,
} from "@/db/schema";

import { PEOPLE } from "./ams/fixtures/people";
import { SYSTEMS } from "./ams/fixtures/systems";
import { USE_CASES } from "./ams/fixtures/use-cases";
import { REQUESTS } from "./ams/fixtures/requests";
import {
  ISO_42001,
  ISO_42001_CONTROLS,
  ISO_42001_NODES,
} from "./ams/fixtures/framework-iso-42001";
import { APPLICABILITY } from "./ams/fixtures/applicability";
import { ASSESSMENTS } from "./ams/fixtures/assessments";
import { EVIDENCE, POLICIES } from "./ams/fixtures/documents";
import { FINDINGS, FINDING_RISK_LINKS, RISKS } from "./ams/fixtures/registers";
import { ACTIVITY } from "./ams/fixtures/activity";
import { QUESTIONNAIRES } from "./ams/fixtures/questionnaires";
import { SUGGESTIONS } from "./ams/fixtures/ai";

/**
 * Load the demo organization from the fixture files.
 *
 * The fixtures stay the source of truth rather than being copied into SQL, for
 * one reason that matters more than convenience: they are also what the design
 * was approved against. If the seed diverges from them, the thing everyone
 * reviewed and the thing the app shows stop being the same artefact, and the
 * first person to notice is a prospect halfway through a demo.
 *
 * Idempotent by construction — every write upserts on the primary key, and the
 * link tables are cleared for this organization before being rewritten. Running
 * it twice produces the same rows; running it after an edit brings the database
 * back to the fixture.
 *
 * Note the ordering. People and policies land first because almost every other
 * record names an owner or cites a policy; systems land before use cases and
 * assessments because both carry a foreign key to them, and evidence lands
 * before its links for the same reason. Nothing here relies on deferred
 * constraints.
 */
export async function seedAiManagementSystem(organizationId: string): Promise<void> {
  /* Link tables first: they are the rows a re-seed must not duplicate, and
   * clearing them is scoped by organization so a shared database is safe. */
  await db.delete(aiEvidenceLink).where(eq(aiEvidenceLink.organizationId, organizationId));
  await db
    .delete(aiApplicabilitySystem)
    .where(eq(aiApplicabilitySystem.organizationId, organizationId));
  await db.delete(aiRiskControl).where(eq(aiRiskControl.organizationId, organizationId));
  await db
    .delete(aiUseCaseSystem)
    .where(eq(aiUseCaseSystem.organizationId, organizationId));
  await db.delete(aiFindingRisk).where(eq(aiFindingRisk.organizationId, organizationId));
  await db
    .delete(aiAssessmentAnswer)
    .where(eq(aiAssessmentAnswer.organizationId, organizationId));
  await db
    .delete(aiQuestionnaireQuestion)
    .where(eq(aiQuestionnaireQuestion.organizationId, organizationId));

  /* ------------------------------------------------------------- people */
  for (const person of PEOPLE) {
    const values = {
      id: person.id,
      organizationId,
      name: person.name,
      role: person.role,
      businessUnit: person.businessUnit,
    };
    await db
      .insert(aiPerson)
      .values(values)
      .onConflictDoUpdate({ target: [aiPerson.organizationId, aiPerson.id], set: values });
  }

  /* ----------------------------------------------------------- policies */
  for (const policy of POLICIES) {
    const values = {
      id: policy.id,
      organizationId,
      title: policy.title,
      status: policy.status,
      ownerId: policy.ownerId || null,
      version: policy.version,
      approvedAt: policy.approvedAt,
      nextReviewDate: policy.nextReviewDate,
      summary: policy.summary,
    };
    await db
      .insert(aiPolicy)
      .values(values)
      .onConflictDoUpdate({ target: [aiPolicy.organizationId, aiPolicy.id], set: values });
  }

  /* ---------------------------------------------------------- inventory */
  for (const system of SYSTEMS) {
    const values = {
      id: system.id,
      organizationId,
      name: system.name,
      vendor: system.vendor,
      origin: system.origin,
      isGenAi: system.isGenAi,
      businessUnit: system.businessUnit,
      ownerId: system.ownerId || null,
      lifecycleStage: system.lifecycleStage,
      riskTier: system.riskTier,
      assessmentStatus: system.assessmentStatus,
      purpose: system.purpose,
      deploymentModel: system.deploymentModel,
      hostingRegions: system.hostingRegions,
      dataResidency: system.dataResidency,
      userGroups: system.userGroups,
      approxUsers: system.approxUsers,
      dataCategories: system.dataCategories as string[],
      characteristics: system.characteristics as string[],
      vendorDetail: system.vendorDetail as unknown as Record<string, unknown>,
      registeredAt: system.registeredAt,
      nextReviewDate: system.nextReviewDate,
      discoveredVia: system.discoveredVia,
    };
    await db
      .insert(aiSystem)
      .values(values)
      .onConflictDoUpdate({ target: [aiSystem.organizationId, aiSystem.id], set: values });
  }

  for (const useCase of USE_CASES) {
    const values = {
      id: useCase.id,
      organizationId,
      name: useCase.name,
      description: useCase.description,
      businessUnit: useCase.businessUnit,
      ownerId: useCase.ownerId || null,
      riskTier: useCase.riskTier,
      oversightLevel: useCase.oversightLevel,
      oversightSummary: useCase.oversightSummary,
      facesCustomers: useCase.facesCustomers,
      informsDecisionsAboutPeople: useCase.informsDecisionsAboutPeople,
      dataCategories: useCase.dataCategories as string[],
      approxUsers: useCase.approxUsers,
      status: useCase.status,
    };
    await db
      .insert(aiUseCase)
      .values(values)
      .onConflictDoUpdate({ target: [aiUseCase.organizationId, aiUseCase.id], set: values });

    /* The relation, written after the row it hangs off. Cleared for this
     * organization at the top, so this rewrites rather than accumulates. */
    if (useCase.systemIds.length > 0) {
      await db
        .insert(aiUseCaseSystem)
        .values(
          useCase.systemIds.map((systemId) => ({
            organizationId,
            useCaseId: useCase.id,
            systemId,
          })),
        )
        .onConflictDoNothing();
    }
  }

  /* ------------------------------------------------------------- intake */
  for (const request of REQUESTS) {
    const values = {
      id: request.id,
      organizationId,
      reference: request.reference,
      submission: request.submission as unknown as Record<string, unknown>,
      submittedById: request.submittedById || null,
      submittedAt: request.submittedAt,
      status: request.status,
      reviewerId: request.reviewerId || null,
      reviewType: request.reviewType,
      overrideJustification: request.overrideJustification,
      decision: request.decision,
      decidedById: request.decidedById,
      decidedAt: request.decidedAt,
      comments: request.comments,
      createdSystemId: request.createdSystemId,
    };
    await db
      .insert(aiIntakeRequest)
      .values(values)
      .onConflictDoUpdate({ target: [aiIntakeRequest.organizationId, aiIntakeRequest.id], set: values });
  }

  /* ---------------------------------------------------------- framework */
  const fw = {
    id: ISO_42001.id,
    organizationId,
    name: ISO_42001.name,
    shortName: ISO_42001.shortName,
    description: ISO_42001.description,
    version: ISO_42001.version,
    enabled: true,
  };
  await db
    .insert(aiFramework)
    .values(fw)
    .onConflictDoUpdate({
      target: [aiFramework.organizationId, aiFramework.id],
      set: fw,
    });

  for (const [i, node] of ISO_42001_NODES.entries()) {
    const values = {
      id: node.id,
      organizationId,
      frameworkId: node.frameworkId,
      officialRef: node.officialRef,
      parentId: node.parentId,
      kind: node.kind,
      shortTitle: node.shortTitle,
      position: i,
    };
    await db
      .insert(aiFrameworkNode)
      .values(values)
      .onConflictDoUpdate({
        target: [aiFrameworkNode.organizationId, aiFrameworkNode.id],
        set: values,
      });
  }

  for (const [i, control] of ISO_42001_CONTROLS.entries()) {
    const values = {
      id: control.id,
      organizationId,
      frameworkId: control.frameworkId,
      nodeId: control.nodeId,
      officialRef: control.officialRef,
      shortTitle: control.shortTitle,
      requirementSummary: control.requirementSummary,
      evidenceGuidance: control.evidenceGuidance,
      developmentOnly: control.developmentOnly,
      position: i,
    };
    await db
      .insert(aiControl)
      .values(values)
      .onConflictDoUpdate({
        target: [aiControl.organizationId, aiControl.id],
        set: values,
      });
  }

  /* ------------------------------------------------------ applicability */
  for (const row of APPLICABILITY) {
    const values = {
      organizationId,
      frameworkId: row.frameworkId,
      controlId: row.controlId,
      applicability: row.applicability,
      justification: row.justification,
      implementationStatus: row.implementationStatus,
      ownerId: row.ownerId,
      linkedPolicyId: row.linkedPolicyId,
      lastReviewedAt: row.lastReviewedAt,
    };
    await db
      .insert(aiApplicability)
      .values(values)
      .onConflictDoUpdate({
        target: [
          aiApplicability.organizationId,
          aiApplicability.frameworkId,
          aiApplicability.controlId,
        ],
        set: values,
      });

    if (row.appliesToSystemIds.length > 0) {
      await db
        .insert(aiApplicabilitySystem)
        .values(
          row.appliesToSystemIds.map((systemId) => ({
            organizationId,
            frameworkId: row.frameworkId,
            controlId: row.controlId,
            systemId,
          })),
        )
        .onConflictDoNothing();
    }
  }

  /* --------------------------------------------------------- assessments */
  for (const assessment of ASSESSMENTS) {
    const values = {
      id: assessment.id,
      organizationId,
      templateId: assessment.templateId,
      systemId: assessment.systemId,
      useCaseId: assessment.useCaseId,
      status: assessment.status,
      signOff: assessment.signOff as unknown as Record<string, unknown>[],
      dueAt: assessment.dueAt,
    };
    await db
      .insert(aiAssessment)
      .values(values)
      .onConflictDoUpdate({ target: [aiAssessment.organizationId, aiAssessment.id], set: values });

    const answers = Object.entries(assessment.answers);
    if (answers.length > 0) {
      await db.insert(aiAssessmentAnswer).values(
        answers.map(([fieldId, value]) => ({
          organizationId,
          assessmentId: assessment.id,
          fieldId,
          value: value as Record<string, unknown>,
        })),
      );
    }
  }

  /* --------------------------------------------------------------- risks */
  for (const risk of RISKS) {
    const values = {
      id: risk.id,
      organizationId,
      title: risk.title,
      systemId: risk.systemId,
      useCaseId: risk.useCaseId,
      inherentLikelihood: risk.inherentLikelihood,
      inherentImpact: risk.inherentImpact,
      treatment: risk.treatment,
      treatmentSummary: risk.treatmentSummary,
      residualLikelihood: risk.residualLikelihood,
      residualImpact: risk.residualImpact,
      ownerId: risk.ownerId || null,
      status: risk.status,
      acceptedById: risk.acceptedById,
      acceptedAt: risk.acceptedAt,
    };
    await db
      .insert(aiRisk)
      .values(values)
      .onConflictDoUpdate({ target: [aiRisk.organizationId, aiRisk.id], set: values });

    if (risk.controlIds.length > 0) {
      await db
        .insert(aiRiskControl)
        .values(
          risk.controlIds.map((controlId) => ({
            organizationId,
            riskId: risk.id,
            controlId,
          })),
        )
        .onConflictDoNothing();
    }
  }

  /* ------------------------------------------------------------ findings */
  for (const finding of FINDINGS) {
    const values = {
      id: finding.id,
      organizationId,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      source: finding.source,
      raisedBy: finding.raisedBy,
      raisedAt: finding.raisedAt,
      dueAt: finding.dueAt,
      ownerId: finding.ownerId || null,
      systemId: finding.systemId,
      controlId: finding.controlId,
      summary: finding.summary,
      rootCause: finding.rootCause,
      correctiveAction: finding.correctiveAction,
      verifiedById: finding.verifiedById,
      verifiedAt: finding.verifiedAt,
      verificationNote: finding.verificationNote,
      closedAt: finding.closedAt,
    };
    await db
      .insert(aiFinding)
      .values(values)
      .onConflictDoUpdate({ target: [aiFinding.organizationId, aiFinding.id], set: values });
  }

  if (FINDING_RISK_LINKS.length > 0) {
    await db
      .insert(aiFindingRisk)
      .values(FINDING_RISK_LINKS.map((link) => ({ organizationId, ...link })))
      .onConflictDoNothing();
  }

  /* ------------------------------------------------------------ evidence */
  for (const doc of EVIDENCE) {
    const values = {
      id: doc.id,
      organizationId,
      title: doc.title,
      type: doc.type,
      ownerId: doc.ownerId || null,
      source: doc.source,
      collectedAt: doc.collectedAt,
      expiresAt: doc.expiresAt,
      verificationState: doc.verificationState,
      file: (doc.file ?? null) as Record<string, unknown> | null,
    };
    await db
      .insert(aiEvidence)
      .values(values)
      .onConflictDoUpdate({ target: [aiEvidence.organizationId, aiEvidence.id], set: values });

    const links = [
      ...doc.linkedControlIds.map((targetId) => ({
        organizationId,
        evidenceId: doc.id,
        targetKind: "control",
        targetId,
      })),
      ...doc.linkedSystemIds.map((targetId) => ({
        organizationId,
        evidenceId: doc.id,
        targetKind: "system",
        targetId,
      })),
    ];
    if (links.length > 0) {
      await db.insert(aiEvidenceLink).values(links).onConflictDoNothing();
    }
  }

  /* ------------------------------------------------------------ activity */
  /* The one register the re-seed does not clear first. `ai_activity_event` is
   * append-only at the database level, so the DELETE the other tables get would
   * raise — and that is the guarantee working, not an obstacle to route around.
   * Conflicts are skipped instead: a second seed cannot revise the history the
   * first one wrote, which is exactly the property being demonstrated. Use
   * `npm run db:reset` when the demo genuinely needs a clean trail. */
  if (ACTIVITY.length > 0) {
    await db
      .insert(aiActivityEvent)
      .values(
        ACTIVITY.map((event) => ({
          id: event.id,
          organizationId,
          subjectKind: event.subjectKind,
          subjectId: event.subjectId,
          actorId: event.actorId || null,
          action: event.action,
          field: event.field,
          before: event.before,
          after: event.after,
          reason: event.reason,
          at: new Date(event.at),
          viaSuggestionId: event.viaSuggestionId,
        })),
      )
      .onConflictDoNothing();
  }

  /* ---------------------------------------------------- questionnaires */
  for (const questionnaire of QUESTIONNAIRES) {
    const values = {
      id: questionnaire.id,
      organizationId,
      title: questionnaire.title,
      requester: questionnaire.requester,
      requesterType: questionnaire.requesterType,
      receivedAt: questionnaire.receivedAt,
      dueAt: questionnaire.dueAt,
      ownerId: questionnaire.ownerId || null,
      status: questionnaire.status,
      note: questionnaire.note,
    };
    await db
      .insert(aiQuestionnaire)
      .values(values)
      .onConflictDoUpdate({ target: [aiQuestionnaire.organizationId, aiQuestionnaire.id], set: values });

    if (questionnaire.questions.length > 0) {
      await db.insert(aiQuestionnaireQuestion).values(
        questionnaire.questions.map((question, position) => ({
          id: question.id,
          organizationId,
          questionnaireId: questionnaire.id,
          number: question.number,
          text: question.text,
          position,
          controlIds: question.controlIds,
          policyIds: question.policyIds,
          evidenceIds: question.evidenceIds,
        })),
      );
    }
  }

  /* ------------------------------------------------------- suggestions */
  /* Seeded even though no model is called in this slice: a suggestion and the
   * decision taken on it are an audit record, and the activity trail points at
   * them by id. Dropping them would break `viaSuggestionId` on replay. */
  for (const suggestion of SUGGESTIONS) {
    const values = {
      id: suggestion.id,
      organizationId,
      targetKind: suggestion.target.kind,
      targetId: suggestion.target.id,
      recommendation: suggestion.recommendation,
      reasoning: suggestion.reasoning,
      supportingData: suggestion.supportingData as unknown as Record<string, unknown>[],
      confidence: Math.round(suggestion.confidence * 100),
      status: suggestion.status,
      decidedById: suggestion.decidedById,
      decidedAt: suggestion.decidedAt,
      editedText: suggestion.editedText,
    };
    await db
      .insert(aiSuggestion)
      .values(values)
      .onConflictDoUpdate({ target: [aiSuggestion.organizationId, aiSuggestion.id], set: values });
  }
}
