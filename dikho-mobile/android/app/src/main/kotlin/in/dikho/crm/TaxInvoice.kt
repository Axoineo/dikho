package `in`.dikho.crm

import android.content.Context
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.font.PDType0Font
import java.io.ByteArrayInputStream
import java.io.File
import java.util.UUID

/**
 * Draws a tax invoice onto the CRM's own template, as the web does with pdf-lib in
 * src/features/invoices/generateTaxInvoice.js. What goes where is decided in Dart
 * (lib/features/sales_orders/tax_invoice.dart); this only places each text on the
 * template's first page, in PDF points, with the same Roboto fonts, and right-aligns
 * the texts marked so by their measured width. The template and fonts in
 * assets/invoice are copies of public/Temps, kept equal by a test.
 */
object TaxInvoice {
    private const val MAX_TEXTS = 400
    private const val MAX_TEXT_LENGTH = 300

    /** Writes the PDF into the transfer folder and returns its path. */
    fun make(context: Context, texts: List<*>): String {
        require(texts.size <= MAX_TEXTS) { "too many texts" }
        PDFBoxResourceLoader.init(context.applicationContext)
        val folder = File(context.cacheDir, "transfers").apply { mkdirs() }
        val out = File(folder, UUID.randomUUID().toString())
        val template = context.assets.open("invoice/SO_template.pdf").use { it.readBytes() }
        val regularBytes = context.assets.open("invoice/Roboto-Regular.ttf").use { it.readBytes() }
        val boldBytes = context.assets.open("invoice/Roboto-Medium.ttf").use { it.readBytes() }
        PDDocument.load(template).use { document ->
            val regular = PDType0Font.load(document, ByteArrayInputStream(regularBytes))
            val bold = PDType0Font.load(document, ByteArrayInputStream(boldBytes))
            val page = document.getPage(0)
            // Appended after the template's own drawing, which is wrapped so it cannot
            // move or recolour what is added, as pdf-lib does.
            PDPageContentStream(document, page, PDPageContentStream.AppendMode.APPEND, true, true).use { stream ->
                stream.setNonStrokingColor(0f, 0f, 0f)
                for (entry in texts) {
                    val text = entry as? Map<*, *> ?: continue
                    val font = if (text["b"] == true) bold else regular
                    val size = (text["s"] as? Number)?.toFloat() ?: continue
                    val value = printable(font, (text["t"] as? String).orEmpty().take(MAX_TEXT_LENGTH))
                    if (value.isEmpty() || size <= 0f || size > 40f) continue
                    var x = (text["x"] as? Number)?.toFloat() ?: continue
                    val y = (text["y"] as? Number)?.toFloat() ?: continue
                    if (text["r"] == true) x -= font.getStringWidth(value) / 1000f * size
                    stream.beginText()
                    stream.setFont(font, size)
                    stream.newLineAtOffset(x, y)
                    stream.showText(value)
                    stream.endText()
                }
            }
            document.save(out)
        }
        return out.path
    }

    /** Characters the font has no glyph for become '?', where pdf-lib draws an empty box. */
    private fun printable(font: PDType0Font, value: String): String {
        val clean = value.replace(Regex("[\\r\\n\\t]"), " ")
        return try {
            font.encode(clean)
            clean
        } catch (_: Exception) {
            buildString {
                var i = 0
                while (i < clean.length) {
                    val cp = clean.codePointAt(i)
                    val char = String(Character.toChars(cp))
                    append(
                        try {
                            font.encode(char)
                            char
                        } catch (_: Exception) {
                            "?"
                        },
                    )
                    i += Character.charCount(cp)
                }
            }
        }
    }
}
