# Workflow guide

Forseti tracks governance records within an organisation. The steps below
summarise the available workflow. For incomplete editing and approval features,
see [current limitations](known-limitations.md).

## 1. Record an intake request

Use `/intake/new` to submit a request and `/intake` to review the queue. Submission,
triage notes, and decisions persist. An endorsement does not automatically create
an inventory record or assessment; create those separately.

## 2. Register systems and use cases

Use `/inventory` to register a system and `/use-cases` to describe its purposes.
Systems and use cases have a many-to-many relationship. A use case has baseline
risk and oversight values, with optional overrides for individual linked systems.

## 3. Select controls

Use `/frameworks` to open the organisation's framework definitions. Record control
applicability and link system claims to the relevant controls. New organisations
need [reference initialization](deployment.md) before these definitions are available.
Readiness and coverage are calculated from workspace records.

## 4. Add evidence

Upload documents through `/evidence`, then link records and cite relevant content.
Metadata and extracted text persist; original files are not retained. Some scans
have no text preview. Verification controls are currently previews.
See the [evidence pipeline](evidence-pipeline.md).

## 5. Track assessments, risks, and findings

Create assessments, assign reviewers, and record risks and findings in their
registers. Assessment answer editing and sign-off, evidence verification, and
finding closure are incomplete. Do not use preview states as completed approvals.

## 6. Prepare reporting

Questionnaire drafts use stored workspace facts. Trust-centre and audit-pack pages
provide previews; public sharing and downloadable PDF audit packs are unavailable.
Supported record exports are separate from these previews.

## 7. Maintain records

Review ownership, evidence expiry, and risk treatment regularly. Retirement is
recorded but does not consistently exclude a system from every calculation.
Deleted records move to trash and can be restored during the retention window.
The optional retention job permanently removes expired trash; see
[retention scheduling](deployment.md#retention-scheduling).
