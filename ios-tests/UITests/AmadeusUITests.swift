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

    func testLive2DCharacterTapReachesReactionAndAudio() {
        let (_, web, probe) = launch(mode: "touch")
        let point = web.coordinate(withNormalizedOffset: CGVector(dx: 0.50, dy: 0.46))
        point.tap()
        waitFor("reactions=1", in: probe)
        waitFor("audio=2", in: probe) // connect hello + tapped reaction
    }

    /// The transcript scrolls by finger. The drag is synthesized inside the page
    /// (see runUiTestMode 'scroll') because an XCUITest drag is not delivered to
    /// this WKWebView as DOM touch or pointer events — measured touch=0/0/0 — so
    /// driving it from here would only ever time out. This asserts the half the
    /// scroller owns: the capture-level listener, the rect hit-test and the
    /// scroll math. It does not assert platform gesture delivery.
    func testCallTranscriptFingerSwipeChangesScrollTop() {
        let (_, _, probe) = launch(mode: "scroll")
        waitFor("scrollable=1", in: probe)
        waitFor("scrolled=1", in: probe, timeout: 25)
    }

    func testTtsTransportReachesDecodePlayAndEnd() {
        let (_, _, probe) = launch(mode: "tts")
        waitFor("voice=END-OK", in: probe, timeout: 25)
        waitFor("audio=2", in: probe, timeout: 25) // connect hello + synthesized WAV
    }
}
