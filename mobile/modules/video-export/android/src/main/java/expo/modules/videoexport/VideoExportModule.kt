package expo.modules.videoexport

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android export is not implemented yet.
 *
 * It reports that plainly rather than returning a path to nothing. A silent
 * no-op on an export is worse than an error: the user believes they have a file,
 * and finds out they do not when they try to share it.
 *
 * The work is Media3 Transformer — an EditedMediaItemSequence per video layer,
 * built from the same composition plan the iOS side consumes.
 */
class VideoExportModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VideoExport")

    Property("isSupported") { false }

    AsyncFunction("exportComposition") { _: Map<String, Any?> ->
      throw CodedException(
        "ERR_EXPORT_UNIMPLEMENTED",
        "Exporting on Android is not implemented yet. Edit here and export on the desktop, or on iOS.",
        null
      )
    }
  }
}
