# Hylix V1.0.0 — Release ProGuard / R8 Rules
# Keep official Android entry point and architectural boundary interfaces intact.
-keep class com.hypersoft.hylix.platform.android.HylixMainActivity { *; }
-assumenosideeffects class android.util.Log {
    public static int d(...);
    public static int v(...);
}
