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
    }

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

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")

    // OpenObserve native Android RUM SDK (fork of Datadog android-sdk)
    implementation("ai.openobserve:o2-sdk-android-rum:0.1.0-alpha5")
    implementation("ai.openobserve:o2-sdk-android-logs:0.1.0-alpha5")
    implementation("ai.openobserve:o2-sdk-android-session-replay:0.1.0-alpha5")
}
