# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| Latest `main` / published npm release | Yes |
| Older npm majors | Best-effort until a newer major ships |

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories on this repository:

https://github.com/yaboijams/firebase-multi-env/security/advisories/new

Include:

- Affected package version / commit
- Reproduction steps (PoC preferred)
- Impact (env crossover, privilege escalation, silent fallback, etc.)

We aim to acknowledge reports within **7 days** and to ship a fix or mitigation guidance for confirmed issues as quickly as practical.

Do **not** open a public issue for unfixed vulnerabilities.

## Security assumptions

This package hardens **request-local environment routing** inside one Firebase/GCP project. It does **not** replace:

- Per-environment service accounts / IAM
- Secret Manager isolation
- Separate Firebase projects (strongest blast-radius boundary)
- Correct Firestore Security Rules
- Secure CI/CD and deployer identities

See [templates/THREAT_MODEL.md](./templates/THREAT_MODEL.md) for what is and is not covered.
