# Product discovery: Nullroom's original vision

Status: **research and analysis for a decision**, not a commitment. No feature
is built from this document. This is not legal advice.

**Bottom line up front:** after two independent reviews that corrected two
central errors in the first draft, the recommendation is **Portfolio-Freeze**.
A direct competitor already occupies this niche (`cleanroom-mcp`, `phalus`),
the headline claim ("proves Room B never saw the original") overstates what a
hash chain can show, and no buyer is in hand. A migration-assurance **Pivot**
is the only option worth a cheap discovery test, and it is crowded too.

Sourcing: claims are marked `[src N]` to the bibliography, or `[unverified]`.

## 1. The vision, and the one distinctive piece

Room A reads the original and writes a behavior spec; a **wall** blocks
code/bytes; Room B reimplements from the spec alone; an **oracle** diffs the
rebuild against the original; an **audit chain** records what crossed. The one
piece that is not plain composition is **enforcing and recording the
information barrier**. Everything else is assembly of solved parts (§3).

### Correction to how the project describes itself

The first draft (and the project's own README/ARCHITECTURE) say the audit chain
"proves Room B never saw the original." The review is right that this
**overclaims**: a signed hash chain proves the *integrity of what was logged*
and that the logged crossings carried no code — not complete mediation. It does
not rule out side channels (the spec itself can leak protectable expression,
adaptive oracle queries can extract implementation detail, a worker may have
prior or parallel access). The honest claim is: *"records, tamper-evident, what
crossed the wall and that no raw code crossed it, and that Room B had no mounted
access to the original at runtime."* This narrower wording should replace the
"never saw" phrasing project-wide (a documentation follow-up, not a feature).

## 2. Who might need it

| Candidate | Need | Reality check |
| --- | --- | --- |
| Legal/compliance doing clean-room reimplementation | a defensible barrier record | small, conservative; counsel wants an expert-reviewed *process* with an admissibility story and a stable vendor, not a prototype `[src 1]` |
| Open reimplementation projects (ReactOS, Wine) | enforce tainted/clean separation | already handled by policy and community rule, not tooling `[src 2,3]`; poor customers |
| AI-reimplementation teams | prove the AI did not copy the source | the proof Nullroom gives is narrower than they need (§5); legally untested, `[unverified]` as a durable segment |
| **Internal platform / migration teams** | reduce cutover risk; reproducible evidence of behavior preservation | the most plausible buyer — but this drops the clean-room framing (§6 Pivot) |

No demand interviews exist. Every row above is a hypothesis, not evidence.

## 3. What already solves the adjacent problems

- **Behavioral oracle / equivalence (mature, not ours to invent):**
  matching-decompilation rebuilds function-by-function to a byte match `[src 4]`
  — but it is white-box (it reads the original) and is not black-box behavioral
  verification; differential testing (Csmith, EMI: 147 confirmed GCC/LLVM bugs)
  `[src 5]`; KLEE is symbolic execution used for equivalence crosschecking, not
  a general equivalence prover `[src 6]`; CompCert proves *compiler* semantic
  preservation, not arbitrary rebuild-vs-original equivalence `[src 7]`. All
  share Nullroom's ceiling: behavioral equality holds only on tested
  inputs/paths, except for expensive formal verification.
- **Tamper-evident provenance (solved primitive):** in-toto layouts + SLSA +
  Sigstore (Fulcio/Rekor) `[src 8]`; attested execution via AWS Nitro Enclaves
  and Azure Confidential Containers `[src 9,10]`; host-level "what did this
  process open" via auditd/eBPF. Nullroom composes these; it is not a new
  enforcement primitive.
- **Clean-room legal precedent:** Phoenix BIOS "Chinese Wall"; NEC v. Intel
  (clean-room work was persuasive evidence of non-infringement; NEC itself did
  not work strictly clean-room); Sega v. Accolade (disassembly can be fair use,
  an interoperability/fair-use holding, not an endorsement of a barrier
  product) `[src 2,11]`.

## 4. Is the gap real — corrected

**No. The first draft's "genuinely unoccupied" claim was wrong.** Direct tools
already target this exact niche:

- **`cleanroom-mcp`** (npm 0.2.0): "MCP server for clean-room software
  reimplementation — enforces the information barrier, manages specifications,
  and maintains a tamper-evident audit trail" `[src 12]` — i.e. Nullroom's
  vision, verbatim.
- **`phalus`** (docs site live) `[src 13]` and other "AI clean-room" efforts
  `[unverified: rigor and adoption not assessed]`.

Their quality and traction are unverified, but "no tool exists" cannot stand.
The generic capability is also occupied by attested enclaves + provenance
layers (§3). Nullroom's differentiation would be *composition and narrative and
test quality*, not a new category.

## 5. What caps the value (corrected, less absolute than the first draft)

1. **The proof is narrower than the concern — but does not sink every case.**
   Nullroom proves runtime non-access and log integrity, not freedom from
   training-data exposure. The review is right that this **sinks the
   AI-reimplementation buyer pitch specifically**, but classic clean-room never
   proved empty human prior knowledge either; courts weigh *process and
   substantial similarity*, not epistemic purity `[src 1]`. For a **human**
   Room B, or a model with a documented allowed corpus, the barrier record
   still has its classic value.
2. **Contamination has several channels, not one.** Spec leakage from Room A,
   adaptive oracle queries, prior/parallel access — training data is just one.
   A clean runtime log does not close these.
3. **Legal scope, corrected:** clean-room matters for copyright *and can matter
   for trade secrets* — US law (DTSA, 18 U.S.C. §1839) excludes lawful reverse
   engineering and independent derivation from "improper means", so barrier
   evidence can be relevant there `[src 14]` (the first draft said the
   opposite). For **patents**, independent creation ordinarily does **not**
   defeat infringement `[src, general; unverified across jurisdictions]`.
4. **Product reality:** the mature, valuable parts are already solved, the
   distinctive part now has direct competitors, and there is no buyer evidence.

## 6. Pivots worth naming

- **A. Migration / vendor-change assurance (strongest "build" case).** Capture
  a component's contract and traces, replay against a replacement, differential-
  test, and keep reproducible evidence — selling *reduced cutover risk* with
  **no legal cleanliness claim**. This reuses Nullroom's oracle and audit
  strengths and sidesteps the clean-room legal mess. **But it is crowded:**
  Pact (contract testing), Diffy (differential testing), Keploy (record/replay)
  already exist `[src 15,16,17]`; Nullroom would need a concrete wedge such as
  evidence-grade reproducibility or stateful-nondeterminism handling.
- **B. "What was the agent allowed to read" attestation for platform teams.**
  Drop the IP framing entirely; attest the information-flow boundary of an
  agent pipeline for teams already on Sigstore/agent sandboxes. Plausible, but
  hyperscalers can ship agent-input attestation quickly `[src 9,10]`.

Both are hypotheses with no demand evidence.

## 7. Smallest realistic test (corrected)

The first draft's "one toy reimplementation to one lawyer" is a false-negative
machine: a permissive toy removes the adversarial facts that make evidence
matter, and one lawyer's "helpful" is neither reliability nor willingness to
pay. Cheaper and more informative, **before any further code**:

- Build a one-page **report schema + threat model + a pair of traces (one
  deliberately contaminated, one clean)**.
- Show it to **3–5 practitioners** across IP litigation, in-house migration
  ownership, and forensic/expert review `[sample size is judgment]`.
- Ask three questions: *what conclusion would you sign from this? what evidence
  is missing? would you fund collecting it?*

A migration-owner "yes, this catches incompatibilities I'd pay to find before
cutover" is a stronger signal than any lawyer sentiment.

## 8. Decision template — Build / Pivot / Portfolio-Freeze

| Option | Means | Right when |
| --- | --- | --- |
| **Build** | extend the clean-room evidence product | only if §7 finds a buyer who accepts the narrowed proof and the training-data caveat — unlikely given `cleanroom-mcp`/`phalus` already exist |
| **Pivot** | pursue 6A (migration assurance) or 6B (agent info-flow attestation), dropping the legal clean-room promise | if §7's interviews surface a real wedge against Pact/Diffy/Keploy or the enclave vendors |
| **Portfolio-Freeze** | stop feature work; present Nullroom as a finished, tested engineering showcase; fix the "never saw" wording first | **default** — no buyer, direct competitors exist, headline proof overclaims |

### Recommendation

**Portfolio-Freeze.** The evidence points one way:

- The distinctive piece is **no longer unoccupied** (`cleanroom-mcp` is the
  same idea, shipping; `phalus` adjacent) `[src 12,13]`.
- The headline proof **overstates** what the mechanism shows, and the honest,
  narrowed version is "log integrity + no runtime access", which is stronger
  than an ordinary log but materially weaker than "no access" — not obviously
  worth a budget `[src 1]`.
- The valuable, mature parts (oracle, provenance) are **already solved**.
- There is **no buyer evidence**, and the most plausible buyer (migration
  teams) wants a different, also-crowded product.

So: **freeze feature development and present Nullroom as what it already is** —
a portfolio-grade engineering showcase (isolated execution, a tamper-evident
audit chain, a behavioral oracle, CI with signed provenance, a review culture
that caught real data-loss bugs, and honestly documented limits). First fix the
"never saw the original" wording project-wide to the narrowed claim, because
shipping an overclaim undercuts exactly the engineering credibility the freeze
is meant to showcase.

Pursue a **Pivot** only if the §7 interview round (days, no new code) finds a
concrete, fundable wedge — most likely in migration assurance, never on a legal
cleanliness promise. **Do not Build** without that.

## Bibliography

1. Reed Smith, "Clean-room coding in the age of AI", 2026 — reedsmith.com `[unverified: single read]`
2. Clean-room design (precedent overview) — en.wikipedia.org/wiki/Clean-room_design
3. Wine "Clean Room Guidelines"; ReactOS IP policy — winehq / reactos sources
4. pret/decomp, reccmp (matching decompilation) — project repos
5. Le, Afshari, Su, "Compiler validation via EMI", PLDI 2014 — cs.ucdavis.edu/~su/publications/emi.pdf
6. Cadar et al., "KLEE", OSDI 2008 — read.seas.harvard.edu
7. Leroy, "CompCert" — AbsInt / cs.tufts.edu
8. slsa.dev; in-toto.io; sigstore.dev
9. AWS Nitro Enclaves attestation — docs.aws.amazon.com/enclaves
10. Azure Confidential Containers attestation — learn.microsoft.com
11. Sega v. Accolade, 977 F.2d 1510 (9th Cir. 1992) — copyright.gov fair-use summary
12. `cleanroom-mcp` v0.2.0 — npmjs.com/package/cleanroom-mcp `[verified exists]`
13. `phalus` — docs.phalus.sh `[verified reachable; rigor unverified]`
14. 18 U.S.C. §1839 (DTSA definitions) — govinfo.gov
15. Pact — docs.pact.io
16. Diffy — github.com/opendiffy/diffy
17. Keploy — keploy.io/docs

## Appendix: independent review and dissent

Two read-only reviews (Codex `gpt-5.6-sol`, Cursor `cursor-grok-4.5-high`) of
the first draft, both pushing against it; their corrections are folded in above
and recorded here:

- **"No tool found" was false (Codex, blocker):** `cleanroom-mcp`, `phalus`,
  and other efforts already claim the barrier. Verified `cleanroom-mcp` exists.
- **"Proves never saw the original" overclaims (Codex, blocker):** a hash chain
  proves log integrity, not complete mediation. Folded into §1 and the
  recommendation.
- **Training-data as a total sink is overstated (both, major):** it sinks the
  AI-reimpl pitch, not human clean-room or documented-corpus cases. Softened in
  §5.
- **Trade-secret claim was backwards (Codex, major):** barrier evidence can
  matter for trade secrets (reverse-engineering exclusion). Corrected in §5.
- **Loose technical analogies (Codex, major):** KLEE, CompCert, matching
  decompilation re-stated precisely in §3.
- **Pivot missed (both, major):** migration/vendor-change assurance is the
  strongest build case but crowded (Pact/Diffy/Keploy); agent info-flow
  attestation is the non-IP alternative. Added as §6.
- **Pilot was a false-negative machine (both, major):** replaced with a
  practitioner interview round in §7.
- **Strongest case FOR building (Codex):** migration teams can measure value
  via incompatibilities caught before cutover, reproducibly, without depending
  on unsettled clean-room law.
- **Strongest case for FREEZING (Codex):** the headline proof is stronger than
  a log but weaker than "no access", exact competitors now exist, and no buyer
  evidence shows this distinction commands budget.

Unresolved, handed to the maintainer: no demand interviews were run; the legal
citations were read once and are not independently confirmed; `cleanroom-mcp`
and `phalus` were confirmed to exist but not evaluated for quality.
