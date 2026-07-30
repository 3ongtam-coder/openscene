package expo.modules.videoexport

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Base64
import java.io.ByteArrayOutputStream
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android export is not implemented yet; frame extraction is.
 *
 * Export reports its absence plainly rather than returning a path to nothing. A
 * silent no-op on an export is worse than an error: the user believes they have
 * a file, and finds out they do not when they try to share it. The work is
 * Media3 Transformer — an EditedMediaItemSequence per video layer, built from
 * the same composition plan the iOS side consumes.
 *
 * Reading a frame is a different matter: a few lines of MediaMetadataRetriever,
 * and without it the shot-to-shot continuity the video screen offers would be
 * quietly missing on Android alone.
 */
class VideoExportModule : Module() {
  /**
   * Typed as returning Unit on purpose.
   *
   * A lambda whose body only throws infers `Nothing`, and the AsyncFunction
   * builder reifies its return type — which `Nothing` cannot be. Written inline
   * this module did not compile at all, which went unnoticed because nothing had
   * built it for Android until now.
   */
  private val refuseExport: (Map<String, Any?>) -> Unit = {
    throw CodedException(
      "ERR_EXPORT_UNIMPLEMENTED",
      "Exporting on Android is not implemented yet. Edit here and export on the desktop, or on iOS.",
      null
    )
  }

  override fun definition() = ModuleDefinition {
    Name("VideoExport")

    Property("isSupported") { false }

    AsyncFunction("exportComposition", refuseExport)

    AsyncFunction("extractFrame") { uri: String, atMs: Double ->
      extractFrame(uri, atMs)
    }
  }

  private fun extractFrame(uri: String, atMs: Double): Map<String, Any> {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(uri.removePrefix("file://"))
      val durationMs =
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      // A negative time means "the last frame". Backing off a little from the
      // exact end matters: the final presentation time often has no decodable
      // frame at it, and asking for it returns null rather than a picture.
      val targetMs = if (atMs < 0) maxOf(0L, durationMs - 100L) else atMs.toLong()
      // CLOSEST rather than CLOSEST_SYNC: a sync-frame-only seek can land
      // seconds short of the end of a shot, which is the wrong picture to hand
      // to the next one.
      val frame: Bitmap =
        retriever.getFrameAtTime(targetMs * 1000L, MediaMetadataRetriever.OPTION_CLOSEST)
          ?: throw CodedException("ERR_NO_FRAME", "No frame could be read at that time.", null)

      val bytes = ByteArrayOutputStream()
      frame.compress(Bitmap.CompressFormat.JPEG, 90, bytes)
      return mapOf(
        "base64" to Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP),
        "mimeType" to "image/jpeg",
        "atMs" to targetMs.toDouble()
      )
    } finally {
      retriever.release()
    }
  }
}
