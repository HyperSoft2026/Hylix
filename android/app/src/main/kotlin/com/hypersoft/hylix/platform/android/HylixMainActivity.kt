package com.hypersoft.hylix.platform.android

import android.app.Activity
import android.os.Bundle
import java.io.File

/**
 * Hylix V1.0.0 — Android Platform Entry Point (`com.hypersoft.hylix`).
 *
 * Enforces the Android Application Sandbox and Local-First storage boundaries:
 * - Workspace root is confined to `context.noBackupFilesDir` / `context.filesDir`.
 * - Ephemeral build staging is confined to `context.cacheDir`.
 * - Zero dangerous permissions or external cloud dependencies are required.
 */
class HylixMainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        initializeSandboxDirectories()
    }

    private fun initializeSandboxDirectories() {
        val projectsDir = File(noBackupFilesDir, "hylix_projects")
        val stagingDir = File(cacheDir, "hylix_atomic_staging")
        val buildWorkspaceDir = File(cacheDir, "hylix_build_workspace")

        if (!projectsDir.exists()) projectsDir.mkdirs()
        if (!stagingDir.exists()) stagingDir.mkdirs()
        if (!buildWorkspaceDir.exists()) buildWorkspaceDir.mkdirs()
    }

    companion object {
        const val APPLICATION_ID: String = "com.hypersoft.hylix"
        const val ENGINE_VERSION: String = "1.0.0"
    }
}
