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
        // Only the native code of the phones a build is for. Flutter trims its own
        // libraries by --target-platform, but plugins ship theirs for every kind of
        // phone (WebRTC alone is about 6 MB each), which pushed a 64-bit release over
        // the 25 MiB the update service can store. No --target-platform: no filter.
        val abiFor = mapOf("android-arm" to "armeabi-v7a", "android-arm64" to "arm64-v8a", "android-x64" to "x86_64")
        val targets = (project.findProperty("target-platform") as String?)?.split(",")?.mapNotNull { abiFor[it.trim()] }.orEmpty()
        // Flutter's plugin has already listed every kind of phone here, so replace its list.
        if (targets.isNotEmpty()) {
            ndk {
                abiFilters.clear()
                abiFilters += targets
            }
        }
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

    // Same app ID in both: these are two ways to deliver one app, not two apps.
    flavorDimensions += "distribution"
    productFlavors {
        // Downloaded from our own update Worker, and able to install its own updates.
        create("direct") { dimension = "distribution" }
        // For Google Play, which forbids an app installing its own updates. Lacks that
        // permission, and sends people to the Play listing instead (AppConfig).
        create("play") { dimension = "distribution" }
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
    // Tax invoices drawn onto the CRM's PDF template, as pdf-lib does on the web
    // (TaxInvoice.kt). Apache 2.0.
    // Bouncy Castle is only for encrypted PDFs; the template is not encrypted, and it
    // would add about 4.5 MB.
    implementation("com.tom-roush:pdfbox-android:2.0.27.0") {
        exclude(group = "org.bouncycastle")
    }
}

if (signingProperties == null) {
    tasks.matching { it.name.startsWith("pre") && it.name.endsWith("ReleaseBuild") }.configureEach {
        doFirst {
            throw GradleException(
                "No release signing key. Set DIKHO_KEY_PROPERTIES to a key.properties file. See docs/ANDROID.md.",
            )
        }
    }
}
