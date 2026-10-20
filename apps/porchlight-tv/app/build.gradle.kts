plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The Porchlight server the TV talks to. 10.0.2.2 is the host machine as seen from the Android emulator.
// Override at build time with -Pporchlight.server=http://192.168.1.20:4000, or at run time (see README).
val porchlightServer = providers.gradleProperty("porchlight.server").getOrElse("http://10.0.2.2:4000")

android {
    namespace = "io.github.pswapnajit.porchlight.tv"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.pswapnajit.porchlight.tv"
        minSdk = 28 // Fire OS 7 (Android 9) and newer
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "PORCHLIGHT_SERVER", "\"$porchlightServer\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(composeBom)
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.tv:tv-material:1.1.0")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.core:core-ktx:1.17.0")
}
