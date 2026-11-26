// Writes the PDF fixtures of pdf.test.ts into the current directory, with macOS's own CoreGraphics and CoreText:
//   cd src/fixtures && swift make-pdf-fixtures.swift
// Run once; the PDFs are committed. Their text is written for the tests.

import CoreGraphics
import CoreText
import Foundation

let pageBox = CGRect(x: 0, y: 0, width: 595, height: 842)

func write(_ name: String, title: String?, author: String?, userPassword: String? = nil, pages: [(CGContext) -> Void]) {
	var info: [CFString: Any] = [:]
	if let title { info[kCGPDFContextTitle] = title }
	if let author { info[kCGPDFContextAuthor] = author }
	if let userPassword {
		info[kCGPDFContextUserPassword] = userPassword
		info[kCGPDFContextOwnerPassword] = userPassword + "-owner"
	}
	var box = pageBox
	guard let context = CGContext(URL(fileURLWithPath: name) as CFURL, mediaBox: &box, info as CFDictionary) else {
		fatalError("cannot create \(name)")
	}
	for draw in pages {
		context.beginPDFPage(nil)
		draw(context)
		context.endPDFPage()
	}
	context.closePDF()
}

func text(_ sentence: String) -> (CGContext) -> Void {
	return { context in
		let font = CTFontCreateWithName("Helvetica" as CFString, 18, nil)
		let attributed = NSAttributedString(string: sentence, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
		context.textPosition = CGPoint(x: 72, y: 760)
		CTLineDraw(CTLineCreateWithAttributedString(attributed), context)
	}
}

/** A page that holds only a picture: grey stripes, no text layer, as a scan has. */
func image() -> (CGContext) -> Void {
	return { context in
		let width = 200, height = 100
		var pixels = [UInt8](repeating: 0, count: width * height)
		for y in 0..<height { for x in 0..<width { pixels[y * width + x] = UInt8((x / 10) % 2 == 0 ? 40 : 220) } }
		let provider = CGDataProvider(data: Data(pixels) as CFData)!
		let picture = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: width,
			space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider,
			decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
		context.draw(picture, in: CGRect(x: 72, y: 500, width: 400, height: 200))
	}
}

write("two-pages.pdf", title: "Harbour Notes", author: "Ada Marlow", pages: [
	text("The first page says the harbour opens at dawn."),
	text("The second page says the ferry leaves at noon."),
])
write("three-pages.pdf", title: nil, author: nil, pages: [
	text("Page one of three: sand."),
	text("Page two of three: shingle."),
	text("Page three of three: rock."),
])
write("encrypted.pdf", title: nil, author: nil, userPassword: "fixture", pages: [text("This text is locked.")])
write("image-only.pdf", title: nil, author: nil, pages: [image(), image()])
