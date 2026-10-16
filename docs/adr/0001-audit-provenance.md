# ADR 0001: Audit provenance — Sigstore attestations instead of a local Ed25519 key

Status: accepted (2026-10-16)

## Context

`audit_chain.json` is a SHA-256 hash chain. It proves internal consistency:
editing, dropping or reordering an entry, or changing a file in Room B's inbox,
breaks `verifyChain`. It does not prove who produced the chain. Anyone who can
write the file can rebuild the whole chain from scratch with valid hashes.

The question was whether an Ed25519 signature over the chain head adds a real
guarantee, and how the key would be managed.

## Threats, and what each option stops

| Threat | Hash chain | + local Ed25519 key | + CI attestation (Sigstore) |
| --- | --- | --- | --- |
| A room edits the chain | stopped: rooms have no mount of it | no change | no change |
| A room edits its inbox after crossing | detected | no change | no change |
| Someone rewrites the chain on the operator's machine | not detected | not detected: the key sits on the same machine | not applicable: CI runs are separate |
| A published report is swapped or edited later | not detected | detected, if verifiers trust the key | detected; identity is the workflow file, commit and run |
| Key theft or loss | – | must be handled: storage, rotation, revocation | no long-lived key |

A local key only helps if the signer is more trusted than whoever can touch the
files. On a single developer machine it is not: the same user owns key, chain
and code. It would add key management without adding proof.

## Decision

- Keep the hash chain as the integrity mechanism for a case directory.
- On every push to `main`, CI signs `report.json` and `audit_chain.json` with
  `actions/attest-build-provenance` (Sigstore, keyless, short-lived certificate
  bound to the workflow's OIDC identity, logged in the public transparency log).
- No long-lived signing key exists in this project.

Verify a downloaded artifact:

```bash
gh attestation verify report.json -R BEKO2210/nullroom
```

## Consequences

- Provenance is available for CI runs only. Local runs are integrity-checked
  (hash chain) but unsigned, and the documentation says so.
- Revisit if runs move to a separate machine or service that verifiers trust
  more than the operator; then a key held there (or in an HSM/KMS) would add
  a real guarantee.
