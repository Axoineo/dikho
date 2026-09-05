# Security Policy

## Overview

Security is an important part of the Dikho project. We take vulnerabilities involving authentication, authorization, user data, vendor/client information, API access, and infrastructure seriously.

This policy explains which versions are supported and how to responsibly report security vulnerabilities.

## Supported Versions

Dikho is currently under active development. Security fixes are generally applied to the latest stable version of the project.

| Version                   | Supported          |
| ------------------------- | ------------------ |
| Latest stable release     | :white_check_mark: |
| Development / main branch | :white_check_mark: |
| Older releases            | :x:                |

> **Note:** The `main` branch may contain changes that are still under development. Production deployments should use a reviewed and tested release or commit.

## Reporting a Vulnerability

If you discover a potential security vulnerability, **please do not report it through a public GitHub issue, discussion, pull request, or other public channel.**

Instead, report the vulnerability privately to the project administrator/security contact.

Your report should include:

* A clear description of the vulnerability.
* The affected component, feature, endpoint, or functionality.
* Steps to reproduce the issue.
* The potential security impact.
* Proof-of-concept code or screenshots, if applicable.
* Any suggested mitigation or fix, if you have one.

Please avoid including real user data, passwords, API keys, access tokens, or other sensitive information in your report.

## What Happens After Reporting

We aim to:

1. Acknowledge the report as soon as reasonably possible.
2. Review and reproduce the reported issue.
3. Determine its severity and security impact.
4. Work on a fix or mitigation when the vulnerability is confirmed.
5. Notify the reporter when the issue has been resolved or when further information is required.

Response and resolution times may vary depending on the severity and complexity of the vulnerability.

## Responsible Disclosure

Please allow reasonable time for the project maintainers to investigate and address a confirmed vulnerability before publicly disclosing technical details.

Security researchers who responsibly report vulnerabilities are appreciated and will be credited where appropriate, unless they prefer to remain anonymous.

## Security Scope

Security reports may include, but are not limited to:

* Authentication and session management vulnerabilities.
* Authorization and privilege escalation.
* OTP or passwordless authentication issues.
* Account takeover vulnerabilities.
* Insecure API endpoints.
* Exposure of client, vendor, sales, purchase-order, or other business data.
* Injection vulnerabilities.
* Cross-site scripting (XSS).
* Cross-site request forgery (CSRF).
* Server-side security issues.
* Sensitive information disclosure.
* Improper access control.
* Security issues involving third-party integrations.
* Cloud, storage, database, or deployment misconfigurations.

## Out of Scope

The following generally do not qualify as security vulnerabilities unless they demonstrate a meaningful security impact:

* Issues affecting only outdated or unsupported versions.
* Spam or social-engineering attempts against project contributors.
* Denial-of-service testing without prior authorization.
* Automated vulnerability scans that generate excessive traffic.
* Vulnerabilities in third-party services that are outside the project's control.
* Issues that require access to another user's credentials or private information.
* Purely theoretical vulnerabilities without a practical security impact.

## Security Best Practices for Contributors

Contributors should:

* Never commit passwords, API keys, tokens, private keys, or other secrets to the repository.
* Use environment variables or an appropriate secret-management system for sensitive configuration.
* Avoid exposing production credentials in development or testing environments.
* Follow the project's authentication and authorization patterns.
* Validate and sanitize untrusted input.
* Follow the principle of least privilege.
* Review security-sensitive changes before merging them into `main`.
* Avoid exposing sensitive information in logs, error messages, or client-side code.

## Secrets and Credentials

If a secret is accidentally committed to the repository, **do not assume that deleting it from the latest commit is sufficient**.

The exposed credential should be considered compromised and rotated or revoked immediately.

This includes:

* API keys
* Access tokens
* Database credentials
* SMTP credentials
* Cloud credentials
* Private keys
* Authentication secrets
* Service credentials

## Changes to This Policy

This security policy may be updated as the project architecture, deployment infrastructure, and security requirements evolve.

The latest version of this document applies to the project unless otherwise stated.
