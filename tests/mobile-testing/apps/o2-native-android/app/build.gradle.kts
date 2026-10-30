plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.o2native"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.o2native"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        // Build-time overridable RUM target: CI sets these env vars to point at a local instance.
        // With none set they fall back to PLACEHOLDERS — set O2_RUM_HOST/ORG/TOKEN for a real target.
        buildConfigField("String", "OO_HOST", "\"${System.getenv("O2_RUM_HOST") ?: "https://openobserve.example.com"}\"")
        buildConfigField("String", "OO_ORG", "\"${System.getenv("O2_RUM_ORG") ?: "REPLACE_ME"}\"")
        buildConfigField("String", "OO_TOKEN", "\"${System.getenv("O2_RUM_TOKEN") ?: "REPLACE_ME"}\"")
        buildConfigField("String", "OO_ENV", "\"${System.getenv("O2_RUM_ENV") ?: "production"}\"")
    }

    buildFeatures { buildConfig = true }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Debug-sign the release so it installs on the emulator without a real keystore.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

// SDK version is overridable at build time (CI sets O2_ANDROID_SDK_VERSION on a release event to
// test the LATEST SDK); with none set it falls back to the committed pin, so builds stay reproducible.
val ooSdkVersion = System.getenv("O2_ANDROID_SDK_VERSION") ?: "0.1.0"

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")

    // OpenObserve native Android RUM SDK (fork of Datadog android-sdk)
    implementation("ai.openobserve:o2-sdk-android-rum:$ooSdkVersion")
    implementation("ai.openobserve:o2-sdk-android-logs:$ooSdkVersion")
    implementation("ai.openobserve:o2-sdk-android-session-replay:$ooSdkVersion")
    // OkHttp resource/network tracking (OpenObserveInterceptor)
    implementation("ai.openobserve:o2-sdk-android-okhttp:$ooSdkVersion")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
