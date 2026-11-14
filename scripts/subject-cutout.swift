import Foundation
import Vision
import CoreImage
import AppKit

// Cuts the person out of a photo with macOS's own subject lifting (Vision, macOS 14+) and writes
// a PNG with a clear background. Step 1 of scripts/landing-step-heads.py.
//
//   swift scripts/subject-cutout.swift photo.png cut.png
let args = CommandLine.arguments
let input = URL(fileURLWithPath: args[1]), output = URL(fileURLWithPath: args[2])
guard let ci = CIImage(contentsOf: input) else { fatalError("cannot read \(args[1])") }
let handler = VNImageRequestHandler(ciImage: ci)
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let obs = request.results?.first else { fatalError("no subject found") }
print("instances:", obs.allInstances.count)
// The largest instance is the person; anything else (a lamp) is left out.
var best = IndexSet(), bestArea = -1
for i in obs.allInstances {
  let mask = try obs.generateScaledMaskForImage(forInstances: IndexSet(integer: i), from: handler)
  CVPixelBufferLockBaseAddress(mask, .readOnly)
  let w = CVPixelBufferGetWidth(mask), h = CVPixelBufferGetHeight(mask), rb = CVPixelBufferGetBytesPerRow(mask)
  let p = CVPixelBufferGetBaseAddress(mask)!.assumingMemoryBound(to: Float32.self)
  var area = 0
  for y in stride(from: 0, to: h, by: 4) { for x in stride(from: 0, to: w, by: 4) { if p[(y * rb) / 4 + x] > 0.5 { area += 1 } } }
  CVPixelBufferUnlockBaseAddress(mask, .readOnly)
  print("instance", i, "area", area)
  if area > bestArea { bestArea = area; best = IndexSet(integer: i) }
}
let cut = try obs.generateMaskedImage(ofInstances: best, from: handler, croppedToInstancesExtent: false)
let outCI = CIImage(cvPixelBuffer: cut)
let ctx = CIContext()
try ctx.writePNGRepresentation(of: outCI, to: output, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
print("wrote", output.path)
