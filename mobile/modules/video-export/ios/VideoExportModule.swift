import AVFoundation
import ExpoModulesCore

/**
 Renders a composition plan with AVFoundation.

 The plan arrives already ordered and resolved — bottom video layer first, each
 segment carrying its source range and timeline placement — because those rules
 live in `src/shared/videoCompositionPlan.ts` and are shared with the desktop.
 Nothing here decides what goes where; it only builds the AVFoundation objects
 that say it.
 */

struct SegmentInput: Record {
  @Field var uri: String = ""
  @Field var timelineStartMs: Double = 0
  @Field var sourceStartMs: Double = 0
  @Field var sourceEndMs: Double = 0
  @Field var gain: Double = 1
}

struct ExportRequest: Record {
  @Field var width: Int = 1920
  @Field var height: Int = 1080
  @Field var frameRate: Int = 30
  @Field var durationMs: Double = 0
  @Field var videoSegments: [SegmentInput] = []
  @Field var audioSegments: [SegmentInput] = []
}

private func time(_ milliseconds: Double) -> CMTime {
  CMTime(value: CMTimeValue(max(0, milliseconds).rounded()), timescale: 1000)
}

public final class VideoExportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VideoExport")

    Property("isSupported") { true }

    AsyncFunction("exportComposition") { (request: ExportRequest) -> [String: Any] in
      try await Self.export(request)
    }
  }

  private static func export(_ request: ExportRequest) async throws -> [String: Any] {
    if request.videoSegments.isEmpty && request.audioSegments.isEmpty {
      throw Exception(name: "EmptyComposition", description: "The timeline has no media to export.")
    }

    let composition = AVMutableComposition()
    let renderSize = CGSize(width: request.width, height: request.height)
    var layerInstructions: [AVMutableVideoCompositionLayerInstruction] = []

    // Each video segment gets its own track. Sharing one track would serialise
    // clips that are meant to overlap, which is exactly what a multi-track
    // timeline is for.
    for segment in request.videoSegments {
      guard let url = URL(string: segment.uri) ?? URL(string: "file://\(segment.uri)") else { continue }
      let asset = AVURLAsset(url: url)
      guard let sourceTrack = try await asset.loadTracks(withMediaCharacteristic: .visual).first else { continue }
      guard let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }

      let range = CMTimeRange(start: time(segment.sourceStartMs), end: time(segment.sourceEndMs))
      try track.insertTimeRange(range, of: sourceTrack, at: time(segment.timelineStartMs))

      let instruction = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
      instruction.setTransform(try await sourceTrack.load(.preferredTransform), at: .zero)
      // The plan hands layers bottom-first, and AVFoundation draws the first
      // layer instruction on top — so the order is reversed when they are
      // assembled below rather than here.
      layerInstructions.append(instruction)
    }

    for segment in request.audioSegments where segment.gain > 0 {
      guard let url = URL(string: segment.uri) ?? URL(string: "file://\(segment.uri)") else { continue }
      let asset = AVURLAsset(url: url)
      guard let sourceTrack = try await asset.loadTracks(withMediaType: .audio).first else { continue }
      guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
      let range = CMTimeRange(start: time(segment.sourceStartMs), end: time(segment.sourceEndMs))
      try track.insertTimeRange(range, of: sourceTrack, at: time(segment.timelineStartMs))
    }

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: time(request.durationMs))
    instruction.layerInstructions = layerInstructions.reversed()

    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, request.frameRate)))
    videoComposition.instructions = [instruction]

    let output = FileManager.default.temporaryDirectory
      .appendingPathComponent("openvideo-export-\(Int(Date().timeIntervalSince1970)).mp4")

    guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      throw Exception(name: "ExportUnavailable", description: "This device cannot create an export session.")
    }
    session.outputURL = output
    session.outputFileType = .mp4
    if !layerInstructions.isEmpty {
      session.videoComposition = videoComposition
    }

    await session.export()

    // A cancelled or failed session leaves no usable file; reporting success
    // would hand the user a path to nothing.
    guard session.status == .completed else {
      throw Exception(
        name: "ExportFailed",
        description: session.error?.localizedDescription ?? "The export did not complete."
      )
    }

    return ["uri": output.absoluteString, "durationMs": request.durationMs]
  }
}
