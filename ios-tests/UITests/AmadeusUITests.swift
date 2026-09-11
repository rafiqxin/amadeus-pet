import XCTest

final class AmadeusUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launch(mode: String) -> (XCUIApplication, XCUIElement, XCUIElement) {
        let app = XCUIApplication()
        app.launchEnvironment["AMA_TEST_MODE"] = mode
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 20), "WKWebView did not appear")
        let probe = app.staticTexts["AMA_TEST_PROBE"]
        XCTAssertTrue(probe.waitForExistence(timeout: 15), "native JS probe bridge did not appear")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS 'ready=1'"), object: probe)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 25), .completed, "renderer never became ready: \(probe.label)")
        return (app, web, probe)
    }

    private func waitFor(_ fragment: String, in probe: XCUIElement, timeout: TimeInterval = 15) {
        let exp = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", fragment), object: probe)
        XCTAssertEqual(XCTWaiter.wait(for: [exp], timeout: timeout), .completed, "missing \(fragment); probe=\(probe.label)")
    }

    private func intField(_ key: String, in label: String) -> Int? {
        let prefix = "\(key)="
        guard let field = label.split(separator: " ").first(where: { $0.hasPrefix(prefix) }) else { return nil }
        return Int(String(field.dropFirst(prefix.count)))
    }

    private func waitForThumbCenter(in probe: XCUIElement) -> CGVector {
        let geometry = XCTNSPredicateExpectation(
            predicate: NSPredicate { [weak self] object, _ in
                guard let self, let element = object as? XCUIElement else { return false }
                guard let x = self.intField("thumbX", in: element.label),
                      let y = self.intField("thumbY", in: element.label) else { return false }
                return x > 0 && x < 10000 && y > 0 && y < 10000
            },
            object: probe
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [geometry], timeout: 12),
            .completed,
            "real rendered thumb geometry never appeared: \(probe.label)"
        )
        let x = intField("thumbX", in: probe.label) ?? -1
        let y = intField("thumbY", in: probe.label) ?? -1
        XCTAssertTrue((1..<10000).contains(x) && (1..<10000).contains(y), "invalid thumb geometry: \(probe.label)")
        return CGVector(dx: CGFloat(x) / 10000.0, dy: CGFloat(y) / 10000.0)
    }

    func testLive2DCharacterTapReachesReactionAndAudio() {
        let (_, web, probe) = launch(mode: "touch")
        let point = web.coordinate(withNormalizedOffset: CGVector(dx: 0.50, dy: 0.46))
        point.tap()
        waitFor("reactions=1", in: probe)
        waitFor("audio=2", in: probe) // connect hello + tapped reaction
    }

    func testCallTranscriptRealThumbChangesScrollTop() {
        let (_, web, probe) = launch(mode: "scroll")
        waitFor("scrollable=1", in: probe)
        let center = waitForThumbCenter(in: probe)
        let endY = min(0.985, center.dy + 0.10)
        XCTAssertGreaterThan(endY, center.dy, "real thumb has no downward drag room: \(probe.label)")
        let start = web.coordinate(withNormalizedOffset: center)
        let end = web.coordinate(withNormalizedOffset: CGVector(dx: center.dx, dy: endY))
        start.press(forDuration: 0.12, thenDragTo: end)
        waitFor("scrolled=1", in: probe)
    }

    func testTtsTransportReachesDecodePlayAndEnd() {
        let (_, _, probe) = launch(mode: "tts")
        waitFor("voice=END-OK", in: probe, timeout: 25)
        waitFor("audio=2", in: probe, timeout: 25) // connect hello + synthesized WAV
    }
}
