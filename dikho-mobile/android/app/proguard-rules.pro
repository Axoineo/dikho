# Added to the default rules by the Flutter Gradle plugin.

# No Android log lines in a release: plugins and libraries may log things this app
# would not choose to. Dart's debugPrint is silenced in lib/main.dart.
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
    public static int e(...);
    public static int wtf(...);
}

# PdfBox (tax invoices): its optional JPEG 2000 decoder is not included.
-dontwarn com.gemalto.jp2.JP2Decoder
-dontwarn com.gemalto.jp2.JP2Encoder
# Bouncy Castle is left out on purpose (only for encrypted PDFs).
-dontwarn org.bouncycastle.**
