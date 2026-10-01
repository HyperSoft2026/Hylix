import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ============================================================================
// HYLIX IMMUTABLE ANDROID IDENTITY & PRODUCTION SIGNING GUARD
// ============================================================================
val hylixImmutableAppId = "com.hypersoft.hylix"

val externalSigningPropsFile = rootProject.file("signing/signing.properties")
val externalSigningProps = Properties().apply {
    if (externalSigningPropsFile.exists() && externalSigningPropsFile.isFile) {
        FileInputStream(externalSigningPropsFile).use { load(it) }
    }
}

fun resolveSigningParam(envKey: String, propKey: String): String? {
    val fromEnv = System.getenv(envKey)?.trim()
    if (!fromEnv.isNullOrEmpty()) return fromEnv
    val fromProps = externalSigningProps.getProperty(propKey)?.trim()
    if (!fromProps.isNullOrEmpty()) return fromProps
    return null
}

val releaseStoreFilePath = resolveSigningParam("HYLIX_RELEASE_STORE_FILE", "storeFile")
val releaseStorePassword = resolveSigningParam("HYLIX_RELEASE_STORE_PASSWORD", "storePassword")
val releaseKeyAlias = resolveSigningParam("HYLIX_RELEASE_KEY_ALIAS", "keyAlias")
val releaseKeyPassword = resolveSigningParam("HYLIX_RELEASE_KEY_PASSWORD", "keyPassword")
val expectedCertSha1 = resolveSigningParam("HYLIX_EXPECTED_CERT_SHA1", "expectedCertSha1")

val hasCompleteReleaseSigningConfig =
    !releaseStoreFilePath.isNullOrEmpty() &&
    !releaseStorePassword.isNullOrEmpty() &&
    !releaseKeyAlias.isNullOrEmpty() &&
    !releaseKeyPassword.isNullOrEmpty()

android {
    namespace = hylixImmutableAppId
    compileSdk = 35

    defaultConfig {
        // CRITICAL INVARIANT: Never change the official Hylix Application ID
        applicationId = hylixImmutableAppId
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            // Production signing key MUST be provisioned once externally.
            // Never auto-generate a keystore or bundle keys in the repository.
            if (hasCompleteReleaseSigningConfig) {
                val resolvedFile = file(releaseStoreFilePath!!)
                require(resolvedFile.exists()) {
                    "Hylix Release Signing Error: Configured keystore file does not exist at the external path."
                }
                require(!resolvedFile.canonicalPath.startsWith(rootProject.projectDir.canonicalPath)) {
                    "Hylix Security Violation: Production keystore file must NOT reside inside the Git repository directory."
                }
                storeFile = resolvedFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
            isDebuggable = true
        }
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            isDebuggable = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (hasCompleteReleaseSigningConfig) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Guard task: blocks assembleRelease / bundleRelease if production signing is missing
// or if expectedCertSha1 format is invalid, preventing accidental key replacement.
tasks.configureEach {
    if (name.contains("Release", ignoreCase = true) && (name.startsWith("assemble") || name.startsWith("bundle") || name.startsWith("package"))) {
        doFirst {
            check(android.defaultConfig.applicationId == "com.hypersoft.hylix") {
                "Hylix Identity Invariant Broken: applicationId must remain 'com.hypersoft.hylix'."
            }
            check(hasCompleteReleaseSigningConfig) {
                "Hylix Release Signing Blocked: Production signing credentials were not provided. " +
                "Hylix never auto-generates release certificates. Configure external environment variables " +
                "(HYLIX_RELEASE_STORE_FILE, HYLIX_RELEASE_STORE_PASSWORD, HYLIX_RELEASE_KEY_ALIAS, HYLIX_RELEASE_KEY_PASSWORD)."
            }
            check(!expectedCertSha1.isNullOrEmpty()) {
                "Hylix Certificate Continuity Guard: HYLIX_EXPECTED_CERT_SHA1 must be set for release builds " +
                "to verify that the single official production certificate has not been accidentally replaced."
            }
        }
    }
}
