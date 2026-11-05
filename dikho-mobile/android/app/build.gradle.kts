import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// The signing key lives outside this repository. See docs/ANDROID.md.
val signingProperties: Properties? = System.getenv("DIKHO_KEY_PROPERTIES")
    ?.let { file(it) }
    ?.takeIf { it.isFile }
    ?.let { source -> Properties().apply { source.inputStream().use { load(it) } } }

val isLocalTestBuild = project.hasProperty("dikhoLocalTest")

android {
    namespace = "in.dikho.crm"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Permanent. Changing this after the first release makes it a different
        // app to Android, and nobody on the old ID could update.
        applicationId = "in.dikho.crm"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (signingProperties != null) {
            create("release") {
                storeFile = file(signingProperties.getProperty("storeFile"))
                storePassword = signingProperties.getProperty("storePassword")
                keyAlias = signingProperties.getProperty("keyAlias")
                keyPassword = signingProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Never falls back to a debug key: an APK signed with one could not
            // update, or be updated by, a real release.
            if (signingProperties != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }

    // Compressed libraries make a smaller download, which is what this app
    // spends its users' data on, at a small cost in first-launch time.
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    // No Google-only signing block: this APK is distributed directly.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    // Local test builds only: permits plain http to localhost.
    if (isLocalTestBuild) {
        sourceSets.getByName("release").res.srcDir("src/localTest/res")
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("androidx.core:core:1.17.0")
    implementation("androidx.webkit:webkit:1.15.0")
}

if (signingProperties == null) {
    tasks.matching { it.name == "preReleaseBuild" }.configureEach {
        doFirst {
            throw GradleException(
                "No release signing key. Set DIKHO_KEY_PROPERTIES to a key.properties file. See docs/ANDROID.md.",
            )
        }
    }
}
