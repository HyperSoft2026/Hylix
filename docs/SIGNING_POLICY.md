# Hylix Android Signing & Certificate Continuity Policy

**Application ID**: `com.hypersoft.hylix`  
**Status**: Pre-Release Foundation (Awaiting One-Time External Production Key Provisioning)

---

## 1. Core Invariants

1. **Fixed Identity**: Every official release of Hylix must use `applicationId = "com.hypersoft.hylix"`.
2. **Single Production Keystore**: The production signing key for Hylix is generated **once** by HyperSoft maintainers in an offline, air-gapped or hardware-backed environment outside the Git repository.
3. **Zero Automatic Key Generation**: Build scripts (`android/app/build.gradle.kts`) are strictly prohibited from invoking `keytool -genkey` or automatically generating fallback release certificates.
4. **Zero Keys in Git or APK**:
   - `.gitignore` blocks `*.jks`, `*.keystore`, `*.p12`, `*.pfx`, `*.pem`, `*.key`, and `signing.properties`.
   - `android/app/build.gradle.kts` verifies at build time that `storeFile.canonicalPath` does **not** reside inside `rootProject.projectDir`.
5. **Immutable SHA-1 Continuity**:
   - Android OS package installer rejects updates if the signing certificate SHA-1 / SHA-256 changes.
   - No placeholder or fabricated SHA-1 value is committed to the repository.
   - Once the official production certificate is generated, its real SHA-1 fingerprint is supplied via `HYLIX_EXPECTED_CERT_SHA1` to prevent accidental key rotation or replacement.

---

## 2. How Release Signing Is Configured Safely

Release signing parameters are resolved exclusively from external environment variables (or an untracked external `signing.properties` file during local maintainer release builds):

| Environment Variable | Property Key | Description |
| :--- | :--- | :--- |
| `HYLIX_RELEASE_STORE_FILE` | `storeFile` | Absolute path to the production keystore located **outside** the Git repository. |
| `HYLIX_RELEASE_STORE_PASSWORD` | `storePassword` | Keystore password (redacted by `RedactedDiagnosticLogger`). |
| `HYLIX_RELEASE_KEY_ALIAS` | `keyAlias` | Production key alias (e.g., `hylix-release-key`). |
| `HYLIX_RELEASE_KEY_PASSWORD` | `keyPassword` | Private key password (redacted by `RedactedDiagnosticLogger`). |
| `HYLIX_EXPECTED_CERT_SHA1` | `expectedCertSha1` | The 20-byte colon-separated SHA-1 fingerprint of the official production certificate. |

---

## 3. Safeguards Against Accidental Key Replacement

Both `android/app/build.gradle.kts` and `evaluateAndroidSigningPolicy()` (`src/security/securityFoundation.ts`) enforce the following state machine:

- **`DEBUG_BUILD_PERMITTED`**: Standard local development/debug builds run without requiring production credentials.
- **`AWAITING_INITIAL_PRODUCTION_CERTIFICATE`**: When inspecting the repository before the production certificate has been provisioned, the policy reports a clean awaiting state without inventing a fake SHA-1.
- **`READY_FOR_RELEASE_SIGNING`**: When external credentials and `HYLIX_EXPECTED_CERT_SHA1` are provided and match the active certificate fingerprint.
- **`POLICY_VIOLATION`**: Immediately aborts the release build if:
  - `applicationId != "com.hypersoft.hylix"`
  - `autoGenerateKeystoreOnBuild == true`
  - Keystore resides inside the Git repository or APK assets
  - A dummy/placeholder SHA-1 (`00:00:...`, `AA:BB:...`) is supplied
  - `activeCertificateSha1 != expectedCertificateSha1`
